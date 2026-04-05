# LLD — Discord 커맨드 자동 배포

> **관련 이슈**: #3
> **상태**: implemented
> **최종 수정**: 2026-04-06

---

## 개요

`src/commands/` 디렉토리에 변경이 발생하면 main 브랜치 merge 시 GitHub Actions가 자동으로 Discord 운영 서버에 슬래시 커맨드를 배포한다. 수동 배포(`workflow_dispatch`)도 지원한다.

## 목표

- 커맨드 추가/변경 후 수동으로 `deploy-commands:prod`를 실행해야 하는 번거로움 제거
- 커맨드 배포 누락 방지

## 범위 (Scope)

**포함**:
- `src/commands/**` 변경 시 main push → 운영 서버 자동 배포
- `workflow_dispatch`로 수동 실행

**제외**:
- 로컬(테스트) 서버 커맨드 배포
- 서버 애플리케이션 배포 (별도 파이프라인으로 분리 예정)

---

## 권한

해당 없음 (GitHub Actions 파이프라인)

---

## 슬래시 커맨드

해당 없음

---

## 데이터 흐름

```
src/commands/** 변경 → main merge (push)
  → GitHub Actions 트리거 (deploy-commands.yml)
  → npm ci
  → NODE_ENV=prod npm run deploy-commands:prod
    → config.ts: .env.prod 로드 (GitHub Secrets 주입)
    → deploy-commands.ts: src/commands/ 스캔
    → Discord API PUT /applications/{clientId}/guilds/{guildId}/commands
  → 운영 서버에 커맨드 즉시 반영
```

---

## DB 스키마

해당 없음

---

## 배치 / 스케줄

| 항목 | 내용 |
|------|------|
| 트리거 | push to main (paths: src/commands/**) |
| 수동 실행 | workflow_dispatch |
| 배포 방식 | Discord API PUT (전체 교체) |

---

## GitHub Actions 설정

**파일**: `.github/workflows/deploy-commands.yml`

**필요한 GitHub Secrets**:

| Secret | 설명 |
|--------|------|
| `DISCORD_TOKEN` | 운영 봇 토큰 |
| `DISCORD_CLIENT_ID` | 운영 봇 Application ID |
| `DISCORD_GUILD_ID` | 운영 서버 ID |

**Node.js 버전**: 20

---

## 에러 처리

| 상황 | 처리 방식 |
|------|----------|
| GitHub Secrets 미등록 | `config.ts`의 `required()` 에서 에러 발생 → Actions 실패 |
| Discord API 오류 | `deployCommands().catch(console.error)` → Actions 실패 |

---

## 미결 사항 (Open Questions)

- [ ] GitHub Secrets 등록 완료 여부 확인 필요
