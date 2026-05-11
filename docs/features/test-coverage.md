---
title: Test Coverage 도입
status: implemented
last_updated: 2026-05-12
owner: taehyung.koo@musinsa.com
related_spec: docs/superpowers/specs/2026-05-12-test-coverage-design.md
---

# Test Coverage 도입

## 개요

Vitest 기반 테스트 커버리지를 단계적으로 운영한다.

- Phase 1 (가시화): 측정만, 게이팅 없음.
- Phase 2 (래칫): `.coverage-baseline.json`을 바닥선으로 강제. 단조 증가.
- Phase 3 (갭 필링): HTML 리포트로 핫패스를 식별해 테스트 추가.

상세 설계: `docs/superpowers/specs/2026-05-12-test-coverage-design.md`

## 명령어

```bash
npm run test:coverage      # 로컬에서 커버리지 측정 (콘솔 표 + coverage/index.html)
npm run coverage:ratchet   # 현재 측정치를 baseline과 비교 (CI와 동일)
```

## 측정 범위

| 포함 | 제외 |
|---|---|
| `src/services/**` | `src/scripts/**` |
| `src/http/**` | `src/loaders/**` |
| `src/utils/**` | `src/types/**` |
| `src/db/repositories/**` | `src/index.ts`, `src/client.ts`, `src/deploy-commands.ts` |
| `src/events/**` | `src/db/schema.ts`, `src/config.ts` |
| `src/commands/**` | `**/*.test.ts`, `**/*.d.ts` |

설정은 `vitest.config.ts`의 `test.coverage.include` / `exclude` 참조.
Vitest 4부터 `coverage.all` 옵션은 제거됐고, `include` 패턴만으로 미실행 파일도 0%로 집계된다.

## 래칫 동작

- baseline 4개 메트릭(lines/statements/functions/branches) 중 하나라도 `current + tolerance < baseline`이면 CI 실패.
- `tolerance: 0.5` (%p) — 부동소수점/마이크로 변동의 가짜 양성 방지.
- 어느 메트릭이 +1.0%p 이상 상승하면 "baseline 상향 권장" 안내 (실패 아님).

구현: `scripts/coverage-ratchet.ts` (순수 함수) + `scripts/check-coverage-ratchet.ts` (CLI). CI에서 `npm run coverage:ratchet` 호출.

## baseline 갱신 운영 룰

- 갱신은 **단독 PR**로만. 다른 변경과 섞지 않는다.
- PR 본문에 갱신 사유 명시 (예: "X 모듈 테스트 추가, lines 62.4% → 67.1%").
- 4개 메트릭을 **동시에** 갱신한다 (한 개만 올리면 나머지가 떨어진 것을 놓침).
- **하향 금지.** 긴급 시 revert로만.

## Phase 3 갭 필링 절차

1. 로컬에서 `npm run test:coverage` → `coverage/index.html` 오픈.
2. 디렉토리별/파일별로 가장 낮은 곳 식별.
3. 우선순위:
   - **핫패스**: `agentService.ts`, `githubOrgService.ts`, `discordChannelService.ts`, `noticeService.ts`.
   - **외부 통합 어댑터**: GitHub/Google/Anthropic API의 오류 경로.
   - **commands/, events/**: Discord SDK 의존이 강해 단위 테스트 효용 낮음. `docs/testing/manual-test-scenarios.md`로 보완.
4. 테스트 추가 PR (통상 PR) → 머지 후 baseline 갱신 단독 PR.

## 트러블슈팅

- **PR 코멘트가 안 보임**: `test` job 로그에서 `Report coverage on PR` step 출력 확인. org의 워크플로 권한 정책 점검 (Settings → Actions → General → Workflow permissions).
- **래칫이 가짜 양성을 일으킴**: `tolerance`를 0.5 → 1.0으로 일시 상향하지 말고, 어떤 메트릭이 흔들리는지 먼저 식별. 통상 `branches`가 가장 흔들림.
- **새 파일 추가로 baseline 하락**: 해당 파일의 기본 테스트도 같은 PR에 포함시키거나, 측정 대상에서 제외할지 검토.

## 초기 baseline (참고)

- Statements: 68.10%
- Branches: 55.50%
- Functions: 65.28%
- Lines: 68.26%

(2026-05-12 시점. 이후 PR로 단조 상향됨.)
