---
title: Google Calendar 연동
status: draft
last_updated: 2026-05-08
owner: taehyung.koo@musinsa.com
parent: docs/features/automation-platform-plan.md
phase: 5
required_credentials:
  - GOOGLE_SERVICE_ACCOUNT_JSON
  - GOOGLE_CALENDAR_IDS
  - DISCORD_TOKEN
  - DISCORD_GUILD_ID
---

# LLD — Google Calendar 연동

> **상태**: draft
> **최종 수정**: 2026-05-08

---

## 개요

Google Calendar에 등록된 일정을 주기적으로 조회하여 Discord 공지 채널에 자동 발송한다. 매일 일정 요약, 시작 10분 전 리마인드를 기본 제공한다.

## 목표

- 운영진이 별도 공지 작성 없이 캘린더 등록만으로 알림 자동화
- Service Account 기반 — 사용자 OAuth 의존성 제거

## 인증

- 인증 방식: Google Service Account
- 대상 캘린더를 서비스 계정 이메일과 **Viewer 권한**으로 공유
- 키 파일은 vault 또는 권한 제한된 디렉터리 보관, 절대 커밋 금지

## API

| 작업 | API |
|------|-----|
| 일정 조회 | `GET /calendar/v3/calendars/{calendarId}/events?timeMin=&timeMax=&singleEvents=true&orderBy=startTime` |

## 구현 위치

- `schedulers/calendarScheduler.ts` — node-cron 진입점 (일일 + 매분 tick)
- `services/calendarService.ts` — 일정 조회/포맷/리마인드 유스케이스
- `integrations/google/calendarClient.ts` — Service Account 인증 + Calendar API
- `db/repositories/calendarEventCacheRepository.ts`

## 데이터 흐름

```
[node-cron 매일 09:00]
  → schedulers/calendarScheduler.ts
  → services/calendarService.ts
      ├─ GOOGLE_CALENDAR_IDS 순회
      ├─ integrations/google/calendarClient.ts → 오늘 일정 조회
      └─ Discord 공지 채널로 포맷팅 메시지 전송

[node-cron 매분]
  → 다음 10분 이내 시작 일정 조회 (cache 비교)
  → 새 항목만 리마인드 메시지 발송
```

## 출력 메시지 예시

```
📅 오늘 일정
- 14:00 백엔드 회의
- 16:30 검색팀 세미나
- 19:00 스터디

회의 링크:
https://meet.google.com/...
```

## DB 스키마

```sql
CREATE TABLE calendar_event_cache (
  id BIGINT PRIMARY KEY,
  calendar_id VARCHAR(200),
  event_id VARCHAR(200),
  start_time TIMESTAMP,
  reminded_at TIMESTAMP,
  UNIQUE(calendar_id, event_id)
);
```

## Google Meet 링크 추출

- `event.conferenceData.entryPoints[*].uri` 우선
- 없으면 `event.hangoutLink`
- 없으면 `event.description` 정규식 fallback

## 에러 처리

| 상황 | 처리 방식 |
|------|----------|
| 캘린더 권한 없음 | 시작 시 self-check 후 운영자 멘션, 해당 캘린더 skip |
| API rate limit | exponential backoff |
| Service Account 키 만료 | 인증 실패 시 운영 채널 alert |
| 일정 시간 변경 | event_id 동일 + start_time 변경 감지 시 리마인드 재예약 |

## 미결 사항

- [ ] 리마인드 주기 — 10분 전 외에 1시간 전도 추가할지
- [ ] 모든 일정을 다 보낼지, 특정 라벨/태그만 필터링할지
- [ ] 참석자 멘션을 어떻게 매핑할지 (구글 이메일 → Discord ID)
