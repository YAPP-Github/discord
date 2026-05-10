---
title: 자연어 인터페이스 (LLM 툴 콜링)
status: draft
last_updated: 2026-05-08
owner: taehyung.koo@musinsa.com
parent: docs/features/automation-platform-plan.md
phase: 6
required_credentials:
  - ANTHROPIC_API_KEY
  - DISCORD_TOKEN
  - DISCORD_GUILD_ID
---

# LLD — 자연어 인터페이스 (LLM 툴 콜링)

> **상태**: draft
> **최종 수정**: 2026-05-08

---

## 개요

Phase 1~5에서 구축한 결정적 자동화 위에 LLM 의도 해석 레이어를 얹는다. 사용자가 자연어로 입력하면 LLM이 적절한 툴을 선택·호출하고, 실제 작업은 기존 `services/` 레이어가 결정적으로 수행한다.

## 목표

- "다음주 수요일 스터디방 만들어주고 참여자들 깃헙 초대해줘" 같은 자연어 처리
- LLM은 의도 해석 + 툴 선택만, 실제 부수 효과는 결정적 service
- 모든 툴 호출을 audit log로 영속화

## 핵심 원칙

| 원칙 | 의미 |
|------|------|
| LLM = 해석 레이어 | 부수 효과 직접 수행 금지 |
| 결정적 백엔드 | 모든 외부 API 호출은 기존 `services/` 경유 |
| Audit-first | 모든 툴 호출/결과를 영속 로그 |
| Confirm flow | 파괴적 작업(채널 삭제, 멤버 제거)은 사용자 confirm 필수 |

## 구현 위치

- `commands/ask.ts` 또는 mention 기반 이벤트 — 자연어 입력 진입점
- `services/agentService.ts` — Claude tool use 호출 + plan 실행 오케스트레이션
- `services/agent/toolRegistry.ts` — 툴 메타데이터 + service 매핑
- `db/repositories/agentSessionRepository.ts`, `agentToolCallRepository.ts`

## 구조

```
사용자 자연어 입력 (Discord)
  ↓
commands/ask.ts
  ↓
services/agentService.ts
  ↓
Anthropic SDK (tool use) — services/claude.ts 재사용
  ↓
toolRegistry → candidate tools 선정 + plan
  ↓
기존 services/ 호출 (githubOrgService, noticeService, calendarService 등)
  ↓
사용자 친화 메시지 합성 후 응답
```

## Tool Registry

```yaml
tools:
  - name: create_discord_channel
    desc: Discord 채널 생성
    schema: { name, category_id?, role_ids? }
    handler: services/discordChannelService.create
  - name: invite_github_user
    desc: GitHub Org 초대
    schema: { username }
    handler: services/githubOrgService.invite
  - name: create_github_repo
    desc: GitHub Org 레포 생성 (옵션 템플릿)
    schema: { name, private?, template? }
    handler: services/githubOrgService.createRepo
  - name: schedule_notice
    desc: 주기 공지 등록
    schema: { title, content, cron_expr, channel_id }
    handler: services/noticeService.create
  - name: list_calendar_events
    desc: 캘린더 일정 조회
    schema: { calendar_id, time_min, time_max }
    handler: services/calendarService.list
```

각 툴의 schema는 service 함수 시그니처와 동일하게 유지하여 LLM ↔ service 간 변환 비용 제거.

## 자연어 해석 예시

입력:
```
다음주 수요일 스터디방 만들어주고 참여자들 깃헙 초대해줘
```

LLM 산출:
```json
{
  "plan": [
    { "tool": "create_discord_channel", "args": { "name": "study-2026-05-13" } },
    { "tool": "invite_github_user", "args": { "username": "userA" } },
    { "tool": "invite_github_user", "args": { "username": "userB" } }
  ],
  "confirmation_required": false,
  "summary": "스터디방 1개 생성 + 참여자 2명 GitHub 초대"
}
```

## DB 스키마

```sql
CREATE TABLE agent_session (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_discord_id TEXT,
  input_text TEXT,
  plan_json TEXT,         -- JSON
  status TEXT,            -- planned | confirmed | executed | failed
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agent_tool_call (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER REFERENCES agent_session(id),
  tool_name TEXT,
  args_json TEXT,
  result_json TEXT,
  status TEXT,
  duration_ms INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Confirm Flow

| 작업 분류 | confirm 여부 |
|-----------|-------------|
| 조회성(list, get) | 불필요 |
| 생성(channel, repo) | 운영진 외에는 confirm |
| 파괴(삭제, 권한 박탈) | 항상 confirm |

Confirm은 Discord 버튼 컴포넌트로 제공.

## 비용/성능

- Claude tool use 응답을 caching (동일 자연어 + 동일 컨텍스트는 5분 캐시)
- 일일 예산 한도 설정, 초과 시 슬래시 커맨드 fallback
- LLM 응답 latency p95 < 5s 목표

## 에러 처리

| 상황 | 처리 방식 |
|------|----------|
| LLM이 잘못된 툴 인자 생성 | schema 검증 실패 → LLM에 retry 1회 |
| 존재하지 않는 툴 호출 | LLM에 tool list 재주입 + retry |
| service 실패 | LLM에 error 전달 → 사용자 친화 설명 |
| LLM 응답 timeout | 슬래시 커맨드 가이드로 fallback |

## 미결 사항

- [ ] 일일 예산 한도 정책 및 초과 시 동작
- [ ] PII 마스킹 범위 (LLM에 노출되는 사용자 정보)
- [ ] 다국어 지원 — 한국어/영어 혼용 처리
- [ ] Streaming response를 Discord에서 어떻게 표시할지
