---
title: Layered Architecture 기반 자동화 셋업
status: draft
last_updated: 2026-05-08
owner: taehyung.koo@musinsa.com
parent: docs/features/automation-platform-plan.md
phase: 1
required_credentials: []
---

# LLD — Layered Architecture 기반 자동화 셋업

> **상태**: draft
> **최종 수정**: 2026-05-08

---

## 개요

Phase 2~6 자동화 기능들이 공유할 디렉터리·라이브러리·레이어 구조를 먼저 박는다. 별도 서버 없이 현재 Node/TS 레포(`yapp-slack`) 안에서 모든 자동화를 통합 운영한다.

## 목표

- 디스코드 핸들러 외에 webhook·scheduler 진입점을 같은 프로세스에 통합
- Service / Integration / Repository 레이어 분리로 후속 Phase 일관성 확보
- 인터페이스+구현 분리 없는 단순한 모듈 단위 직접 import

## 범위 (Scope)

**포함**:
- 디렉터리 구조 추가 (`services/`, `integrations/`, `http/`, `schedulers/`)
- HTTP 서버 라이브러리 도입 결정 (Express vs Fastify)
- cron 라이브러리 도입 결정 (`node-cron` 기본)
- 단일 프로세스에서 Discord 봇 + HTTP 서버 + scheduler 동시 기동

**제외**:
- 별도 서비스 분리 (단일 프로세스 유지)
- DI 컨테이너 / 인터페이스+구현 분리
- DB 마이그레이션 도구 변경 (현재 `db/schema.ts::runMigrations()` 유지)

---

## 레이어 구조

```
src/
  commands/        # Presentation — Discord 슬래시 커맨드 (기존)
  events/          # Presentation — Discord 이벤트 (기존)
  http/            # Presentation — webhook 엔드포인트 (신규)
  schedulers/      # Presentation — cron 엔트리 (신규)

  services/        # Application — 유스케이스 오케스트레이션
  db/repositories/ # Infrastructure — SQLite 접근
  integrations/    # Infrastructure — 외부 API 클라이언트 (GitHub/Google 등, 신규)

  config.ts        # 환경 변수 단일 진입점 (기존)
  client.ts        # Discord 클라이언트 (기존)
  loaders/         # commands/events 동적 로더 (기존)
  types/           # 공용 타입 (기존)
  utils/           # 로거 등 (기존)
```

**의존성 규칙**: 위 → 아래 단방향. Presentation → Service → Infrastructure. 역방향 import 금지.

## 시작 흐름 변경

`src/index.ts`에 추가될 부트스트랩:

```
DB 초기화
  → Discord 커맨드/이벤트 로드
  → HTTP 서버 기동 (http/ 디렉터리 라우트 등록)
  → Scheduler 기동 (schedulers/ 디렉터리의 cron 등록)
  → Discord 로그인
```

세 가지(봇/HTTP/scheduler)는 같은 Node 프로세스에서 병행 실행. 종료 시 graceful shutdown 처리.

## 라이브러리 선택

| 용도 | 후보 | 기본 권장 |
|------|------|----------|
| HTTP 서버 | Express, Fastify | Express (의존성 가벼움, 익숙함) |
| Cron 스케줄러 | `node-cron`, `croner` | `node-cron` |
| HMAC 서명 검증 | Node 내장 `crypto` | Node 내장 |

## 신규 디렉터리 컨벤션

- `services/`: 유스케이스 단위 파일. 함수 export 또는 namespace 객체. 내부에서 `db/repositories`와 `integrations/`를 직접 import.
- `integrations/<vendor>/`: 외부 API 클라이언트. 인증·HTTP 호출만 담당. 비즈니스 로직 금지.
- `db/repositories/`: 테이블 단위 CRUD. SQL은 여기에서만.
- `http/`: 라우트 정의. 검증·인증 미들웨어 통과 후 service 호출.
- `schedulers/`: cron 표현식 + service 호출. 실행 결과 로깅.

## 에러 처리 표준 (최소)

- 사용자 노출(슬래시 커맨드 응답): ephemeral reply + 운영자 친화 메시지
- 운영자 알림: `utils/logger.ts` + 운영 채널 webhook
- HTTP 401/4xx 검증 실패: 즉시 응답, 본문 최소화
- 외부 API 실패: 재시도(지수 백오프 1~3회), 최종 실패 시 audit 로그 + 알림

## 미결 사항

- [ ] HTTP 서버 PORT 환경변수명 (기본 `PORT=3000` 제안)
- [ ] graceful shutdown 시 in-flight 작업 처리 정책
- [ ] 단일 프로세스 메모리/CPU 한계 도달 기준 — 분리 시그널 정의
