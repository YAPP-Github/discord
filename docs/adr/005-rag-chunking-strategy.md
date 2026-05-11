---
title: RAG 청킹·리트리벌 아키텍처 — Small-to-Big (parent document retrieval)
status: accepted
last_updated: 2026-05-12
owner: taehyung.koo@musinsa.com
related:
  - docs/features/rag-ingestion.md
  - docs/features/consolidate-messages.md
  - docs/adr/006-fetch-filename-collision.md
---

# ADR-005 — RAG 청킹·리트리벌 아키텍처

> **상태**: accepted (2026-05-12)
> 구현 PR 머지 시 본문 끝에 PR 링크를 추가한다.

## Context

`data/export/consolidated/*.json` (채널 메시지 + 쓰레드 replies 가 nested 로 합쳐진 산출물) 위에 RAG 검색을 구축하려 한다. 목표는 "사용자 자연어 질문 → 관련 Discord 대화(메시지+쓰레드)를 찾아 LLM 답변에 컨텍스트로 제공".

핵심 제약:

- Discord 쓰레드는 **starter 메시지에 강하게 종속** — reply 단독으로는 의미가 없는 경우가 대부분 ("저도요", "넵 됩니다", "여기요 https://...")
- 한국어 + 도메인 약어(`YAPP`, `24기`, `회계`, `채용 일정`) 가 섞임 → 순수 임베딩만으로는 약함
- 코퍼스 규모 (현재): ~15k top-level 메시지 + ~12k thread 메시지, 1.4k 쓰레드, 128개 채널 (`fetch-summary.json` 기준)
- 채널 이름 충돌로 일부 데이터 손실 중 — 별도 ADR-006 참조

알려진 한계:

- 임베딩 단독으로 검색하면 짧은 reply chunk 가 의미를 잃거나(낮은 recall), 긴 쓰레드 통째 chunk 는 신호 희석(낮은 precision) 이 발생
- Discord 의 시간·기수·채널 카테고리 메타데이터를 활용하지 않으면 "24기 회계 결정사항" 같은 쿼리에서 다른 기수가 섞임

## Considered Options

### A. 단일 청크 = 메시지 1개 (no aggregation)

- 장점: 임베딩이 짧고 신호가 또렷 → 단일 청크 precision 높음
- 단점: reply 만 단독으로 임베딩되면 컨텍스트 손실, recall 폭락. "그러면 안 되는 이유 뭐죠?" 같은 reply 는 임베딩이 거의 무의미
- LLM 답변 단계: 청크가 너무 작아 답변 생성에도 부족

### B. 단일 청크 = 쓰레드 전체 (starter + 모든 replies 통째)

- 장점: self-contained, 컨텍스트 손실 없음
- 단점:
    - 긴 쓰레드(>2k 토큰) 는 모델 입력 한도 초과 또는 신호 희석 — 한 벡터가 여러 sub-topic 을 평균내서 어떤 쿼리에도 어중간하게 매칭
    - precision 낮음, 특히 긴 쓰레드 비율이 높은 채널(`🎙토크토크`, `25기운영진-회장단` 등) 에서 심각

### C. Small-to-Big (parent document retrieval) — 선호

- 인덱싱: 짧은 청크(메시지 단위 또는 슬라이딩 윈도우) 로 임베딩
- 검색: 작은 청크로 검색 → hit 한 청크의 `parent_thread_id` 로 **전체 쓰레드를 확장**해 LLM 컨텍스트로 전달
- 청크 텍스트는 항상 `[HEADER (채널/쓰레드/시각)] + [STARTER 본문] + [현재 윈도우의 reply 들]` 로 구성 → starter 컨텍스트를 모든 청크가 들고 있어 reply 단독 의미 손실 방지
- 장점: 검색은 정밀(precision), 답변 생성은 풍부(recall)
- 단점: 청크 수 증가(저장·임베딩 비용), 같은 쓰레드의 여러 청크가 top-K 를 점유할 수 있어 dedup 필요

### D. C + Hybrid retrieval (BM25 + Dense) + Rerank — 채택안

- C 위에 BM25 (한국어 형태소 분석기 — Nori/Mecab) 를 병행, RRF 로 결합
- top-K 에 cross-encoder rerank (예: `bge-reranker-v2-m3`) 적용
- metadata prefilter (기수/카테고리/시간) 로 검색 공간 축소
- 추가 단점: 파이프라인 단계 증가 → 운영 복잡도. 다만 단계마다 명확한 역할 (recall vs precision) 이 있어 디버깅 가능

## Decision

**옵션 D — Small-to-Big + Hybrid + Rerank** 를 채택한다.

근거:

1. Discord 대화의 **starter–reply 종속성** 때문에 단일 메시지 청크(A) 와 쓰레드 통째 청크(B) 모두 한쪽 극단의 단점을 안고 간다. C 의 small-to-big 패턴이 두 단점을 동시에 해소.
2. 한국어 + 도메인 약어(고유명사 매칭) 약점은 임베딩 모델 교체로도 해소되지 않는다 → BM25 보강이 비용 대비 가장 큰 recall 이득.
3. metadata prefilter (특히 `generation`, `channel_category`) 가 precision 의 가장 큰 레버. 채널 이름 정규식만으로 추출 가능해 LLM 비용 0.
4. rerank 는 선택적이지만, 1차 retrieval 의 false positive 가 LLM 답변에 직결되므로 도입 가치 큼.

### 확정된 컴포넌트 (2026-05-12)

| 항목 | 선택 | 근거 |
|---|---|---|
| BM25 토크나이저 | **Kiwi (`kiwi-nlp`) 사전 토크나이즈 → sqlite-fts5 (unicode61)** | Nori 는 Lucene 전용 — OpenSearch 도입 없이 in-process 로 Nori 등가 한국어 형태소 분석 달성 (옵션 B 경로) |
| 임베딩 모델 | **OpenAI `text-embedding-3-small` (1536d)** | 인프라 0, 멀티링구얼, 운영 성숙도 높음. 1회성 비용 ~$0.04 (실측 ~1.8M 토큰). 한국어 정밀도 부족 측정 시 `bge-m3` self-host 로 교체 — 청크 JSONL 은 모델 독립이라 재임베딩만 필요 |
| 벡터 저장소 | **`sqlite-vec` 가상 테이블** | 기존 better-sqlite3 에 확장 로딩만으로 사용, 새 DB 프로세스 0 |
| 저장 파일 분리 | **`data/rag.db` (RAG 코퍼스) / `data/bot.db` (봇 운영 상태)** | RAG 코퍼스는 `consolidated/` 로부터 wipe&rebuild 되는 파생 데이터 — 운영 상태와 라이프사이클·크기 분리 필요. `ATTACH DATABASE 'data/rag.db' AS rag` 로 단일 커넥션 유지 |
| Reranker | **(미정)** retrieval 측정 후 결정 — `bge-reranker-base` (CPU) 우선 후보 | 평가셋 도입 후 ablation |

이 조합으로 **새 DB 프로세스·새 서비스 0**, 추가 인프라는 npm 의존성 3개(`sqlite-vec`, `kiwi-nlp`, `openai` 또는 fetch 직접) + `data/rag.db` 파일 1개로 한정된다.

## Sketch

### 청크 구성

```text
ChunkUnit (텍스트 — 임베딩 대상)
  [HEADER]
    채널: <channel_name>  (기수: <generation>, 카테고리: <category>)
    쓰레드: <thread_name>  (시각: <starter_timestamp>)
    작성자: <starter_author_name>
  [STARTER]
    <starter content (truncated to ~500 tokens)>
  [REPLIES]
    <reply 1 (author, content)>
    <reply 2 ...>
    ...
```

- 짧은 쓰레드(≤~1.5k 토큰): 1 청크 = starter + 모든 replies
- 긴 쓰레드(>1.5k 토큰): 슬라이딩 윈도우, K개 reply 씩, 50% overlap. **starter 는 모든 윈도우에 반복 포함**
- 쓰레드 없는 단독 메시지: HEADER + 본문 1청크. `reply_to_id` 체인이 있으면 묶어서 처리

### 메타데이터 (vector store 의 payload)

```yaml
parent_thread_id            # snowflake (또는 단독 메시지 id)
channel_id                  # 진짜 키 (이름 충돌 회피)
channel_name
channel_category            # 정규식 — 질문/공지/채용/회계/운영/스터디/잡담/...
generation                  # "24기" 등 — 채널명 정규식
thread_id | null
thread_name
message_ids: [snowflake...]
author_ids, author_names
timestamp_start, timestamp_end
reply_count
reaction_positive, reaction_negative
has_attachments, has_link, has_code
topic_tags: [str]           # (선택) Haiku 라벨링
language: "ko"
token_count
text                        # 임베딩 대상 텍스트 (위 ChunkUnit)
```

### Retrieval 파이프라인

```text
사용자 질문
  ↓
(1) Query 분석 — Haiku 한 번
    → {expanded_query, filters: {generation?, category?, time_range?}}
  ↓
(2) Hybrid search
    BM25(top 50) ∪ Dense(top 50)
  ↓
(3) RRF (Reciprocal Rank Fusion) → top 30
  ↓
(4) Metadata filter (generation/category/time) → top 30
  ↓
(5) Cross-encoder rerank (bge-reranker-v2-m3) → top 8
  ↓
(6) parent_thread_id 로 전체 쓰레드 expand
    + 동일 쓰레드 dedup → top 5 쓰레드 컨텍스트
  ↓
LLM 답변 (Claude — Sonnet/Opus)
```

각 단계의 역할:

| 단계 | 해결하는 문제 | 효과 |
|---|---|---|
| BM25 보강 | 한국어 형태소·고유명사 (YAPP, 24기) | recall ↑ |
| Query 분석 → filter | "24기 출결" → `generation=24기` prefilter | precision ↑↑↑ |
| RRF | dense/sparse 한쪽이 놓치는 케이스 | recall ↑ |
| Rerank | 1차 retrieval false positive 제거 | precision ↑↑↑ |
| Parent expand | 작은 청크의 컨텍스트 부족 보완 | 답변 품질 ↑ |
| Thread dedup | 같은 쓰레드 여러 청크가 top-K 잠식 방지 | precision ↑ |

### BM25 토크나이저 (확정)

- `kiwi-nlp` (Node 네이티브 바인딩, in-process) 로 청크 텍스트를 **사전 토크나이즈** → 공백 분리 형태로 sqlite-fts5(`unicode61`) 에 저장
- 쿼리 시 동일 토크나이저로 쿼리 문자열을 분해해 fts5 MATCH 수행
- Nori (Lucene 전용) 와 동일 정확도는 보장 안 되지만, 한국어 형태소 단위 매칭이라는 효과는 동일. OpenSearch/ES 도입 0
- 한국어 외 토큰(영문, 코드 식별자) 은 kiwi 출력 그대로 fts5 가 처리

### 임베딩 모델 (확정)

`src/services/embeddingProvider.ts` 가 OpenAI 호출을 캡슐화. 환경변수:

| ENV | 기본값 | 설명 |
|---|---|---|
| `OPENAI_API_KEY` | (필수) | OpenAI API 키 |
| `EMBEDDING_MODEL` | `text-embedding-3-small` (1536d) | `text-embedding-3-large` (3072d) 도 매핑되어 있음 |

- 비용: 실측 ~1.8M 토큰 × $0.02/1M ≈ **~$0.04** (1회성). `large` 사용 시 ~$0.23
- 모델 차원이 바뀌면 **`data/rag.db` 삭제 후 재임베딩 필요** (vec0 가상 테이블 차원이 schema 에 고정됨)
- 추후 한국어 정밀도가 부족하다는 측정 결과가 나오면 `bge-m3` self-host 로 교체 — 청크 JSONL 은 모델 독립이라 재임베딩만 필요
- Anthropic API 자체에는 임베딩 엔드포인트가 없어 OpenAI 채택. 운영 성숙도·계정 단순성을 우선시

### 벡터 저장소 (확정)

- `sqlite-vec` 가상 테이블 채택 — `better-sqlite3.loadExtension()` 로 로딩
- `data/rag.db` 로 파일 분리 (운영 상태 `data/bot.db` 와 격리). `ATTACH DATABASE 'data/rag.db' AS rag` 로 동일 커넥션에서 join 가능
- 27k 청크 × 1536d × 4B ≈ ~165MB. brute-force 검색 단일 노드에서 ms 단위 — HNSW 불필요
- 한계 도달 시(수백만 청크) Qdrant / pgvector 로 마이그레이션 — JSONL 산출물 보유로 비용 낮음

## Consequences (예상)

- 청킹 결정론적 → 임베딩 호출 없이 chunk JSONL 산출 가능 (재현·디프 용이)
- 임베딩 비용: 약 ~27k 청크 × 평균 ~500 tok ≈ 13.5M tok × $0.02/1M ≈ **$0.27** (text-embedding-3-small 기준, 1회성)
- rerank 모델은 self-host 시 GPU 권장 — CPU 추론 가능한 경량 reranker(`bge-reranker-base`) 로 시작 가능
- 청크 수가 메시지 수 대비 1.2~1.8배 (윈도우 분할 영향) → 저장·검색 비용 그만큼 증가
- `topic_tags` LLM 라벨링 채택 시 Haiku 1회성 약 ~$1-3 (선택)

## 미결 사항

- [ ] 슬라이딩 윈도우 파라미터 — K(메시지 수), overlap 비율, 토큰 한도 (초기값으로 시작 후 평가셋 측정으로 튜닝)
- [ ] `topic_tags` LLM 라벨링 도입 여부 (precision 추가 이득 vs 1회성 비용)
- [ ] reranker 선택 — `bge-reranker-base` (CPU 가능) vs `bge-reranker-v2-m3` (정확도 ↑, GPU 권장) — retrieval 측정 후 결정
- [ ] 평가 셋 — recall@K / nDCG 측정용 골든 쿼리·정답 페어 작성 주체와 분량
- [ ] 채널 권한/프라이버시 — 운영진 전용 채널이 일반 멤버 쿼리에 노출되지 않게 retrieval 단계에서 ACL 필터 필요 (현재 fetch 산출물에 권한 정보 없음)
- [ ] `kiwi-nlp` 패키지 변종 선택 — 네이티브 바인딩 vs WASM (CI/배포 환경에 따라)
