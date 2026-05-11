---
title: 수동 테스트 시나리오
status: living
last_updated: 2026-05-10
owner: taehyung.koo@musinsa.com
scope: 운영자가 Discord/HTTP에서 각 기능을 직접 검증할 때의 절차
---

# 수동 테스트 시나리오

각 기능을 Discord(또는 curl)에서 한 단계씩 검증하기 위한 체크리스트.
시나리오마다 **사전 준비 → 입력 → 기대 응답 → 검증 포인트 → 정리**로 구성.

---

## 0. 사전 준비 (모든 시나리오 공통)

- [v] `.env.local` 에 필요한 키가 채워져 있음 (시나리오별로 명시)
- [v] `npm install` 완료, `npm run typecheck` 통과
- [v] 새 커맨드/옵션을 추가했다면 `npm run deploy-commands` 실행
- [v] `npm run dev` 로 봇 기동, 로그에 `[INFO] Logged in as ...` 와 `[HTTP] Listening on :3000` 확인
- [v] 봇이 테스트 길드에 초대돼 있고, **테스트 채널에서 사용·메시지 전송 권한** 보유
- [v] (운영 커맨드 테스트 시) 본인 계정에 운영자 역할 부여 — 현재 코드는 역할 체크 미적용이라 누구나 호출 가능. 추후 보강 필요

> 응답이 보이지 않으면 대부분 **slash command 미배포** 또는 **봇 인텐트(GUILD_MEMBERS, MESSAGE_CONTENT) 미활성**이 원인.

---

## 1. `/ping` — 라이브니스

| 항목            | 값              |
|---------------|----------------|
| 필요 credential | Discord 3종만    |
| 영향            | 없음 (read-only) |

### 시나리오 1.1 — 정상 응답

- 입력: `/ping`
- 기대: `Pong! (NN ms)` 형태로 즉시 응답
- 검증: 표시된 ms 가 음수/비정상 큰 값이 아닌지 확인

### 실패 시 점검

- 응답 없음 → 봇 오프라인 / 커맨드 미배포 / 봇이 채널 권한 부족

---

## 2. `/invite-github` — Org 초대

| 항목            | 값                                              |
|---------------|------------------------------------------------|
| 필요 credential | `GITHUB_TOKEN` (`admin:org` 스코프), `GITHUB_ORG` |
| 영향            | **GitHub Org에 실제 초대 메일 발송**                    |

### 시나리오 2.1 — 신규 사용자 초대

- 사전: 본인 또는 테스트 계정 username 준비, 해당 계정이 Org 멤버가 아님
- 입력: `/invite-github username:<github-id>`
- 기대 응답(ephemeral): `✅ <username> 초대를 발송했습니다.`
- 검증:
  - 초대받은 GitHub 계정의 메일/알림 수신
  - GitHub Org → People → Pending Invitations 에 항목 존재

### 시나리오 2.2 — 이미 멤버

- 사전: 이미 Org 멤버인 username
- 기대: `이미 멤버입니다: <username>`

### 시나리오 2.3 — 존재하지 않는 username

- 입력: `/invite-github username:this-user-definitely-does-not-exist-xyz`
- 기대: `사용자를 찾지 못했습니다: ...`

### 정리

- Pending Invitations 에서 테스트 초대 취소

---

## 3. `/create-repo` — Org 레포 생성

| 항목            | 값                                                                                                      |
|---------------|--------------------------------------------------------------------------------------------------------|
| 필요 credential | `GITHUB_TOKEN` (`repo` 스코프), `GITHUB_ORG`, (template 시) `GITHUB_TEMPLATE_OWNER`/`GITHUB_TEMPLATE_REPO` |
| 영향            | **GitHub Org에 실제 레포 생성**                                                                               |

### 시나리오 3.1 — private 레포 생성 (기본)

- 입력: `/create-repo name:test-yapp-bot-<날짜>`
- 기대 응답: `✅ 생성 완료: https://github.com/YAPP-Github/test-yapp-bot-...`
- 검증: GitHub Org 레포 목록에 신규 레포, visibility=Private

### 시나리오 3.2 — public 레포

- 입력: `/create-repo name:test-yapp-bot-pub-<날짜> private:False`
- 검증: visibility=Public

### 시나리오 3.3 — 템플릿 사용

- 사전: `GITHUB_TEMPLATE_OWNER`, `GITHUB_TEMPLATE_REPO` 설정
- 입력: `/create-repo name:test-from-template-<날짜> template:True`
- 검증: 새 레포에 템플릿 파일들이 복사됐는지 확인

### 시나리오 3.4 — 중복 이름

- 입력: 이미 존재하는 레포명
- 기대: `❌ 생성 실패 (...)` 형태의 메시지

### 정리

- 생성된 테스트 레포 삭제 (Settings → Danger Zone)

---

## 4. `/notice` — 주기 공지

| 항목            | 값                                                       |
|---------------|---------------------------------------------------------|
| 필요 credential | Discord 3종                                              |
| 영향            | DB(`scheduled_notice` 테이블) + 매분 reload, cron 매칭 시 채널 게시 |

### 시나리오 4.1 — 매분 공지 등록 (즉시 검증용)

- 사전: 테스트용 채널 ID 복사 (개발자 모드 → 채널 우클릭 → ID 복사)
- 입력: `/notice add title:테스트 content:매분-알림 cron:* * * * * channel:<채널ID>`
- 기대(ephemeral): `✅ 등록 완료 (id=N)`
- 검증:
  - **다음 분 00초**경 해당 채널에 `**테스트**\n매분-알림` 게시
  - 1~2분 더 대기해서 반복 게시되는지 확인

### 시나리오 4.2 — 목록 조회

- 입력: `/notice list`
- 기대: 등록된 공지가 `- [id] ON 제목 (cron) → <#채널>` 형식으로 출력

### 시나리오 4.3 — 비활성화

- 입력: `/notice toggle id:<위에서 만든 id>`
- 기대(ephemeral): `id=N → OFF`
- 검증: 1분 안에 더 이상 매분 게시되지 않음. `/notice list` 에서 `OFF` 표시

### 시나리오 4.4 — 다시 활성화

- 동일 id 로 한 번 더 toggle
- 기대: `ON` 으로 복귀, 매분 게시 재개

### 시나리오 4.5 — 잘못된 cron

- 입력: `/notice add title:x content:x cron:not a cron channel:<채널ID>`
- 기대: `Invalid cron expression: not a cron`

### 정리

- 테스트로 등록한 모든 공지 toggle 해서 OFF 또는 DB 직접 정리
  ```bash
  sqlite3 data/bot.db "DELETE FROM scheduled_notice WHERE title LIKE '테스트%';"
  ```

---

## 5. `/ask` — 자연어 자동화

| 항목            | 값                                         |
|---------------|-------------------------------------------|
| 필요 credential | `ANTHROPIC_API_KEY` + 호출하려는 툴별 credential |
| 영향            | LLM 비용 발생, 툴이 실제 동작 (GitHub 초대 / 채널 생성 등) |

### 시나리오 5.1 — 단순 질의 (실행 툴 없음)

- 입력: `/ask prompt:안녕`
- 기대: `**요약**: ...` + `(실행된 툴 없음)`
- 검증: `agent_session` 테이블에 row 추가됐는지 (선택)
  ```bash
  sqlite3 data/bot.db "SELECT id, input_text, status FROM agent_session ORDER BY id DESC LIMIT 1;"
  ```

### 시나리오 5.2 — 공지 등록 자동화

- 입력: `/ask prompt:매일 오전 9시 #일반 채널에 'standup 시작' 공지를 보내줘. 채널 ID는 <테스트채널ID>야.`
- 기대: `✅ schedule_notice` 가 결과에 포함, `/notice list` 에 새 항목 등장
- 검증: 1분 내 cron 등록, 다음 09:00 게시 (오래 기다리기 어려우면 cron 을 매분으로 요청)

### 시나리오 5.3 — 목록 조회 (이번 PR 신규 툴)

- 입력: `/ask prompt:지금 등록된 공지 모두 보여줘`
- 기대: `✅ list_notices` 가 실행되고 결과 요약에 등록 공지가 등장

### 시나리오 5.4 — 토글 (이번 PR 신규 툴)

- 사전: `/notice list` 로 끄고 싶은 id 확인 (예: 3)
- 입력: `/ask prompt:3번 공지 꺼줘`
- 기대: `✅ toggle_notice` 실행, `/notice list` 에서 해당 id 가 `OFF`

### 시나리오 5.5 — GitHub 초대 자동화

- 입력: `/ask prompt:<github-id> 사용자를 organization 에 초대해줘`
- 기대: `✅ invite_github_user` 실행 + 실제 초대 메일

### 시나리오 5.6 — 채널 생성 자동화

- 입력: `/ask prompt:'study-test' 라는 텍스트 채널을 만들어줘`
- 기대: `✅ create_discord_channel` 실행 + 길드에 신규 채널

### 실패 시 점검

- "처리 중 오류가 발생했습니다" → 봇 콘솔 로그에서 `[ask]` 라인 확인.
  - `ANTHROPIC_API_KEY` 미설정 / 잘못됨 → Claude 호출 실패
  - 툴 핸들러 내부 오류 → `agent_tool_call` 테이블의 `status='failed'` row 확인

### 정리

- 실수로 만들어진 채널/공지/초대 정리

---

## 6. HTTP Admin API — `/api/notices`

| 항목            | 값                                     |
|---------------|---------------------------------------|
| 필요 credential | `ADMIN_API_TOKEN`                     |
| 영향            | DB(`scheduled_notice`) + 1분 내 cron 반영 |

### 시나리오 6.1 — 인증 실패

```bash
curl -i http://localhost:3000/api/notices
# 기대: 401 missing bearer token

curl -i http://localhost:3000/api/notices -H "Authorization: Bearer wrong"
# 기대: 401 invalid token
```

### 시나리오 6.2 — 등록 → 조회 → 토글 → 정리

```bash
TOKEN="$ADMIN_API_TOKEN"
CH="<테스트채널ID>"

# 6.2.1 등록 (201)
curl -s -X POST http://localhost:3000/api/notices \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"title\":\"api-test\",\"content\":\"hello\",\"cron_expr\":\"* * * * *\",\"channel_id\":\"$CH\"}"

# 6.2.2 목록
curl -s http://localhost:3000/api/notices -H "Authorization: Bearer $TOKEN"

# 6.2.3 토글 (id 는 위 응답에서 확인)
curl -s -X POST http://localhost:3000/api/notices/<id>/toggle -H "Authorization: Bearer $TOKEN"
```

### 시나리오 6.3 — 검증 실패 케이스

- 누락 필드: `-d '{"title":"only"}'` → 400
- 잘못된 cron: `cron_expr=nonsense` → 400
- 없는 id 토글: `/api/notices/99999/toggle` → 404

---

## 7. Google Form 웹훅 — `/webhooks/google-form`

| 항목            | 값                                                       |
|---------------|---------------------------------------------------------|
| 필요 credential | `GOOGLE_FORM_WEBHOOK_SECRET`, GitHub/Discord credential |
| 영향            | Discord 채널 생성 + GitHub Org 초대                           |

직접 Apps Script 트리거 대신 curl 로 시뮬레이션.

### 시나리오 7.1 — 정상 페이로드

```bash
SECRET="$GOOGLE_FORM_WEBHOOK_SECRET"
TS=$(date +%s%3N)
BODY='{"form_id":"f1","timestamp":"'$(date -u +%FT%TZ)'","answers":{"team_name":"Alpha","github_id":"<github-id>"},"idempotency_key":"manual-test-1"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

curl -s -X POST http://localhost:3000/webhooks/google-form \
  -H "X-Signature: $SIG" -H "X-Timestamp: $TS" -H "Content-Type: application/json" \
  -d "$BODY"
```

- 기대: `{"status":"done", "handlers":[...]}` 같은 응답
- 검증: Discord 길드에 `team-alpha` 류 채널 생성, GitHub Org 에 초대 발송

### 시나리오 7.2 — 서명 누락 / 잘못된 서명 / 오래된 timestamp → 401

- 헤더 빼고 호출: 401 missing signature
- 임의 값: 401 bad signature
- `TS=$(($(date +%s%3N) - 600000))` (10분 전): 401 stale timestamp

### 시나리오 7.3 — idempotency

- 같은 `idempotency_key` 로 두 번 POST → 두 번째는 중복 처리 차단(같은 채널/초대가 또 만들어지지 않음)

### 정리

- 테스트 채널/초대 삭제

---

## 8. Google Calendar 일일 디지털

| 항목            | 값                                                                                 |
|---------------|-----------------------------------------------------------------------------------|
| 필요 credential | `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_CALENDAR_IDS`, `DISCORD_NOTICE_CHANNEL_ID` |
| 영향            | 매일 09:00 KST 채널에 임베드 게시                                                           |

### 시나리오 8.1 — 정상 시점 게시 (관찰형)

- 사전: 캘린더에 오늘 일정 1~2개 추가, 서비스 계정 이메일을 캘린더에 공유
- 09:00 KST 에 `DISCORD_NOTICE_CHANNEL_ID` 채널에 디지털 임베드 게시
- 검증: 게시 1회만 (`calendar_event_cache` 로 중복 방지)

### 시나리오 8.2 — 즉시 검증

스케줄러를 09:00까지 기다리기 어려우면 봇 콘솔에서 직접 호출:

```ts
// 임시 디버그 코드 (본 코드에 커밋 금지)
import * as cal from "./services/calendarService.js";

cal.sendDailyDigest(client, process.env.DISCORD_NOTICE_CHANNEL_ID);
```

또는 `/ask prompt:오늘 캘린더 일정 보여줘` 로 `list_calendar_events` 툴 호출 (디지털 게시는 아니지만 인증/조회 동작 확인용)

### 시나리오 8.3 — credential 미설정 시 스킵

- `GOOGLE_CALENDAR_IDS` 비움 → 봇 시작 로그에 `[calendar] No GOOGLE_CALENDAR_IDS configured, skipping`
- `DISCORD_NOTICE_CHANNEL_ID` 비움 →
  `[calendar] DISCORD_NOTICE_CHANNEL_ID not set, skipping scheduler`

---

## 9. 종합 회귀 (한 번에 훑기)

릴리즈 직전 5분 안에 도는 빠른 점검:

1. `/ping` → Pong
2. `/notice add ... cron:* * * * * ...` → 다음 분 게시 확인 → `/notice toggle id:N` 으로 정지
3. `/ask prompt:지금 등록된 공지 보여줘` → list_notices 결과
4. `curl /api/notices -H "Authorization: Bearer $ADMIN_API_TOKEN"` → 200
5. 봇 콘솔에 에러 로그 없음

---

## DB 청소 스니펫

테스트 흔적이 남았을 때:

```bash
sqlite3 data/bot.db "DELETE FROM scheduled_notice WHERE title LIKE '%test%' OR title LIKE '%테스트%';"
sqlite3 data/bot.db "DELETE FROM form_submission WHERE idempotency_key LIKE 'manual-test%';"
sqlite3 data/bot.db "DELETE FROM agent_session WHERE input_text LIKE '%테스트%';"
```
