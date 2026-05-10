# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 명령어

```bash
npm run dev              # 개발 모드 실행 (tsx watch, 자동 재시작)
npm run build            # TypeScript 컴파일 → dist/
npm start                # 프로덕션 실행 (빌드 후 사용)
npm run deploy-commands  # Discord 슬래시 커맨드 등록 (길드 스코프)
npm run lint             # ESLint 검사
npm run lint:fix         # ESLint 자동 수정
npm run typecheck        # tsc --noEmit (타입 검사만)
npm run format:check     # Prettier 포맷 검사
```

## 아키텍처

ESM 기반 Node.js + TypeScript 프로젝트. `"type": "module"` 이므로 모든 내부 import에 `.js` 확장자를 사용한다 (`.ts` 파일이더라도).

### 시작 흐름

`src/index.ts` → DB 초기화 → 커맨드/이벤트 동적 로딩 → Discord 로그인

### 동적 로딩 패턴

`src/loaders/commands.ts`와 `src/loaders/events.ts`가 해당 디렉토리의 파일을 자동으로 읽어 등록한다. **새 커맨드나 이벤트는 파일만 추가하면 자동 로드된다.**

- 커맨드: `src/commands/*.ts` — `Command` 인터페이스의 `default export` 필요
- 이벤트: `src/events/*.ts` — `Event` 인터페이스의 `default export` 필요

### 주요 타입 (`src/types/index.ts`)

```ts
interface Command {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

interface Event {
  name: string;
  once?: boolean;
  execute: (...args: any[]) => Promise<void> | void;
}
```

### 환경 변수

`src/config.ts`가 단일 진입점. `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`는 시작 시 필수 검증. Claude/GitHub 키는 선택적.

### DB

`src/db/index.ts`에서 싱글톤 SQLite 인스턴스 관리. `getDatabase()`로 접근. 마이그레이션은 `src/db/schema.ts`의 `runMigrations()`에 추가. 레포지토리는 `src/db/repositories/`에 작성.

### 슬래시 커맨드 등록

커맨드를 추가하거나 변경한 뒤 `npm run deploy-commands`를 실행해야 Discord에 반영된다. 길드 스코프라 즉시 적용된다.

## 문서

### HLD
전체 시스템 아키텍처, 컴포넌트 관계, 기술 스택을 기술한다.
- [`docs/HLD.md`](docs/HLD.md)

### LLD
기능 단위 상세 설계. 새 기능 추가 시 `docs/features/TEMPLATE.md`를 복사해 작성한다.
구현 전 LLD를 먼저 작성하고, 완료 후 아래 목록에 추가한다.
기능 관련 작업 시 해당 LLD의 **상태** 필드를 확인한다 (`draft` | `review` | `approved` | `implemented`).

- [Ping 커맨드](docs/features/ping.md)
- [CI 파이프라인](docs/features/ci-pipeline.md)
- [Discord 커맨드 자동 배포](docs/features/deploy-commands.md)
- [Claude API 서비스](docs/features/claude-service.md)
- [Discord 메시지 수집 스크립트](docs/features/fetch-messages.md)
- [YAPP 자동화 플랫폼 구현 계획](docs/features/automation-platform-plan.md)
  - [Phase 1: Layered Architecture 기반 자동화 셋업](docs/features/automation-foundation-setup.md)
  - [Phase 2: GitHub Organization 자동화](docs/features/automation-github-org.md)
  - [Phase 3: 주기 공지 스케줄러](docs/features/automation-scheduled-notice.md)
  - [Phase 4: Google Form → Discord/GitHub 프로비저닝](docs/features/automation-google-form-provisioning.md)
  - [Phase 5: Google Calendar 연동](docs/features/automation-google-calendar.md)
  - [Phase 6: 자연어 인터페이스 (LLM 툴 콜링)](docs/features/automation-llm-natural-language.md)

### ADR
아키텍처 의사결정 기록. 큰 기술적 결정이 있을 때만 작성한다.
- [`docs/adr/`](docs/adr/)
