---
title: YAPP 자동화 플랫폼 구현 계획
status: draft
last_updated: 2026-05-08
owner: taehyung.koo@musinsa.com
related_issues: []
required_credentials:
  discord:
    - DISCORD_TOKEN
    - DISCORD_CLIENT_ID
    - DISCORD_GUILD_ID
  github:
    - GITHUB_APP_ID
    - GITHUB_APP_PRIVATE_KEY
    - GITHUB_APP_INSTALLATION_ID
    - GITHUB_ORG
    - GITHUB_TEMPLATE_OWNER
    - GITHUB_TEMPLATE_REPO
  google:
    - GOOGLE_SERVICE_ACCOUNT_JSON
    - GOOGLE_CALENDAR_IDS
    - GOOGLE_FORM_WEBHOOK_SECRET
  llm_optional:
    - ANTHROPIC_API_KEY
---

# YAPP 자동화 플랫폼 구현 계획

> **상태**: draft
> **최종 수정**: 2026-05-08

---

## 개요

YAPP 동아리 운영 자동화를 현재 Node/TS 레포(`yapp-slack`) 안에서 layered architecture로 통합 구축한다. Discord 봇·HTTP 웹훅·Cron 스케줄러를 단일 프로세스에서 동시 운영하고, 마지막 단계로 자연어 명령어 인터페이스(LLM 툴 콜링)를 얹어 Agent 시스템으로 확장한다.

## 목표

- 동아리 운영에서 반복되는 수작업(채널 생성, 권한 부여, 공지, 초대)을 이벤트 기반으로 자동화
- 결정적(Deterministic) 워크플로우와 비결정적(LLM) 의도 해석 레이어를 분리
- 단계적으로 도입 가능한 모듈 구조 — 각 단계가 독립적 가치를 가짐

## 범위 (Scope)

**포함**:
- Layered architecture 기반 디렉터리/라이브러리 셋업
- GitHub Organization 초대/레포 생성 자동화
- Google Form 제출 트리거 → Discord 채널/역할 프로비저닝
- 주기적 공지 (Cron 스케줄러 → Discord)
- Google Calendar 일정 조회 → Discord 알림
- (확장) 자연어 명령 → 툴 콜링 → 자동화 실행

**제외**:
- 별도 서비스 분리 — 단일 Node 프로세스 유지
- 인터페이스+구현 분리, DI 컨테이너 — 모듈 단위 직접 import
- 동아리 외부 SaaS 통합 (Notion, Slack 등)
- 결제/회비 자동화

---

## 단계별 로드맵

각 Phase는 독립 LLD 문서로 분리되어 있다.

| Phase | 제목 | 문서 |
|-------|------|------|
| 1 | Layered Architecture 기반 자동화 셋업 | [docs/features/automation-foundation-setup.md](automation-foundation-setup.md) |
| 2 | GitHub Organization 자동화 | [docs/features/automation-github-org.md](automation-github-org.md) |
| 3 | 주기 공지 스케줄러 | [docs/features/automation-scheduled-notice.md](automation-scheduled-notice.md) |
| 4 | Google Form → Discord/GitHub 프로비저닝 | [docs/features/automation-google-form-provisioning.md](automation-google-form-provisioning.md) |
| 5 | Google Calendar 연동 | [docs/features/automation-google-calendar.md](automation-google-calendar.md) |
| 6 | 자연어 인터페이스 (LLM 툴 콜링) | [docs/features/automation-llm-natural-language.md](automation-llm-natural-language.md) |

---

## 데이터 흐름 (전체)

```
[Discord Slash/자연어] ──┐
[Google Form]      ─────┤
[Google Calendar poll]  ├──► services/ (유스케이스) ──► integrations/ ──► 외부 API
[GitHub Webhook]   ─────┤              │                     │
[Scheduler tick]   ─────┘              │                     ▼
                                       │             [Discord/GitHub/Google]
                                       ▼
                                 db/repositories/ (SQLite)
```

---

## 보안 고려사항 (전사 공통)

- GitHub Org 권한은 GitHub App + 최소 scope 로 제한
- Service Account 키는 외부 vault 또는 권한 제한된 디렉터리 보관, 절대 커밋 금지
- 모든 Discord 명령은 Role 기반 인가 (운영진/일반 분리)
- HTTP 웹훅은 HMAC 서명 검증 + timestamp/nonce 기반 replay 방지
- LLM에 노출되는 툴 스펙은 sensitive field 마스킹

---

## 미결 사항 (Open Questions)

- [ ] HTTP 서버 라이브러리 — Express vs Fastify (Phase 1 LLD에서 결정)
- [ ] DB 스택 — 현재 SQLite 유지 vs 트래픽 증가 시 PostgreSQL 이관 기준
- [ ] GitHub App 운영 — 누구 계정으로 install 할지
- [ ] LLM 단계 비용 한도와 운영자 confirm 플로우 설계
- [ ] 감사 로그(audit log) 보관 정책과 PII 마스킹 범위
