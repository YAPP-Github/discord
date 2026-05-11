---
title: Test Coverage 도입 설계
status: draft
created: 2026-05-12
owner: taehyung.koo@musinsa.com
---

# Test Coverage 도입 설계

## 1. 목표 및 비목표

### 목표

- Vitest 기반 테스트 커버리지를 단계적으로 도입한다.
- Phase 1(가시화) → Phase 2(래칫 게이팅) → Phase 3(갭 필링) 순으로 진행한다.
- GitHub Actions + 공개 마켓플레이스 액션만 사용하고, Codecov 등 외부 서비스 가입은 하지 않는다.
- 핫패스(자주 수정되는 service 모듈)와 외부 통합 어댑터의 회귀 위험을 낮춘다.

### 비목표

- 특정 커버리지 % 목표를 강제하지 않는다 (래칫 방식이라 baseline이 곧 바닥선).
- Discord SDK 의존이 강한 `commands/`, `events/`의 단위 테스트 커버리지 강제하지 않는다 (수동 시나리오로 보완).
- Codecov/Coveralls 같은 외부 트래킹 서비스는 도입하지 않는다.

## 2. 범위(coverage 측정 대상)

### 포함

- `src/services/**`
- `src/http/**`
- `src/utils/**`
- `src/db/repositories/**`
- `src/events/**`
- `src/commands/**`

### 제외

- `src/scripts/**` — 일회성 fetch/consolidate 스크립트
- `src/loaders/**` — 부트스트랩 동적 로딩
- `src/types/**` — 타입 선언만
- `src/index.ts`, `src/client.ts`, `src/deploy-commands.ts` — 부트스트랩 진입점
- `src/db/schema.ts` — 마이그레이션 정의
- `src/config.ts` — 단순 env 매핑
- `**/*.test.ts`, `**/*.d.ts`

### 측정 옵션

- `coverage.all = true` — 테스트가 import하지 않은 파일도 0%로 집계 (인플레된 baseline 방지).

## 3. Phase 1 — 측정 가시화 (게이팅 없음)

### 변경 산출물

| 파일 | 변경 |
|---|---|
| `package.json` | `"test:coverage": "vitest run --coverage"` 추가, devDep `@vitest/coverage-v8` 추가 (vitest와 동일 버전) |
| `vitest.config.ts` | `test.coverage` 블록 신규 (provider/reporter/include/exclude/all) |
| `.gitignore` | `coverage/` 추가 |
| `.prettierignore`, `.eslintignore` | `coverage/` 추가 (파일 존재 시) |
| `.github/workflows/ci.yml` | 신규 `test` job 추가 (Node 20 단일), artifact 업로드, PR 코멘트 step |

### `vitest.config.ts` coverage 블록 (스케치)

```ts
coverage: {
  provider: 'v8',
  reporter: ['text', 'html', 'json-summary', 'json'],
  reportsDirectory: './coverage',
  include: [
    'src/services/**',
    'src/http/**',
    'src/utils/**',
    'src/db/repositories/**',
    'src/events/**',
    'src/commands/**',
  ],
  exclude: [
    '**/*.test.ts',
    '**/*.d.ts',
    '**/types/**',
  ],
  all: true,
  // Phase 1에선 thresholds 미설정 — 게이팅 없음
}
```

### CI job 구조 (스케치)

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run test:coverage
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: coverage-report, path: coverage/, retention-days: 14 }
      - uses: davelosert/vitest-coverage-report-action@v2
        if: github.event_name == 'pull_request'
```

- 기존 `lint-and-build` job과 병렬 실행 (의존 없음).
- matrix는 사용하지 않음 (PR 코멘트 중복 방지).

### 종료 조건

- 로컬에서 `npm run test:coverage` 시 콘솔 표 + `coverage/index.html` 정상 생성.
- 트리비얼 PR에서 CI `test` job 통과 + coverage 표 코멘트 게시 확인.
- baseline 4개 메트릭(lines/statements/functions/branches) 수치 기록.

## 4. Phase 2 — 래칫 게이팅

### `.coverage-baseline.json` 스키마

```json
{
  "total": {
    "lines":      { "pct": 0 },
    "statements": { "pct": 0 },
    "functions":  { "pct": 0 },
    "branches":   { "pct": 0 }
  },
  "tolerance": 0.5
}
```

- 4개 메트릭 모두 게이트 대상.
- `tolerance: 0.5` (%p) — 부동소수점/마이크로 변동으로 인한 가짜 양성 방지.

### 래칫 스크립트 — `scripts/check-coverage-ratchet.mjs`

- 입력
  - `coverage/coverage-summary.json` (Vitest가 생성)
  - `.coverage-baseline.json`
- 로직
  1. 4개 메트릭 각각에 대해 `current.pct + tolerance < baseline.pct` 이면 fail.
  2. 모두 통과 시 exit 0. 어느 메트릭이 `>= baseline.pct + 1.0`이면 "baseline 상향 권장" 안내 로그(실패 아님).
  3. 실패 시 메트릭별로 `baseline / current / delta`를 stderr에 출력.
- npm 스크립트: `"coverage:ratchet": "node scripts/check-coverage-ratchet.mjs"`

### CI 통합

- `test` job에 step 추가: `npm run test:coverage` 다음, PR 코멘트 step 직전.

```yaml
- run: npm run coverage:ratchet
```

### baseline 갱신 운영 룰

- 갱신은 **단독 PR**로만 — 다른 변경과 섞지 않음.
- PR 본문에 갱신 사유 명시.
- 4개 메트릭을 **동시에** 갱신 (한 개만 올리면 나머지가 떨어진 것을 놓침).
- 절대 **하향**하지 않음. 긴급 시 revert로만 처리.

### 종료 조건

- 의도적으로 테스트 하나를 삭제한 PR이 빌드 실패.
- 정상 PR이 빌드 통과.
- 1~2주 운영하며 가짜 양성 0회.

## 5. Phase 3 — 갭 필링 워크플로 (지속 운영)

### 우선순위 가중치

- **핫패스 +가중**: `src/services/agentService.ts`, `src/services/githubOrgService.ts`, `src/services/discordChannelService.ts`, `src/services/noticeService.ts`.
- **외부 통합 +가중**: GitHub/Google/Anthropic API 어댑터의 오류 경로.
- **commands/, events/ 후순위**: Discord SDK 의존 강해 단위 테스트 효용 낮음. `docs/testing/manual-test-scenarios.md` 시나리오로 보완.

### 절차 (반복)

1. `coverage/index.html` 열어 디렉토리/파일 단위로 가장 낮은 곳 식별.
2. 테스트 추가 PR (통상 PR, baseline 영향 없으면 그대로 통과).
3. 머지 후 `.coverage-baseline.json` 갱신 단독 PR.

### 종료 없음

- 목표 수치 미설정. 핫패스가 의미 있게 커버된 시점부터 자연 감속.

## 6. 위험 및 완화

| 위험 | 완화 |
|---|---|
| `branches` 메트릭이 흔들려 가짜 양성 발생 | `tolerance: 0.5` 적용 |
| 신규 파일 추가로 일시적 baseline 하락 | 큰 파일 추가 PR은 기본 테스트도 동반 (PR 템플릿/관행으로 유도, 본 설계 범위 외) |
| `commands/`, `events/`의 낮은 커버리지가 baseline을 끌어내림 | 의도된 출발선으로 수용. 단위 테스트 강제 안 함. |
| Org 레벨 워크플로 권한 정책으로 PR 코멘트 실패 | 첫 PR에서 발견 시 점검. settings/actions/general 권한 확인. |
| `all: true`로 commands/events 임포트 시 side effect | v8 provider는 미실행 파일에 대해 정적 분석을 쓰므로 실제 import 안 함. 첫 실행에서 확인. |

## 7. 산출물 체크리스트

### 신규 파일

- `scripts/check-coverage-ratchet.mjs`
- `.coverage-baseline.json` (Phase 2 진입 시)
- `docs/features/test-coverage.md` (LLD)

### 수정 파일

- `package.json`
- `vitest.config.ts`
- `.gitignore`
- `.prettierignore`, `.eslintignore` (있다면)
- `.github/workflows/ci.yml`
- `CLAUDE.md` (LLD 인덱스)

## 8. Phase 진행 트리거 요약

| Phase | 시작 트리거 | 종료 트리거 |
|---|---|---|
| 1 | 본 설계 승인 | PR 코멘트 정상 게시 + baseline 수치 합의 |
| 2 | Phase 1 종료 + baseline 합의 | 1~2주 가짜 양성 0회 |
| 3 | Phase 2 안정화 | 종료 없음 (지속 운영) |
