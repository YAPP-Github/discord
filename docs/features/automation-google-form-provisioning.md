---
title: Google Form → Discord/GitHub 프로비저닝
status: draft
last_updated: 2026-05-08
owner: taehyung.koo@musinsa.com
parent: docs/features/automation-platform-plan.md
phase: 4
required_credentials:
  - GOOGLE_FORM_WEBHOOK_SECRET
  - DISCORD_TOKEN
  - DISCORD_GUILD_ID
  - GITHUB_APP_ID
  - GITHUB_APP_PRIVATE_KEY
  - GITHUB_APP_INSTALLATION_ID
  - GITHUB_ORG
---

# LLD — Google Form → Discord/GitHub 프로비저닝

> **상태**: draft
> **최종 수정**: 2026-05-08

---

## 개요

Google Form 제출 시 Apps Script가 봇 프로세스의 HTTP 웹훅을 호출하고, `services/formProvisioningService.ts`가 Discord 채널/역할 생성 + GitHub Org 초대 + (옵션) 팀 레포 생성까지 한 번에 처리한다.

## 목표

- 동아리/스터디/해커톤 신청서 제출 → 운영진 개입 없이 환경 자동 구성
- Handler 단위로 분리하여 신규 자동화 추가가 쉽도록 설계

## 구현 위치

- `http/googleFormWebhook.ts` — 웹훅 라우트 + HMAC 검증 미들웨어
- `services/formProvisioningService.ts` — 유스케이스 오케스트레이션
- `services/handlers/` — handler 단위 모듈 (discordChannel, discordRole, githubInvite, repoProvision)
- `db/repositories/formSubmissionRepository.ts`

## 데이터 흐름

```
Google Form 제출
  → Apps Script onFormSubmit
  → POST {봇서버}/webhooks/google-form (HMAC 검증)
  → http/googleFormWebhook.ts
  → services/formProvisioningService.ts (handler 병렬 호출)
      ├── discordChannelHandler   (채널/카테고리/권한 생성)
      ├── discordRoleHandler      (팀 Role 생성/부여)
      ├── githubInviteHandler     (org 초대)
      └── repoProvisionHandler    (팀 repo 생성, 옵셔널)
```

## Apps Script 예시

```js
function onFormSubmit(e) {
  const payload = JSON.stringify({
    form_id: e.source.getId(),
    timestamp: new Date().toISOString(),
    answers: e.namedValues,
  });
  const sig = computeHmacSha256(payload, SECRET);
  UrlFetchApp.fetch(SERVER_URL + '/webhooks/google-form', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Signature': sig, 'X-Timestamp': Date.now() },
    payload,
  });
}
```

## HMAC 검증

- 헤더: `X-Signature` (HMAC-SHA256 of body), `X-Timestamp`
- 서버: timestamp가 현재 ±5분 이내 + nonce 캐시(replay 방지)
- 검증 실패 시 401 + 보안 채널 alert

## Discord 채널 생성

```
POST /guilds/{guild.id}/channels
{
  "name": "team-backend-3",
  "type": 0,
  "parent_id": "{카테고리ID}",
  "permission_overwrites": [
    { "id": "@everyone role id", "type": 0, "deny": "1024" },
    { "id": "team role id",      "type": 0, "allow": "1024" }
  ]
}
```

## DB 스키마

```sql
CREATE TABLE form_submission (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id TEXT,
  submitted_at DATETIME,
  payload TEXT,           -- JSON
  status TEXT,            -- received | provisioning | done | failed
  idempotency_key TEXT UNIQUE
);

CREATE TABLE form_provisioning_result (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER REFERENCES form_submission(id),
  handler TEXT,
  status TEXT,
  detail TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## 에러 처리

| 상황 | 처리 방식 |
|------|----------|
| HMAC 검증 실패 | 401 + 보안 채널 alert |
| Handler 일부 실패 | 다른 Handler는 계속 진행, 실패 항목만 운영진 멘션 |
| GitHub username 잘못됨 | 폼 응답자에게 DM으로 정정 요청 |
| 중복 제출 | idempotency_key로 차단 |

## 미결 사항

- [ ] Google Form 응답 필드 표준화 (이름/Discord ID/GitHub ID 매핑)
- [ ] 팀 레포 생성을 default로 할지 opt-in 으로 할지
- [ ] 실패 시 자동 재시도 정책 (지수 백오프 vs 운영자 수동 재실행)
