# LLD — 채널·쓰레드 통합 스크립트

> **관련 이슈**: -
> **상태**: approved
> **최종 수정**: 2026-05-03

---

## 개요

`fetch-messages` 가 생성한 `data/export/channels/` 와 `data/export/threads/` 를 읽어, 부모 메시지와 그 메시지에서 시작된 쓰레드 replies 를 **하나의 nested 문서**로 합친 결과를 `data/export/consolidated/` 에 저장하는 변환 스크립트. RAG ingestion 에서 starter + thread 를 한 단위로 처리할 수 있게 한다.

## 목표

- 1:N (메시지 ↔ 쓰레드 replies) 관계를 단일 문서로 표현
- RAG 파이프라인에서 join 없이 self-contained 한 청크 단위 확보
- 원본 데이터 (`channels/`, `threads/`) 를 손대지 않는 read-only 변환

## 범위 (Scope)

**포함**:
- `channels/*.json` 의 모든 메시지를 base 로 사용
- `threads/{channel}/*.json` 의 replies 를 매칭되는 parent 메시지에 nested 로 attach
- forum 채널 / starter 가 삭제된 케이스: 첫 thread 메시지를 starter 로 승격

**제외**:
- Discord API 직접 호출 (이 스크립트는 파일만 읽고 씀)
- 기존 출력의 부분 갱신 (매번 wipe & rebuild)

---

## 기술 결정

### 통합 vs 분리 보존

**결정: nested 통합 (data/export/consolidated/ 별도 산출물)**

쓰레드 양이 한 채널당 적고 (평균 10~20개), 1:N 관계라 nested 가 자연스럽다. 분리해 두면 RAG 인덱싱 시 매번 join 이 필요해 파이프라인이 복잡해진다. 단, 원본 (`channels/`, `threads/`) 은 손실 위험을 피하기 위해 **읽기 전용으로만 사용**하고 별도 출력 디렉토리에 새로 만든다.

### 멱등성: wipe & rebuild

**결정: 매 실행마다 `consolidated/` 전체 삭제 후 재생성**

per-file 덮어쓰기만 하면 입력에 없는 채널의 stale 출력이 잔존한다 (채널 삭제·이름 변경 시). `consolidated/` 는 `channels/` + `threads/` 로부터 계산되는 **derived view** 이므로 매번 새로 만드는 것이 가장 안전하고 단순하다. Discord API 호출이 없어 비용도 거의 없음 (100채널 ~ 수 초).

### Starter 매칭 전략

**결정: `thread.id == starter_message.id` 우선, 실패 시 첫 reply 를 starter 로 승격**

Discord 규칙상 텍스트 채널 쓰레드는 그 시작 메시지의 ID 를 그대로 사용한다 → 일치하는 parent 메시지를 찾으면 정상 매칭. 매칭 실패는 두 케이스:
- 포럼 채널: 부모 채널에 메시지가 없고 thread 의 첫 메시지가 post body
- 텍스트 채널이지만 starter 가 삭제됨: 고아 쓰레드

두 경우 모두 첫 thread 메시지를 starter 로 승격해 동일한 nested 구조를 유지한다.

### nested 메시지 필드 축약

**결정: nested replies 에서는 `channel_id`, `channel_name`, `thread_id`, `thread_name` 제거**

부모 entry 와 thread 메타에 동일 정보가 이미 존재 → 중복 제거로 출력 크기 절감. RAG 청크 단위 메타데이터는 부모 메시지 객체에서 일괄 추출 가능.

---

## 데이터 흐름

```
npm run consolidate-messages
  → data/export/consolidated/ 전체 삭제 (멱등성)
  → data/export/channels/ + data/export/threads/ 디렉토리 스캔
  → 채널 단위로 처리:
      → channels/{X}.json 읽어 base 배열 생성
      → threads/{X}/*.json 각각 로드
      → thread_id 와 일치하는 parent 메시지 찾기
          ✓ 매칭: parent.thread = { messages: replies } 로 중첩
          ✗ 미매칭 (forum / 고아): 첫 reply 를 starter 로 승격해 새 entry 추가
      → snowflake ID 오름차순 정렬
      → consolidated/{X}.json 저장
```

---

## 입력

```
data/export/
├── channels/{channel-name}.json   # MessageRecord[] (fetch-messages 출력)
└── threads/{channel-name}/{thread-name}.json   # MessageRecord[]
```

## 출력 구조

```
data/export/consolidated/
└── {channel-name}.json            # ConsolidatedMessage[]
```

### ConsolidatedMessage 스키마

```json
{
  "id": "snowflake",
  "channel_id": "...",
  "channel_name": "...",
  "author_id": "...",
  "author_name": "...",
  "content": "...",
  "timestamp": "ISO 8601",
  "reply_to_id": "snowflake (옵션)",
  "reactions": { "positive_count": 0, "negative_count": 0, "details": [] },
  "attachments": [],
  "embeds": [...] ,
  "thread": {
    "id": "thread snowflake",
    "name": "thread name",
    "messages": [
      {
        "id": "...",
        "author_id": "...",
        "author_name": "...",
        "content": "...",
        "timestamp": "...",
        "reactions": {...},
        "attachments": [...]
      }
    ]
  }
}
```

`thread` 필드는 쓰레드가 달린 메시지에만 존재한다. nested `messages` 에서는 `channel_*`, `thread_*` 필드를 생략한다.

---

## 멱등성 / 안전성

| 항목 | 동작 |
|------|------|
| 동일 입력 재실행 | 동일 출력 (정렬 + JSON.stringify 안정) |
| 채널이 입력에서 사라짐 | 다음 실행에서 stale 출력 자동 제거 (wipe) |
| 원본 데이터 변경 | 영향 없음 (스크립트는 read-only) |
| 부분 실행 | 지원 안 함 — 매번 전체 재빌드 |

**원본 손상 위험 없음**: `channels/` 와 `threads/` 는 읽기만 한다.

---

## 에러 처리

| 상황 | 처리 방식 |
|------|----------|
| `data/export/` 자체 미존재 | 즉시 종료 (exit 1) |
| 쓰레드 파일에 `thread_id`/`thread_name` 누락 | 해당 파일 skip + warn 로그 |
| 빈 쓰레드 파일 | skip |

---

## 실행 방법

```bash
# fetch-messages 가 먼저 실행되어 있어야 함
npm run consolidate-messages
```

환경 변수 불필요 (Discord API 호출 없음).

---

## 미결 사항 (Open Questions)

- [ ] consolidated 와 fetch 산출물을 함께 산출하는 단일 명령으로 통합할지 (현재는 2-step)
