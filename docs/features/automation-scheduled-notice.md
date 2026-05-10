---
title: 주기 공지 스케줄러
status: implemented
last_updated: 2026-05-10
owner: taehyung.koo@musinsa.com
parent: docs/features/automation-platform-plan.md
phase: 3
required_credentials:
  - DISCORD_TOKEN
  - DISCORD_GUILD_ID
  - ADMIN_API_TOKEN  # /api/notices 엔드포인트 사용 시
---

# LLD — 주기 공지 스케줄러

> **상태**: implemented
> **최종 수정**: 2026-05-10

---

## 개요

`node-cron` 기반 cron으로 등록된 공지를 Discord 채널에 자동 발송한다. 정적 하드코딩이 아니라 DB 테이블에 동적 등록하여 운영자가 슬래시 커맨드로 관리할 수 있게 한다.

## 목표

- 운영자가 코드 수정 없이 공지 추가/수정/비활성화 가능
- 다양한 외부 이벤트(Webhook)도 동일 발송 경로로 통합

## 진입점

같은 `noticeService`를 세 가지 인터페이스가 공유한다.

### 1. Discord 슬래시 커맨드

| 커맨드 | 설명 | 권한 |
|--------|------|------|
| `/notice add` | 새 공지 등록 (제목/내용/cron/채널) | 운영진 |
| `/notice list` | 활성 공지 목록 | 운영진 |
| `/notice toggle <id>` | 활성/비활성 전환 | 운영진 |

### 2. HTTP Admin API

`Authorization: Bearer ${ADMIN_API_TOKEN}` 헤더 필수. 토큰 미설정 시 모든 요청 401.
타이밍 공격 방지를 위해 `crypto.timingSafeEqual` 비교.

| Method | Path | Body | 응답 |
|--------|------|------|------|
| `POST` | `/api/notices` | `{ title, content, cron_expr, channel_id }` | 201 + 생성된 row / 400 (cron invalid 등) |
| `GET` | `/api/notices` | — | 200 + 목록 |
| `POST` | `/api/notices/:id/toggle` | — | 200 + 갱신된 row / 404 |

### 3. 자연어 (`/ask` → toolRegistry)

| 툴 | 입력 | 동작 |
|----|------|------|
| `schedule_notice` | `{ title, content, cron_expr, channel_id }` | `noticeService.create()` |
| `list_notices` | — | `noticeService.list()` |
| `toggle_notice` | `{ id }` | `noticeService.toggle()` |

세 진입점 모두 DB만 갱신하고 — `noticeScheduler`가 매분 reload하므로 실제 cron 등록/해제는 1분 안에 반영된다.

## 구현 위치

- `schedulers/noticeScheduler.ts` — 공지 cron 등록 진입점, 매분 reload
- `services/noticeService.ts` — 공지 CRUD 유스케이스
- `db/repositories/scheduledNoticeRepository.ts` — DB 접근
- `commands/notice.ts` — 슬래시 커맨드 핸들러
- `http/noticeApi.ts` — Bearer 인증 + REST 핸들러
- `services/agent/toolRegistry.ts` — `schedule_notice` / `list_notices` / `toggle_notice` 툴 정의

## DB 스키마

```sql
CREATE TABLE scheduled_notice (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  cron_expr TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## 데이터 흐름

```
[node-cron tick (1분 단위)]
  → schedulers/noticeScheduler.ts
  → services/noticeService.ts
      ├─ enabled=1 인 공지 중 cron 매칭 항목 조회
      └─ Discord 클라이언트로 채널 메시지 전송
  → last_run_at 갱신
```

## 통합 알림 경로

스케줄 외에도 동일 service 모듈을 재사용한다.

| 트리거 | 처리 |
|--------|------|
| GitHub Actions 실패 webhook | `http/githubWebhook.ts` → `noticeService` |
| PR open/review | `http/githubWebhook.ts` → 리뷰 요청 채널 |
| 회의 D-1 | 캘린더 연동(Phase 5) → 공지 채널 |
| 배포 완료 | webhook → 공지 채널 |

## 에러 처리

| 상황 | 처리 방식 |
|------|----------|
| Discord 채널 삭제됨 | 해당 공지 자동 disable + 운영자 alert |
| cron 표현식 invalid | 등록 시 검증, 런타임 시 skip |
| 메시지 길이 초과 (>2000자) | 자동 분할 발송 |

## 미결 사항

- [ ] 공지 등록을 슬래시 커맨드로만 할지, 별도 웹 UI를 제공할지
- [ ] 공지 미리보기/예약 발송 기능 필요 여부
- [ ] 멘션(@everyone, role mention) 권한 체크 정책
