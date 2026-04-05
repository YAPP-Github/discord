# HLD (High-Level Design) — YAPP Discord Bot

## 프로젝트 개요

YAPP 커뮤니티를 위한 Discord 봇. 출석체크 자동화, GitHub 연동, Claude AI 기반 Q&A 등 커뮤니티 운영 자동화를 목표로 한다.

---

## 시스템 아키텍처

```
┌─────────────────────────────────────────────────────┐
│                   Discord Server                     │
│  (Slash Commands / Events / Reactions)               │
└────────────────────┬────────────────────────────────┘
                     │ discord.js v14
┌────────────────────▼────────────────────────────────┐
│                   BotClient                          │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │ Command Loader│  │ Event Loader │                 │
│  │ src/commands/ │  │ src/events/  │                 │
│  └──────┬───────┘  └──────┬───────┘                 │
│         └────────┬─────────┘                        │
│          ┌───────▼──────┐                           │
│          │  Scheduler   │  (node-cron)              │
│          └───────┬──────┘                           │
└──────────────────┼──────────────────────────────────┘
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
  ┌──────────┐ ┌────────┐ ┌──────────┐
  │ SQLite DB│ │ Claude │ │  GitHub  │
  │(better-  │ │  API   │ │   API    │
  │ sqlite3) │ │        │ │(Octokit) │
  └──────────┘ └────────┘ └──────────┘
```

---

## 컴포넌트

### BotClient (`src/client.ts`)
- `discord.js Client` 확장
- `Collection<string, Command>` 로 커맨드 저장
- Gateway Intents: Guilds, GuildMessages, MessageContent, GuildMembers

### Command / Event 로더 (`src/loaders/`)
- 디렉토리 스캔 방식 동적 자동 등록
- 새 커맨드/이벤트는 파일 추가만으로 반영됨

### 스케줄러
- `node-cron` 사용
- 주단위 배치 작업 (출석체크 게시글 자동 생성 등)

### SQLite DB (`src/db/`)
- WAL 모드, 외래키 활성화
- 싱글톤 인스턴스 (`getDatabase()`)
- 마이그레이션: `src/db/schema.ts`의 `runMigrations()`
- 레포지토리 패턴: `src/db/repositories/`

### 외부 API
- **Claude API** (`src/services/claude.ts`): AI 기반 Q&A
- **GitHub API** (`src/services/` 예정): 멤버 관리 연동

---

## 기술 스택

| 항목 | 기술 |
|------|------|
| 런타임 | Node.js (ESM) |
| 언어 | TypeScript 5 |
| Discord | discord.js v14 |
| DB | better-sqlite3 (SQLite) |
| 스케줄링 | node-cron |
| AI | Anthropic Claude API |
| GitHub | Octokit REST |

---

## 데이터 흐름

### 슬래시 커맨드 실행
```
사용자 입력 /command
  → Discord API
  → interactionCreate 이벤트
  → BotClient.commands.get(name)
  → command.execute(interaction)
  → DB 조회/저장 또는 외부 API 호출
  → interaction.reply()
```

### 주단위 배치 (예정)
```
node-cron 트리거 (매주 특정 요일/시간)
  → 출석체크 게시글 생성
  → 지정 채널에 메시지 전송
  → DB에 출석 세션 기록
```

---

## 구현된 기능

| 기능 | 설명 |
|------|------|
| `/ping` | 봇 응답 지연시간 확인 |

---

## 계획 기능

| 기능 | 설명 | 이슈 |
|------|------|------|
| 출석체크 | 주단위 배치로 게시글 자동 생성, 리액션으로 체크 | #4, #5 |
| GitHub 멤버 연동 | 이메일 입력 → GitHub 조직 멤버 자동 초대 | - |
| AI Q&A | 채널 히스토리 기반 Claude API 응답 | - |
| 스터디 모집 | 게시글 생성 및 승인 시 채널 자동 생성 | - |

---

## 권한 설계

### 커맨드 권한
- 일반 커맨드: 모든 멤버 사용 가능
- 운영 커맨드 (출석체크 생성 등): 특정 Discord 역할 보유자만 사용 가능
- 역할 체크는 `interaction.member.roles.cache` 로 코드 레벨에서 검증

### Discord Bot 권한 (OAuth2 초대 시 설정)

| 권한 | 용도 |
|------|------|
| `View Channels` | 채널 읽기 |
| `Send Messages and Create Posts` | 출석체크 게시글 전송 |
| `Add Reactions` | 출석 이모지 리액션 |
| `Manage Messages` | 게시글 관리 |
| `Manage Channels` | 스터디 채널 자동 생성 (예정) |
| `Manage Threads and Posts` | 스레드 관리 (예정) |
| `Create Public Threads` | 공개 스레드 생성 (예정) |
| `Manage Webhooks` | 웹훅 관리 (예정) |

> 새 서버에 봇을 초대할 때 OAuth2 URL Generator에서 위 권한을 동일하게 선택한다.
