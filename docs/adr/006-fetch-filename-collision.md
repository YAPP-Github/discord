---
title: fetch-messages 파일명 충돌 대응 — channel_id 기반 파일명
status: draft
last_updated: 2026-05-12
owner: taehyung.koo@musinsa.com
related:
  - docs/features/fetch-messages.md
  - docs/features/consolidate-messages.md
  - docs/features/rag-ingestion.md
  - docs/adr/005-rag-chunking-strategy.md
---

# ADR-006 — fetch-messages 파일명 충돌 대응

> **상태**: draft

## Context

`src/scripts/fetch-messages.ts` 가 채널·쓰레드 데이터를 디스크에 쓸 때 파일명을 **채널 이름만으로** 생성한다.

```ts
// src/scripts/fetch-messages.ts:407
writeFileSync(join(EXPORT_DIR, "channels", `${sanitize(ch.name)}.json`), ...)
// src/scripts/fetch-messages.ts:452
writeFileSync(join(EXPORT_DIR, "threads", sanitize(ch.name), `${sanitize(thread.name)}.json`), ...)
```

`sanitize()` 는:

```ts
function sanitize(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9가-힣_-]/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase();
}
```

이모지·특수문자가 모두 `_` 로 치환되고 lowercase 되므로, Discord 상 **이름이 같은 채널이 여러 개**인 경우(예: 23/24/25/26/27기 마다 존재하는 `🙄-질문게시판`) 모두 동일 파일명으로 수렴 → **뒤에 처리된 채널이 앞 채널을 덮어쓴다**.

### 측정된 손실 (현재 시점, 2026-05-12)

- `fetch-summary.json` 의 채널 162개, 메시지 합계 15,244 / thread 메시지 합계 12,666
- 디스크의 `channels/` 118 파일 / 메시지 14,879 — `consolidated` 도 동일 손실 (consolidated 자체는 정상 동작; 입력이 이미 손실됨)
- 충돌 키 15개 — 가장 심한 케이스:

| 사니타이즈 키 | 충돌 채널 수 | 잃는 데이터 (msgs / thread_msgs) |
|---|---|---|
| `_질문게시판` | 6 | 162+594 중 마지막 처리분만 |
| `_번개-모집` | 5 | 0+447 중 일부 |
| `_출결-보고` | 6 | 0+800 중 일부 |
| `_회계-관련` | 5 | 29+95 |
| `_회고-모임` | 4 | 98+157 |
| 그 외 10개 키 | 2~4 |  |

RAG 코퍼스 품질에 직격탄이며 ADR-005 의 검색 정확도 평가 이전에 해소해야 한다.

## Considered Options

### A. 그대로 두고 RAG 만 진행

- 장점: 즉시 시작
- 단점: 코퍼스 손상 — "23기 vs 25기 질문게시판" 같은 비교 쿼리는 구조적으로 답할 수 없음. ADR-005 의 `generation` 메타데이터 필터도 의미 없어짐 (애초에 23기 데이터가 없는 채널이 다수)

### B. 파일명에 `channel_id` 접미사 추가

```ts
`${sanitize(ch.name)}-${ch.id}.json`
// 예: _질문게시판-1162365837760548955.json
```

- 장점: 사람이 읽을 수 있는 이름 유지, 충돌 0
- 단점: `consolidate-messages` 가 파일명에서 `channel_id` 를 떼어내거나 JSON 내부 메타로부터 채널 식별을 새로 짜야 함. 두 스크립트의 파일명 규약을 같이 변경해야 함

### C. 파일명 = `channel_id` 만 사용

```ts
`${ch.id}.json`
// 예: 1162365837760548955.json
```

- 장점: 가장 단순·결정적, 충돌 원천 차단
- 단점: 디렉터리를 사람이 훑기 불편 (`ls` 결과가 ID 나열). 다만 JSON 내부에 `channel_name` 이 이미 있어 grep 으로 매핑 가능

### D. 디렉토리 한 단계 추가: `{channel_id}/{name}.json`

```text
channels/
  1162365837760548955/
    질문게시판.json
threads/
  1162365837910558123/...
```

- 장점: ID 키 + 사람이 읽을 수 있는 이름 동시 보존
- 단점: 디렉토리 깊이 증가, consolidate / RAG 스크립트가 디렉토리 스캔 로직을 변경해야 함

## Decision (draft)

**옵션 B — `${sanitize(ch.name)}-${ch.id}.json`** 채택을 우선 검토.

근거:

1. 사람이 디렉터리 훑을 때 채널 식별이 즉시 가능 (운영·디버깅 편의)
2. 파일명 끝의 ID 만 정규식으로 떼어내면 되므로 consolidate 쪽 변경이 최소
3. 향후 RAG `channel_id` 메타데이터가 정확한 키로 작동 — ADR-005 의 ACL/필터 모두 정상 작동

대안 C 도 충분히 매력적 (가장 단순) — 운영 편의를 포기할 수 있다면 더 깔끔. 결정 시점에 다시 논의.

## 영향 범위

다음 파일/스크립트가 동시 변경 대상:

- `src/scripts/fetch-messages.ts` — 파일명 규약 변경
- `src/scripts/consolidate-messages.ts` — 파일명에서 채널 식별 + 매칭 로직 변경 (또는 JSON 내부 메타에서 식별)
- 기존 `data/export/` 산출물 — 재수집(wipe & refetch). consolidate 는 결정론적이라 재수집 후 한 번 더 실행하면 정상화

## 마이그레이션 절차 (안)

1. ADR 확정 후 `fetch-messages.ts` 의 파일명 규약 변경 + `consolidate-messages.ts` 동기 수정
2. `data/export/channels/`, `data/export/threads/`, `data/export/consolidated/` 전체 삭제
3. `npm run fetch-messages` → `npm run consolidate-messages` 재실행
4. `fetch-summary.json` 의 채널·메시지·thread 메시지 합계가 디스크 합계와 일치하는지 검증 (간단한 verify 스크립트 추가 권장)
5. RAG 인덱싱 (ADR-005) 진행

## Consequences (예상)

- 1회성 재수집 비용 — Discord REST API 호출 162채널 × (메시지+쓰레드). 기존 fetch-messages 의 실행 시간만큼 소요
- 디스크 산출물의 git diff 가 클 수 있음 (이름이 다 바뀜) — gitignore 대상이라면 무관
- 기존 산출물을 외부에서 참조하는 다운스트림이 있다면 같이 갱신 필요 (현재는 consolidate 외 없음)

## 미결 사항

- [ ] 옵션 B vs C 최종 선택
- [ ] 재수집을 한 번에 끝낼지, 손실이 심한 키부터 부분 재수집할지 (현재 fetch 는 부분 실행 미지원 — 변경 비용 발생)
- [ ] verify 스크립트 도입 (`fetch-summary` ↔ 디스크 일관성 자동 체크) 여부
