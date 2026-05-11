# LLD — RAG Ingestion 파이프라인 (Discord 대화 검색)

> **관련 이슈**: -
> **상태**: implemented (Phase 1, 임베딩 단계 제외)
> **최종 수정**: 2026-05-12

---

## 개요

`data/export/consolidated/*.json` (채널 + 쓰레드 통합 산출물) 을 RAG 검색용 청크·임베딩으로 가공한다. 사용자 자연어 질문에 대해 관련 Discord 대화(메시지 + 쓰레드 replies) 를 찾아 LLM 답변에 컨텍스트로 제공하는 것이 목표.

핵심 아이디어는 **Small-to-Big (parent document retrieval)**: 작은 청크로 임베딩·검색하고, hit 한 청크의 부모 쓰레드 전체를 LLM 컨텍스트로 확장한다. 아키텍처 결정은 ADR-005 참조.

## 목표

- 메시지·쓰레드의 의미적 연속성 보존 (reply 단독으로 의미가 사라지지 않도록)
- 한국어 + 도메인 약어(기수, 카테고리) 환경에서 recall·precision 양립
- 결정론적·재현 가능한 ingestion (임베딩 호출 없이 청크 단계까지 항상 동일 산출물)
- 채널 권한·기수·시간 필터로 쿼리 시 노이즈 감소

## 범위 (Scope)

**포함**:

- consolidated → 청크 JSONL 변환 스크립트
- 메타데이터 추출(채널 카테고리·기수·반응·첨부 등 정규식/heuristic 기반)
- (선택) Haiku 기반 topic_tags 라벨링
- (선택) 임베딩 호출 + sqlite-vec 인덱스 적재
- (선택) Retrieval 서비스 + `/ask` 슬래시 커맨드

**제외**:

- consolidated 생성 자체 (`consolidate-messages` 산출물에 의존)
- fetch-messages 자체 수정 — 파일명 충돌은 ADR-006 에서 별도 다룸
- 멀티테넌시 / 다중 길드 — 단일 길드 가정

---

## 의존성·전제

- **상류 데이터 손실 (ADR-006)**: 현재 `consolidated/` 는 채널 이름 충돌로 일부 채널이 덮어쓰기됨 (15개 키, `🙄-질문게시판` 등). RAG 검색의 절대적 정확도는 ADR-006 해소 이전에는 한계가 있음. 본 LLD 는 그 한계 위에서 파이프라인을 먼저 만든 뒤, ADR-006 적용 후 재인덱싱하는 흐름을 가정한다.
- **채널 권한 메타데이터**: 운영진 전용 채널을 일반 멤버 쿼리에 노출시키지 않으려면 retrieval 단계 ACL 필터 필요. 현재 fetch 산출물에 권한 정보가 없어 별도 분류 필요 (미결).

---

## 데이터 흐름

```text
data/export/consolidated/*.json
  ↓ build-rag-chunks (결정론적, 비용 0)
data/export/rag/chunks.jsonl             # 청크 + 메타데이터 (임베딩 대상 텍스트 포함)
data/export/rag/chunks-stats.json        # 분포·통계 (윈도우 수, 길이 분포 등)
  ↓ (선택) label-topic-tags (Haiku, 1회성)
data/export/rag/chunks-tagged.jsonl
  ↓ (선택) embed-chunks (OpenAI / bge-m3)
data/bot.db: rag_chunks + rag_vec        # sqlite-vec 가상 테이블
  ↓ query
사용자 질문 → ragService.search() → LLM 답변
```

각 단계는 결정론적·독립 실행 — 단계별로 산출물을 디스크에 두어 재실행·디버깅 용이.

---

## 청크 구성

### 케이스 분기

| 입력 | 처리 |
|---|---|
| 단독 메시지 (`thread` 없음) | 1 청크 = HEADER + 본문. `reply_to_id` 체인은 우선 무시(MVP) |
| 짧은 쓰레드 (≤~1.5k 토큰) | 1 청크 = HEADER + starter + 모든 replies |
| 긴 쓰레드 (>1.5k 토큰) | 슬라이딩 윈도우. starter 는 모든 윈도우에 반복 포함, reply 는 K개씩 50% overlap |
| 본문 빈 starter (첨부/임베드만) | embed.title/description 을 본문으로 합성 (`embeds[0].title + "\n" + embeds[0].description`) |
| 빈 쓰레드 (replies 0) | skip |

### 청크 텍스트 포맷 (임베딩 대상)

```text
[채널] {channel_name} (기수: {generation|"-"}, 카테고리: {category})
[쓰레드] {thread_name|"(단독 메시지)"} (시각: {starter_timestamp})
[작성자] {starter_author_name}

[STARTER]
{starter_content (필요 시 500 토큰까지 truncate)}

[REPLIES]
- {author_1}: {reply_1}
- {author_2}: {reply_2}
...
```

> starter 본문을 모든 윈도우에 반복 포함하는 비용보다, reply 단독 임베딩이 컨텍스트 없이 무의미해지는 손실이 훨씬 크다. ADR-005 §Decision 참조.

### 메타데이터 스키마 (JSONL row)

```jsonc
{
  "id": "<uuid>",                       // 청크 고유 id
  "parent_thread_id": "<snowflake>",    // 단독 메시지는 자기 id
  "channel_id": "<snowflake>",          // 진짜 키 (이름 충돌 회피)
  "channel_name": "🙄-질문게시판",
  "channel_category": "질문",            // 정규식 — 질문/공지/채용/회계/운영/스터디/잡담/etc
  "generation": "24기",                  // 정규식 — 없으면 null
  "thread_id": "<snowflake>",           // 단독 메시지면 null
  "thread_name": "Foo 디플로이 에러",
  "is_starter_only": false,
  "message_ids": ["<snowflake>", ...],
  "author_ids": [...],
  "author_names": [...],
  "timestamp_start": "ISO8601",
  "timestamp_end": "ISO8601",
  "reply_count": 12,
  "reaction_positive": 3,
  "reaction_negative": 0,
  "has_attachments": false,
  "has_link": true,
  "has_code": false,                    // ``` 블록 감지
  "topic_tags": ["배포", "에러"],        // (선택) Haiku 라벨링
  "language": "ko",
  "token_count": 842,
  "text": "..."                         // 위 임베딩 텍스트 전체
}
```

### 정규식·heuristic

- `generation`: `/(\d{2})기/` — 채널명에서 추출. (`28기-server-채용` → `28기`)
- `channel_category`:
    - `질문`: 채널명에 `질문` 포함
    - `공지`: `공지`, `초대채널`
    - `채용`: `채용`
    - `회계`: `회계`, `회비`
    - `출결`: `출결`
    - `스터디`: `스터디`
    - `회고`: `회고`
    - `운영`: `운영`, `회장단`
    - `webhook`: `webhook`, `alert`, `noti`
    - 그 외: `general`
- `has_code`: 청크 텍스트에 ` ``` ` 또는 줄 시작 4-space 인덴트 코드 블록 존재 여부
- `has_link`: `https?://` 매칭
- `language`: 한글 문자 비율 > 0.3 이면 `ko`, 아니면 `en`/`mixed` (MVP 는 거의 `ko`)

---

## 윈도우 파라미터 (안)

| 항목 | 값 | 비고 |
|---|---|---|
| 최대 청크 토큰 | 1500 | tiktoken `cl100k_base` 기준 |
| starter 최대 토큰 | 500 | 초과 시 head-tail 합성 |
| reply 윈도우 K | 6 | reply 6개씩 묶음 |
| overlap 비율 | 50% | 이전 윈도우의 끝 3 reply 가 다음 윈도우 시작에 반복 |
| 단일 reply 최대 토큰 | 400 | 초과 시 head 만 |

> 측정 후 튜닝 — recall@K / nDCG 평가셋 필요 (미결).

---

## Retrieval 파이프라인 (ADR-005 인용)

```text
사용자 질문
  ↓
(1) Query 분석 — Haiku
    → {expanded_query, filters: {generation?, category?, time_range?, channel_id?}}
  ↓
(2) Hybrid search: BM25(top 50) ∪ Dense(top 50)
  ↓
(3) RRF → top 30
  ↓
(4) Metadata prefilter (generation/category/time/acl) → top 30
  ↓
(5) Cross-encoder rerank → top 8
  ↓
(6) parent_thread_id expand + dedup → top 5 쓰레드 컨텍스트
  ↓
LLM 답변 (Claude Sonnet 등)
```

세부 근거·각 단계의 역할은 ADR-005 §Decision/Sketch 참조.

---

## BM25 토크나이저 / 임베딩 / 벡터 저장소 (확정)

ADR-005 의 확정 컴포넌트를 따른다.

- **BM25 토크나이저**: `kiwi-nlp` (Node 네이티브 바인딩, in-process) 로 사전 토크나이즈 → sqlite-fts5(`unicode61`) 에 공백 분리 형태로 저장. 쿼리도 동일 토크나이저로 분해. Nori (Lucene 전용) 대신 OpenSearch 도입 없이 한국어 형태소 매칭 달성 (옵션 B 경로)
- **임베딩 모델**: OpenAI `text-embedding-3-small` (1536d). `src/services/embeddingProvider.ts` 에서 캡슐화
    - 환경변수: `OPENAI_API_KEY` (필수), `EMBEDDING_MODEL` (선택, 기본 `text-embedding-3-small`)
    - 비용: 실측 ~1.8M 토큰 × $0.02/1M ≈ **~$0.04** (1회성)
    - 모델 교체로 차원이 바뀌면 `data/rag.db` 삭제 후 재인덱싱 필요
- **벡터 저장소**: `sqlite-vec` 가상 테이블 — `better-sqlite3.loadExtension()` 로 로딩, 새 DB 프로세스 0
- **저장 파일 분리**:
    - `data/bot.db` — 봇 운영 상태 (세션·공지·길드 설정 등). 라이프사이클 = 영속, 백업 필수
    - `data/rag.db` — RAG 코퍼스 (`rag_chunks` / `rag_vec` / `rag_fts`). 라이프사이클 = 파생, wipe&rebuild 가능
    - `ATTACH DATABASE 'data/rag.db' AS rag` 로 단일 커넥션에서 join 가능 — 코드 복잡도 증가 없음
- **확장 후보** (장래): `bge-m3` self-host (한국어 강점, dense+sparse), Qdrant / pgvector (수백만 청크 규모)

---

## DB 스키마

모든 테이블은 **`data/rag.db`** 에 생성한다. 봇 부팅 시 `ATTACH DATABASE 'data/rag.db' AS rag` 로 연결.

```sql
-- 메인 메타데이터 테이블
CREATE TABLE IF NOT EXISTS rag.rag_chunks (
  id TEXT PRIMARY KEY,
  parent_thread_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  channel_category TEXT,
  generation TEXT,
  thread_id TEXT,
  thread_name TEXT,
  is_starter_only INTEGER NOT NULL,
  message_ids TEXT NOT NULL,           -- JSON array
  author_ids TEXT NOT NULL,
  author_names TEXT NOT NULL,
  timestamp_start TEXT NOT NULL,
  timestamp_end TEXT NOT NULL,
  reply_count INTEGER NOT NULL,
  reaction_positive INTEGER NOT NULL,
  reaction_negative INTEGER NOT NULL,
  has_attachments INTEGER NOT NULL,
  has_link INTEGER NOT NULL,
  has_code INTEGER NOT NULL,
  topic_tags TEXT,                     -- JSON array, nullable
  language TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  text TEXT NOT NULL,                  -- 원본 임베딩 텍스트 (사람용·LLM 컨텍스트용)
  text_tokenized TEXT NOT NULL,        -- kiwi 사전 토크나이즈 결과 (공백 분리, fts5 인덱싱 대상)
  embedded_at DATETIME
);

CREATE INDEX IF NOT EXISTS rag.idx_rag_channel ON rag_chunks(channel_id);
CREATE INDEX IF NOT EXISTS rag.idx_rag_generation ON rag_chunks(generation);
CREATE INDEX IF NOT EXISTS rag.idx_rag_category ON rag_chunks(channel_category);
CREATE INDEX IF NOT EXISTS rag.idx_rag_time ON rag_chunks(timestamp_start);

-- sqlite-vec 벡터 테이블 (모델 변경 시 dim 도 변경)
CREATE VIRTUAL TABLE IF NOT EXISTS rag.rag_vec USING vec0(
  chunk_id TEXT PRIMARY KEY,
  embedding float[1536]
);

-- BM25 fts5 — kiwi 사전 토크나이즈된 text_tokenized 컬럼을 인덱싱
CREATE VIRTUAL TABLE IF NOT EXISTS rag.rag_fts USING fts5(
  chunk_id UNINDEXED,
  text_tokenized,
  tokenize = 'unicode61 remove_diacritics 2'
);
```

> `text` 는 LLM 컨텍스트와 디버깅용 원문, `text_tokenized` 는 BM25 인덱싱용 형태소 분리본을 별도 저장한다. 인덱스 갱신 시 kiwi 사전이 바뀌면 `text_tokenized` 와 `rag_fts` 재빌드 필요 — `text` / `rag_vec` 은 영향 없음.

---

## 스크립트 / 모듈 (예정)

| 경로 | 책임 |
|---|---|
| `src/services/koreanTokenizer.ts` | `kiwi-nlp` 래퍼. `tokenize(text): string` (공백 분리). 청크 생성 / 쿼리 두 군데에서 동일 함수 사용 |
| `src/scripts/build-rag-chunks.ts` | consolidated → `chunks.jsonl` + 통계. `text` 와 `text_tokenized` 동시 산출 |
| `src/scripts/label-topic-tags.ts` | (선택) Haiku 호출로 `topic_tags` 라벨링 |
| `src/scripts/embed-chunks.ts` | (선택) JSONL → 임베딩 호출 → `data/rag.db` 적재 (`rag_chunks` + `rag_vec` + `rag_fts`) |
| `src/db/rag.ts` | `data/rag.db` 커넥션 + `ATTACH DATABASE` + sqlite-vec 확장 로딩 |
| `src/db/repositories/ragRepository.ts` | rag_chunks / rag_vec / rag_fts 접근, hybrid search 쿼리 |
| `src/services/ragService.ts` | retrieval 파이프라인 (query 분석 → hybrid + RRF + filter + rerank + parent expand) |
| `src/commands/ask.ts` | `/ask` 슬래시 커맨드 |

---

## 슬래시 커맨드 (예정)

| 커맨드 | 설명 | 권한 |
|--------|------|------|
| `/ask` | 자연어 질문으로 과거 Discord 대화 검색·요약 답변 | 일반 멤버 (단 ACL 필터로 운영진 채널 제외) |

### 옵션

| 옵션명 | 타입 | 필수 | 설명 |
|--------|------|------|------|
| `질문` | String | 예 | 자연어 질문 |
| `기수` | String | 아니오 | 강제 필터 ("24기" 등) |
| `카테고리` | String | 아니오 | `질문 / 공지 / 채용 / 회계 / 출결 / 스터디 / 회고 / 운영` |

---

## 에러 처리

| 상황 | 처리 방식 |
|------|----------|
| `consolidated/` 없음 | build-rag-chunks 즉시 종료 (exit 1), 안내 메시지 |
| 빈 쓰레드 / 빈 본문 | skip + 통계 카운트 |
| 임베딩 API 429/5xx | 지수 백오프 3회 → 실패 시 청크 id 와 함께 stderr 로그, 다음 청크 진행 |
| 임베딩 일부 실패 | 부분 적재 허용, `embedded_at` 가 null 인 청크는 다음 실행에서 재시도 |
| token_count 한도 초과 | starter head-tail 으로 합성 후 재계산 |
| 운영진 전용 채널 분류 정보 없음 | MVP 는 보수적으로 `__operating__` 카테고리에 묶고 일반 사용자 쿼리에서 기본 제외 |

---

## 평가 (미결)

- 골든 쿼리 셋: 20~50개 자연어 질문 + 정답 쓰레드 id
- 지표: recall@5, recall@10, nDCG@10, MRR
- 측정 대상:
    - 단계별 ablation (BM25 only / Dense only / Hybrid / +Rerank / +Filter)
    - 청킹 파라미터 (K, overlap, max_tokens)
- 도구: 간단한 vitest 기반 평가 스크립트

---

## 단계별 산출물 (구현 권장 순서)

1. `build-rag-chunks` + `chunks.jsonl` + 통계 (비용 0, 결정론적) — ✅ 구현 완료
2. (옵션) Haiku 라벨링 — 미구현
3. `embed-chunks` + `rag_chunks` / `rag_vec` / `rag_fts` 테이블 — ✅ 코드 완료, **실행은 별도 게이트** (OPENAI 비용 발생)
4. `ragService` (hybrid + RRF + filter + parent expand) — ✅ 구현 완료 (rerank 자리 유보)
5. `/rag` 슬래시 커맨드 — ✅ 구현 완료 (`/ask` 는 agent 가 선점하고 있어 `/rag` 채택)
6. 평가 셋·자동 측정 (recall/precision 회귀 방지) — 미구현

임베딩·LLM 비용 발생 단계는 별도 리뷰 게이트 (LLD §단계별 산출물 원칙).

## 구현 현황 (2026-05-12)

- 15,407 source messages + 1,334 threads → **15,607 chunks** 산출 (`data/export/rag/chunks.jsonl`, 31MB)
- 카테고리 분포 상위: infra 5957 / general 2524 / 운영 2437 / 직군 1761 / 공지 1081 / 채용 597
- 기수 분포: 22기 1694 / 28기 414 / 25기 355 / 24기 321 / 23기 307 / 27기 212 / 26기 125 / 21기 47 / (none) 12132
- 토큰 분포: <200=14,080 / 200-500=1,342 / 500-1000=152 / 1000-1500=27 / >1500=6 — 슬라이딩 윈도우 분할 잘 작동 중
- sqlite-vec 확장 로딩 + vec0 KNN + fts5 MATCH 스모크 테스트 통과
- typecheck / lint 클린

### 한국어 토크나이저 — 구현 노트

ADR-005 와 본 LLD 는 `kiwi-nlp` 채택을 명시했으나, 실측 결과 `kiwi-nlp` 는 **WASM + 별도 모델 파일(수십 MB)** 을 요구하는 브라우저-우선 패키지였다. 모델 파일 번들·로딩이 별도 과제라 MVP 에서는 **정규식 기반 사전 토크나이저** (`src/services/koreanTokenizer.ts`) 로 시작.

- 현재 구현: 한국어 조사·어미를 휴리스틱 정규식으로 제거 → 어간만 추출. fts5 unicode61 단독보다 한국어 매칭 정확도 명백히 향상.
- 인터페이스 `tokenize(text): string[]` 는 그대로 유지 → 향후 kiwi 통합 시 koreanTokenizer.ts 내부만 교체. 색인된 `text_tokenized` 컬럼 재빌드는 필요.
- 진짜 kiwi 통합은 별도 작업으로 trackback (미결 사항 갱신).

---

## 미결 사항 (Open Questions)

- [ ] reranker 도입 시점 / 모델 (`bge-reranker-base` CPU vs `bge-reranker-v2-m3`) — 평가셋 측정 후
- [ ] `topic_tags` LLM 라벨링 채택 여부 (precision 추가 이득 vs 1회성 Haiku 비용)
- [ ] **kiwi-nlp 통합** — 현재 MVP 는 regex-기반 토크나이저. kiwi WASM + 모델 파일(약 50MB) 번들링 및 비동기 초기화 라이프사이클 설계 후 교체. 인터페이스 `tokenize()` 는 호환
- [ ] 채널 ACL 분류 데이터 소스 (현재 fetch 산출물에 권한 정보 없음)
- [ ] 평가 셋 제작 — 누가, 얼마나
- [ ] ADR-006 (파일명 충돌) 해소 전에 RAG 인덱싱을 한 번 실행할지(스모크 테스트), 아니면 해소 후 한 번에 갈지
- [ ] `/ask` 응답에 원본 쓰레드 링크 표시 정책 (Discord deep link 포맷 + 권한 검증)
- [ ] 슬라이딩 윈도우 파라미터(K, overlap, 토큰 한도) 튜닝 — 초기값으로 시작 후 평가셋 기반
