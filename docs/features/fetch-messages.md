# LLD — Discord 메시지 수집 스크립트

> **관련 이슈**: -
> **상태**: approved
> **최종 수정**: 2026-05-01

---

## 개요

YAPP Discord 서버의 지정 채널 메시지와 쓰레드를 RAG(Retrieval Augmented Generation) 파이프라인 구축을 위해 JSON으로 수출하는 일회성 스크립트. `npm run fetch-messages`로 실행하며 결과를 `data/export/` 디렉토리에 저장한다.

## 목표

- YAPP 운영 관련 채널의 메시지·쓰레드를 전수 수집
- RAG ingestion에 적합한 구조화 JSON 생성
- 어떤 벡터 DB로도 바로 적재 가능한 포맷 유지

## 범위 (Scope)

**포함**:
- 공지사항 채널 메시지
- 운영·운영진 채널 메시지 (회계·정산 포함)
- 출결 보고 채널
- 스터디 보고 채널
- 회고 모임 채널
- 위 채널들의 쓰레드(활성 + 아카이브)

**제외**:
- 자유채팅 성격의 채널 (질문/답변 패턴 데이터로 부적합)
- 음성 채널, 카테고리, DM
- 커스텀 서버 이모지의 감정 분류 (neutral 처리)

---

## 기술 결정

### REST API vs Discord Gateway (Client)

**결정: REST API 직접 호출**

Gateway는 WebSocket 연결 유지가 필요하고 Privileged Intent(MESSAGE_CONTENT) 설정이 복잡하다. 일회성 배치 스크립트는 REST만으로 충분하며, 기존 `src/deploy-commands.ts`의 패턴(REST 객체 생성 후 호출)을 그대로 재사용할 수 있다.

### JSON 파일 출력 vs SQLite 저장

**결정: JSON 파일 출력**

RAG 파이프라인의 벡터 DB(Pinecone, Weaviate, Chroma 등)가 미정이므로 가장 범용적인 JSON으로 출력한다. 파일 단위로 분리해 채널·쓰레드별 선택적 ingestion이 가능하다.

### 채널 포함/제외 기준

**결정: 채널 이름 기반 정규식 필터**

| 채널 유형 | 수집 | 근거 |
|----------|------|------|
| 공지사항 | ✅ | 포맷 학습 + RAG |
| 자유채팅 | ❌ | 비정형 잡담, Q&A 패턴 부적합 |
| XX기-운영 (회계·정산 포함) | ✅ | 운영 의사결정 + RAG |
| 출결 보고 | ✅ | 보고 포맷 학습 |
| 스터디 보고 | ✅ | 학습 보고 포맷 + RAG |
| 회고 모임 | ✅ | 회고 패턴 RAG |

### Emoji 감정 분류

**결정: Positive/Negative/Neutral 3분류**

리액션 이모지를 감정별로 집계해 텍스트 외 신호(engagement quality)를 RAG 메타데이터로 활용할 수 있게 한다. 커스텀 서버 이모지는 neutral 처리(분류 불가).

---

## 데이터 흐름

```
npm run fetch-messages
  → Discord REST API: GET /guilds/{id}/channels
  → 채널 타입/이름 필터링
  → 각 채널:
      → GET /channels/{id}/messages (100개씩 페이지네이션)
      → GET /guilds/{id}/threads/active (전체 활성 쓰레드)
      → GET /channels/{id}/threads/archived/public (아카이브 쓰레드)
      → 각 쓰레드: GET /channels/{thread.id}/messages
  → data/export/ 에 JSON 저장
```

---

## 출력 구조

```
data/export/
  fetch-summary.json          # 수집 요약 (채널별 메시지·쓰레드 수)
  channels/
    {channel-name}.json       # 채널 직접 메시지 배열
  threads/
    {channel-name}/
      {thread-name}.json      # 쓰레드 메시지 배열
```

### 메시지 레코드 스키마

```json
{
  "id": "snowflake",
  "channel_id": "snowflake",
  "channel_name": "채널명",
  "thread_id": "snowflake (쓰레드 메시지만)",
  "thread_name": "쓰레드명 (쓰레드 메시지만)",
  "author_id": "snowflake",
  "author_name": "username",
  "content": "메시지 본문",
  "timestamp": "ISO 8601",
  "reactions": {
    "positive_count": 5,
    "negative_count": 0,
    "details": [
      { "emoji": "👍", "count": 5, "sentiment": "positive" }
    ]
  },
  "attachments": ["https://cdn.discordapp.com/..."]
}
```

---

## 에러 처리

| 상황 | 처리 방식 |
|------|----------|
| 채널 메시지 fetch 실패 (권한 없음 등) | 로그 후 다음 채널 계속 |
| 쓰레드 메시지 fetch 실패 | 로그 후 다음 쓰레드 계속 |
| Rate Limit (429) | discord.js REST가 자동 retry |
| 필수 환경 변수 누락 | config.ts에서 시작 시 예외 발생 |

---

## 실행 방법

```bash
# 개발 환경
npm run fetch-messages

# 프로덕션 환경
npm run fetch-messages:prod
```

---

## 미결 사항 (Open Questions)

- [ ] 최종 벡터 DB 선정 후 ingestion 스크립트 별도 작성 필요
- [ ] 수집 대상 채널 목록 확정 (현재 이름 패턴 기반, 나중에 ID 화이트리스트로 전환 가능)
