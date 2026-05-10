# HLD (High-Level Design) — YAPP Discord Bot

## 프로젝트 개요

YAPP 커뮤니티를 위한 Discord 봇이자 운영 자동화 플랫폼.
GitHub Organization 멤버 관리, Google Form 기반 프로비저닝, Google Calendar 동기화,
주기 공지, Claude 기반 자연어 인터페이스 등 커뮤니티 운영 자동화를 목표로 한다.

---

## 시스템 아키텍처

```
       Discord Server                 Google Apps Script        외부 운영자/멤버
       (Slash / Events)               (Form 제출 트리거)              │
              │                                │                      │
              │ discord.js v14                 │ HMAC-signed POST     │
              ▼                                ▼                      │
   ┌────────────────────────┐    ┌──────────────────────────┐         │
   │      BotClient          │    │   Express HTTP Server     │◀───────┘
   │ ┌────────────┐ ┌──────┐ │    │  /healthz                 │
   │ │Cmd Loader  │ │ Evt  │ │    │  /webhooks/google-form    │
   │ │src/commands│ │Loader│ │    └──────────┬───────────────┘
   │ └─────┬──────┘ └──┬───┘ │               │
   │       └────┬──────┘     │               │
   │            ▼            │               │
   │      Schedulers (cron)  │               │
   │  ┌──────────────────┐   │               │
   │  │ noticeScheduler  │   │               │
   │  │ calendarScheduler│   │               │
   │  └──────────────────┘   │               │
   └────────────┬────────────┘               │
                │                            │
        ┌───────┴───────┬────────┬───────────┴──────────┐
        ▼               ▼        ▼                      ▼
  ┌──────────┐  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐
  │ SQLite   │  │ Services /  │  │ Integrations │  │ Anthropic Claude │
  │(better-  │  │  Agent      │  │ ─ GitHub     │  │ (Tool calling →  │
  │ sqlite3) │  │ (toolReg.)  │  │ ─ Google     │  │  Plan & execute) │
  └──────────┘  └─────────────┘  └──────────────┘  └──────────────────┘
```

- **BotClient**: Discord Gateway 연결, 슬래시 커맨드/이벤트 디스패치
- **Express HTTP**: Google Form 웹훅 수신 + 헬스체크
- **Schedulers**: node-cron 기반, DB의 공지 정의 / Calendar 일정을 주기 처리
- **Services / Agent**: 도메인 비즈니스 로직 + LLM 툴 콜링 어댑터
- **Integrations**: 외부 SDK 호출 캡슐화 (Octokit, googleapis)

---

## 컴포넌트

### BotClient (`src/client.ts`)
- `discord.js Client` 확장
- `Collection<string, Command>` 로 커맨드 저장
- Gateway Intents: Guilds, GuildMessages, MessageContent, GuildMembers

### Command / Event 로더 (`src/loaders/`)
- 디렉토리 스캔 방식 동적 자동 등록
- 새 커맨드/이벤트는 파일 추가만으로 반영됨

### HTTP 서버 (`src/http/`)
- `express` 기반, 시작 시 `startHttpServer(client, port)` 호출
- `GET /healthz` — 라이브니스
- `POST /webhooks/google-form` — Apps Script가 보내는 폼 제출 이벤트 수신.
  `X-Signature` (HMAC-SHA256), `X-Timestamp` 검증 + 5분 허용창 + idempotency key
- `POST /api/notices`, `GET /api/notices`, `POST /api/notices/:id/toggle` —
  주기 공지 관리. `Authorization: Bearer ${ADMIN_API_TOKEN}` 필수
  (timingSafeEqual 비교, 토큰 미설정 시 401)

### 스케줄러 (`src/schedulers/`)
- `noticeScheduler` — DB의 활성 공지를 매분 reload, cron 표현식대로 채널에 게시
- `calendarScheduler` — 매일 09:00 KST에 캘린더 일정을 디지털 메시지로 게시 (`Asia/Seoul` TZ)
- `GOOGLE_CALENDAR_IDS` / `DISCORD_NOTICE_CHANNEL_ID` 미설정 시 자동 스킵

### SQLite DB (`src/db/`)
- WAL 모드, 외래키 활성화, 싱글톤 (`getDatabase()`)
- 마이그레이션: `src/db/schema.ts`의 `runMigrations()`
- 레포지토리: `src/db/repositories/`
  - `scheduledNoticeRepository` — 주기 공지 정의
  - `formSubmissionRepository` — Google Form 멱등 처리
  - `calendarEventCacheRepository` — 캘린더 이벤트 캐시 / 중복 게시 방지
  - `agentRepository` — LLM 에이전트 세션·툴 콜 로그

### 도메인 서비스 (`src/services/`)
| 모듈 | 역할 |
|------|------|
| `claude.ts` | Anthropic SDK 클라이언트 싱글톤 |
| `agentService.ts` | LLM 플래닝 → 툴 실행 → 결과 요약 (Phase 6) |
| `agent/toolRegistry.ts` | 에이전트가 호출 가능한 툴 정의 (`invite_github_user`, `create_github_repo`, `create_discord_channel`, `schedule_notice`, `list_notices`, `toggle_notice`, `list_calendar_events`) |
| `githubOrgService.ts` | GitHub Org 초대 / 레포 생성 |
| `discordChannelService.ts` | 채널 생성 등 Discord 자원 조작 |
| `noticeService.ts` | 주기 공지 CRUD + 발송 |
| `calendarService.ts` | Google Calendar 조회 + 디지털 |
| `formProvisioningService.ts` | Form 제출 → Discord/GitHub 프로비저닝 |

### 외부 통합 (`src/integrations/`)
- `github/orgClient.ts` — Octokit REST 래퍼
- `google/calendarClient.ts` — googleapis Calendar v3 + Service Account 인증

---

## 기술 스택

| 항목 | 기술 |
|------|------|
| 런타임 | Node.js ≥20 (ESM) |
| 언어 | TypeScript 5 |
| Discord | discord.js v14 |
| HTTP | express 5 |
| DB | better-sqlite3 (SQLite, WAL) |
| 스케줄링 | node-cron |
| AI | Anthropic Claude API (`@anthropic-ai/sdk`) |
| GitHub | `@octokit/rest` |
| Google | `googleapis` (Calendar v3, Service Account) |
| 환경설정 | dotenv (`.env.local` / `.env.prod`) |

---

## 데이터 흐름

### 슬래시 커맨드
```
사용자 /command
  → Discord Gateway
  → interactionCreate
  → BotClient.commands.get(name)
  → command.execute(interaction)
  → Service / Repository / 외부 API
  → interaction.reply()
```

### 자연어 인터페이스 (`/ask` → Phase 6)
```
/ask "출석체크 채널 만들고 매주 월요일 09:00에 공지 보내줘"
  → agentService.run()
  → Claude로 plan 생성 (toolRegistry 기반 schema)
  → 각 step에 대해 toolRegistry.findTool(name).handler() 실행
  → agentRepository에 세션/툴콜/결과 기록
  → 요약을 interaction.reply()
```

### Google Form 프로비저닝 (Phase 4)
```
Google Form 제출
  → Apps Script가 HMAC 서명 + timestamp 첨부해 POST /webhooks/google-form
  → 서명·타임스탬프·idempotency 검증
  → formProvisioningService.provision()
    ├─ formSubmissionRepository (중복 방지)
    ├─ githubOrgService.inviteUser()
    └─ discordChannelService.createTextChannel()
  → 200 OK
```

### 주기 공지 (Phase 3)
```
node-cron("* * * * *")
  → scheduledNoticeRepository.listEnabled()
  → 신규 공지 등록 / 비활성 공지 stop
  → 각 공지의 cron 표현식 트리거 시점에 noticeService.send() → 채널 게시
```

### Google Calendar 디지털 (Phase 5)
```
node-cron("0 9 * * *", TZ=Asia/Seoul)
  → calendarService.sendDailyDigest(channelId)
    ├─ integrations/google/calendarClient (Service Account)
    ├─ calendarEventCacheRepository로 중복 발송 차단
    └─ 채널에 임베드 게시
```

---

## 구현된 기능

| 기능 | 진입점 | LLD |
|------|--------|-----|
| `/ping` | `src/commands/ping.ts` | [`ping.md`](features/ping.md) |
| `/ask` (Claude Q&A + 자연어 자동화) | `src/commands/ask.ts`, `agentService.ts` | [`automation-llm-natural-language.md`](features/automation-llm-natural-language.md) |
| `/invite-github` (Org 초대) | `src/commands/invite-github.ts` | [`automation-github-org.md`](features/automation-github-org.md) |
| `/create-repo` (Org 레포 생성) | `src/commands/create-repo.ts` | [`automation-github-org.md`](features/automation-github-org.md) |
| `/notice` (주기 공지 관리) | `src/commands/notice.ts`, `noticeScheduler.ts` | [`automation-scheduled-notice.md`](features/automation-scheduled-notice.md) |
| Google Form 프로비저닝 | `POST /webhooks/google-form` | [`automation-google-form-provisioning.md`](features/automation-google-form-provisioning.md) |
| Google Calendar 일일 디지털 | `calendarScheduler.ts` | [`automation-google-calendar.md`](features/automation-google-calendar.md) |
| Discord 메시지 수집/통합 스크립트 | `src/scripts/` | [`fetch-messages.md`](features/fetch-messages.md), [`consolidate-messages.md`](features/consolidate-messages.md) |
| Discord 슬래시 커맨드 자동 배포 | `src/deploy-commands.ts` | [`deploy-commands.md`](features/deploy-commands.md) |
| CI 파이프라인 | `.github/workflows/` | [`ci-pipeline.md`](features/ci-pipeline.md) |

---

## 계획 기능

| 기능 | 설명 | 이슈 |
|------|------|------|
| 출석체크 | 주단위 배치로 게시글 자동 생성, 리액션으로 체크 | #4, #5 |
| 스터디 모집 | 게시글 생성 및 승인 시 채널 자동 생성 | - |

---

## 권한 설계

### 커맨드 권한
- 일반 커맨드: 모든 멤버 사용 가능
- 운영 커맨드 (`/invite-github`, `/create-repo`, `/notice`, `/ask`의 자동화 툴 호출 등): 특정 Discord 역할 보유자만 사용 가능
- 역할 체크는 `interaction.member.roles.cache` 로 코드 레벨에서 검증

### Discord Bot 권한 (OAuth2 초대 시 설정)

| 권한 | 용도 |
|------|------|
| `View Channels` | 채널 읽기 |
| `Send Messages and Create Posts` | 공지/디지털 게시 |
| `Add Reactions` | 출석 이모지 리액션 (예정) |
| `Manage Messages` | 게시글 관리 |
| `Manage Channels` | 자동 채널 생성 (Form 프로비저닝, `/ask`) |
| `Manage Threads and Posts` | 스레드 관리 |
| `Create Public Threads` | 공개 스레드 생성 |
| `Manage Webhooks` | 웹훅 관리 |

> 새 서버에 봇을 초대할 때 OAuth2 URL Generator에서 위 권한을 동일하게 선택한다.

### 외부 API 자격증명
환경 변수는 `src/config.ts` 단일 진입점에서 관리한다.
- **Discord** (필수): `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`
- **Anthropic** (`/ask` 사용 시): `ANTHROPIC_API_KEY`
- **GitHub** (Org 자동화 사용 시): `GITHUB_TOKEN` (`admin:org`, `repo` 스코프), `GITHUB_ORG`, `GITHUB_TEMPLATE_OWNER`, `GITHUB_TEMPLATE_REPO`
- **Google** (Form/Calendar 사용 시): `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_CALENDAR_IDS`, `GOOGLE_FORM_WEBHOOK_SECRET`
- **HTTP/DB**: `HTTP_PORT`, `DATABASE_PATH`, `DISCORD_NOTICE_CHANNEL_ID`(캘린더 디지털 채널), `ADMIN_API_TOKEN`(`/api/notices` 인증 토큰)
