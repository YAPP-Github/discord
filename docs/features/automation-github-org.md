---
title: GitHub Organization 자동화
status: draft
last_updated: 2026-05-08
owner: taehyung.koo@musinsa.com
parent: docs/features/automation-platform-plan.md
phase: 2
required_credentials:
  - GITHUB_APP_ID
  - GITHUB_APP_PRIVATE_KEY
  - GITHUB_APP_INSTALLATION_ID
  - GITHUB_ORG
  - GITHUB_TEMPLATE_OWNER
  - GITHUB_TEMPLATE_REPO
---

# LLD — GitHub Organization 자동화

> **상태**: draft
> **최종 수정**: 2026-05-08

---

## 개요

Discord 슬래시 커맨드로 GitHub Organization 멤버 초대 및 레포 생성을 자동화. 운영진의 수작업을 줄이고 일관된 권한·보호 정책을 적용한다.

## 목표

- `/invite-github`, `/create-repo` 두 커맨드로 운영의 90% 케이스 커버
- GitHub App 기반 최소 권한 원칙
- 템플릿 레포로 boilerplate 자동 적용

## 슬래시 커맨드

| 커맨드 | 설명 | 권한 |
|--------|------|------|
| `/invite-github <username>` | GitHub Org 초대 발송 | 운영진 |
| `/create-repo <name> [--template]` | Org 레포 생성, 옵션으로 템플릿 복제 | 운영진 |

## 데이터 흐름

```
/invite-github taehyung
  → commands/inviteGithub.ts
  → services/githubOrgService.ts
  → integrations/github/orgClient.ts
      ├─ GET /users/{username}                    (username 검증)
      ├─ GET /orgs/{org}/members/{username}       (중복 체크)
      └─ POST /orgs/{org}/invitations
  → ephemeral reply
```

## GitHub API 엔드포인트

| 작업 | API |
|------|-----|
| 멤버 직접 추가 | `PUT /orgs/{org}/memberships/{username}` |
| 초대 발송 | `POST /orgs/{org}/invitations` |
| 레포 생성 | `POST /orgs/{org}/repos` |
| 템플릿 기반 생성 | `POST /repos/{template_owner}/{template_repo}/generate` |

## 보호 장치

- Discord Role 검사: 운영진 Role ID 화이트리스트
- 일일 생성 개수 제한: org당 20개 (운영자 override 가능)
- 예약어 블랙리스트: `admin`, `owner`, `template-*` 등
- GitHub App installation token 회전: 1시간 자동 갱신

## 에러 처리

| 상황 | 처리 방식 |
|------|----------|
| username 없음 | "GitHub 계정 확인 필요" ephemeral reply |
| 이미 멤버 | 422 응답 무시, 사용자에게 "이미 가입됨" 안내 |
| repo 이름 충돌 | 422 응답 → 다른 이름 제안 |
| rate limit | exponential backoff + 운영 채널 alert |

## DB 스키마

```sql
CREATE TABLE github_action_log (
  id BIGINT PRIMARY KEY,
  actor_discord_id VARCHAR(30),
  action VARCHAR(50),
  target VARCHAR(200),
  status VARCHAR(20),
  idempotency_key VARCHAR(100) UNIQUE,
  created_at TIMESTAMP
);
```

## 미결 사항

- [ ] GitHub App을 누구 계정으로 install 할지(공용 봇 계정 필요)
- [ ] 템플릿 레포 표준화 — 어떤 boilerplate를 기본으로 둘지
- [ ] 초대 만료/재발송 정책
