# Test Coverage 도입 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vitest 기반 테스트 커버리지를 단계적으로 도입한다 — Phase 1(가시화) → Phase 2(래칫 게이팅) → Phase 3(갭 필링 운영).

**Architecture:** `@vitest/coverage-v8` provider로 Vitest에서 직접 측정. PR마다 GitHub Actions가 `coverage-summary.json`을 만들어 `davelosert/vitest-coverage-report-action`이 PR 코멘트로 게시. Phase 2부터는 `.coverage-baseline.json`을 리포에 커밋하고, CI에서 현재 측정치가 baseline보다 낮으면 빌드 실패시키는 래칫 스크립트로 단조 증가를 강제.

**Tech Stack:** Vitest 4.1.5, @vitest/coverage-v8, Node.js 20, GitHub Actions, TypeScript 스크립트(tsx로 실행).

**Spec:** `docs/superpowers/specs/2026-05-12-test-coverage-design.md`

**PR 분할**:
- **PR 1 (Phase 1)**: Task 1 ~ Task 3 — 측정 가시화. baseline 수치 확인 게이트.
- **PR 2 (Phase 2)**: Task 4 ~ Task 7 — 래칫 게이팅. PR 1 머지 + baseline 합의 후 진행.
- **PR 3 (문서)**: Task 8 — LLD + CLAUDE.md 인덱스. PR 2 안정화 후 진행.

---

## PR 1 — Phase 1: 측정 가시화

### Task 1: 커버리지 provider 설치 + npm 스크립트 + .gitignore

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: `@vitest/coverage-v8` 설치 (vitest 동일 버전)**

Run:
```bash
npm i -D @vitest/coverage-v8@4.1.5
```

Expected: `package.json`의 `devDependencies`에 `"@vitest/coverage-v8": "^4.1.5"` 추가, `package-lock.json` 갱신, 설치 성공 메시지.

- [ ] **Step 2: `package.json`에 `test:coverage` 스크립트 추가**

`package.json`의 `scripts` 블록에서 `"test"` 다음 줄에 추가:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage",
```

- [ ] **Step 3: `.gitignore`에 `coverage/` 추가**

`.gitignore` 마지막 줄에 추가:

```
coverage/
```

최종 `.gitignore`:

```
node_modules/
dist/
data/*.db
data/export/
.env.local
.env.prod
*.log
.DS_Store
.mcp.json
.idea/
coverage/
```

- [ ] **Step 4: 커밋**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore(coverage): @vitest/coverage-v8 추가 및 test:coverage 스크립트"
```

---

### Task 2: `vitest.config.ts` coverage 블록 추가 + 로컬 검증

**Files:**
- Modify: `vitest.config.ts`

- [ ] **Step 1: `vitest.config.ts` 수정**

전체 파일을 다음으로 교체:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary", "json"],
      reportsDirectory: "./coverage",
      include: [
        "src/services/**",
        "src/http/**",
        "src/utils/**",
        "src/db/repositories/**",
        "src/events/**",
        "src/commands/**",
      ],
      exclude: ["**/*.test.ts", "**/*.d.ts", "**/types/**"],
      all: true,
    },
  },
});
```

- [ ] **Step 2: 로컬 실행으로 동작 확인**

Run:
```bash
npm run test:coverage
```

Expected:
- 기존 9개 테스트 파일 모두 PASS
- 콘솔 마지막에 4개 메트릭(% Stmts / % Branch / % Funcs / % Lines) 표 출력
- `coverage/` 디렉토리 생성 (`index.html`, `coverage-summary.json`, `coverage-final.json` 포함)
- 측정 대상 파일에 `src/services/`, `src/http/`, `src/utils/`, `src/db/repositories/`, `src/events/`, `src/commands/` 하위만 포함됨

만약 `commands/`나 `events/`의 import 시 side effect로 실패한다면 → `all: true`를 일시적으로 `false`로 바꾸고 한 번 더 실행해 본 뒤, 실패 원인이 v8 provider의 정적 분석이 아닌 실제 import 때문임이 확인되면 해당 파일을 `exclude`에 추가. (v8 provider는 미실행 파일에 대해 정적 분석을 사용하므로 통상 발생하지 않음 — 발생 시 spec의 위험 섹션 항목 참조)

- [ ] **Step 3: HTML 리포트 시각 확인 (옵션)**

Run:
```bash
open coverage/index.html
```

Expected: 디렉토리별 커버리지 표가 표시되고, 클릭 시 파일별/라인별 색칠 표시.

- [ ] **Step 4: baseline 4개 메트릭 수치를 메모**

콘솔 표 마지막 줄("All files")의 4개 메트릭(% Stmts, % Branch, % Funcs, % Lines)을 PR 본문에 적기 위해 기록해둘 것. Task 5에서 사용.

- [ ] **Step 5: 커밋**

```bash
git add vitest.config.ts
git commit -m "feat(coverage): vitest coverage 설정 추가 (v8 provider, 측정 대상 한정)"
```

---

### Task 3: GitHub Actions CI에 `test` job 추가 (커버리지 + PR 코멘트)

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: `.github/workflows/ci.yml` 수정**

기존 `jobs:` 블록 아래에 `test` job을 신규 추가. 기존 `lint-and-build` job은 그대로 유지. 최종 파일:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint-and-build:
    runs-on: ubuntu-latest

    strategy:
      matrix:
        node-version: [20, 22]

    steps:
      - uses: actions/checkout@v4

      - name: Use Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Format check
        run: npm run format:check

      - name: Type check
        run: npm run typecheck

      - name: Build
        run: npm run build

  test:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read

    steps:
      - uses: actions/checkout@v4

      - name: Use Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Run tests with coverage
        run: npm run test:coverage

      - name: Upload coverage artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/
          retention-days: 14

      - name: Report coverage on PR
        if: github.event_name == 'pull_request'
        uses: davelosert/vitest-coverage-report-action@v2
```

- [ ] **Step 2: 커밋 + 푸시**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(coverage): test job 추가 (커버리지 측정 + PR 코멘트)"
```

- [ ] **Step 3: 트리비얼 PR로 동작 검증 (수동)**

PR을 열어 다음을 확인:
- `test` job이 추가되어 실행됨
- `npm run test:coverage`가 통과
- PR 코멘트로 커버리지 표(`% Stmts / % Branch / % Funcs / % Lines`)가 게시됨
- Actions 탭 → 해당 run → `coverage-report` artifact 다운로드 가능, 압축 풀어 `index.html` 정상 표시

검증 실패 케이스 + 대응:
- 코멘트 미게시 → job 로그에서 `vitest-coverage-report-action` step 출력 확인. 권한 오류 시 org 정책 점검 필요.
- coverage 파일 없음 오류 → `coverage/coverage-summary.json` 생성 여부 확인 (`json-summary` reporter 누락 가능).

- [ ] **Step 4: PR 1 머지 + baseline 수치 합의**

PR 본문에 Task 2에서 기록한 baseline 4개 메트릭을 적고 머지. 이 수치가 Phase 2 `.coverage-baseline.json`의 초깃값이 됨.

---

## PR 2 — Phase 2: 래칫 게이팅

> PR 1이 main에 머지되고 baseline 수치를 확정한 후 진행.

### Task 4: 래칫 비교 로직 (TDD)

**Files:**
- Create: `scripts/coverage-ratchet.ts`
- Create: `tests/scripts/coverageRatchet.test.ts`

> 참고: `scripts/`는 `tsconfig.json`의 `rootDir`(`src`) 밖이라 `tsc --noEmit`에 포함되지 않음. Vitest는 esbuild로 TS를 직접 처리, CI에서는 `tsx`로 실행. 프로젝트 컨벤션에 따라 내부 import는 파일이 `.ts`여도 `.js` 확장자를 사용한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/scripts/coverageRatchet.test.ts`를 신규 생성:

```ts
import { describe, expect, it } from "vitest";
import { compareCoverage } from "../../scripts/coverage-ratchet.js";

const baseline = {
  total: {
    lines: { pct: 70 },
    statements: { pct: 70 },
    functions: { pct: 70 },
    branches: { pct: 60 },
  },
};

const makeSummary = (pcts: {
  lines: number;
  statements: number;
  functions: number;
  branches: number;
}) => ({
  total: {
    lines: { pct: pcts.lines },
    statements: { pct: pcts.statements },
    functions: { pct: pcts.functions },
    branches: { pct: pcts.branches },
  },
});

describe("compareCoverage", () => {
  it("baseline과 동일하면 통과", () => {
    const current = makeSummary({
      lines: 70,
      statements: 70,
      functions: 70,
      branches: 60,
    });
    const result = compareCoverage(baseline, current, 0.5);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("tolerance 안에서 살짝 떨어지면 통과", () => {
    const current = makeSummary({
      lines: 69.7,
      statements: 70,
      functions: 70,
      branches: 60,
    });
    const result = compareCoverage(baseline, current, 0.5);
    expect(result.ok).toBe(true);
  });

  it("tolerance를 넘어 떨어지면 실패", () => {
    const current = makeSummary({
      lines: 69,
      statements: 70,
      functions: 70,
      branches: 60,
    });
    const result = compareCoverage(baseline, current, 0.5);
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].metric).toBe("lines");
  });

  it("여러 메트릭이 동시에 떨어지면 모두 보고", () => {
    const current = makeSummary({
      lines: 60,
      statements: 60,
      functions: 70,
      branches: 60,
    });
    const result = compareCoverage(baseline, current, 0.5);
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.metric).sort()).toEqual([
      "lines",
      "statements",
    ]);
  });

  it("1%p 이상 상승하면 suggestion에 포함", () => {
    const current = makeSummary({
      lines: 71.5,
      statements: 70,
      functions: 70,
      branches: 60,
    });
    const result = compareCoverage(baseline, current, 0.5);
    expect(result.ok).toBe(true);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].metric).toBe("lines");
  });

  it("1%p 미만 상승은 suggestion에 포함되지 않음", () => {
    const current = makeSummary({
      lines: 70.8,
      statements: 70,
      functions: 70,
      branches: 60,
    });
    const result = compareCoverage(baseline, current, 0.5);
    expect(result.ok).toBe(true);
    expect(result.suggestions).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실행으로 실패 확인**

Run:
```bash
npx vitest run tests/scripts/coverageRatchet.test.ts
```

Expected: FAIL — `Cannot find module '../../scripts/coverage-ratchet.js'` (또는 동일한 의미의 resolution 실패)

- [ ] **Step 3: 최소 구현 작성**

`scripts/coverage-ratchet.ts`를 신규 생성:

```ts
type MetricKey = "lines" | "statements" | "functions" | "branches";

export interface CoverageSummary {
  total: Record<MetricKey, { pct: number }>;
}

export interface CoverageBaseline extends CoverageSummary {
  tolerance?: number;
}

export interface MetricDelta {
  metric: MetricKey;
  baseline: number;
  current: number;
  delta: number;
}

export interface RatchetResult {
  ok: boolean;
  failures: MetricDelta[];
  suggestions: MetricDelta[];
}

const METRICS: MetricKey[] = ["lines", "statements", "functions", "branches"];

export function compareCoverage(
  baseline: CoverageBaseline,
  current: CoverageSummary,
  tolerance = 0.5,
): RatchetResult {
  const failures: MetricDelta[] = [];
  const suggestions: MetricDelta[] = [];

  for (const metric of METRICS) {
    const base = baseline.total[metric].pct;
    const cur = current.total[metric].pct;
    const delta = cur - base;

    if (cur + tolerance < base) {
      failures.push({ metric, baseline: base, current: cur, delta });
    } else if (delta >= 1.0) {
      suggestions.push({ metric, baseline: base, current: cur, delta });
    }
  }

  return { ok: failures.length === 0, failures, suggestions };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run:
```bash
npx vitest run tests/scripts/coverageRatchet.test.ts
```

Expected: PASS — 6개 테스트 모두 통과.

- [ ] **Step 5: 전체 테스트 + 커버리지 확인**

Run:
```bash
npm run test:coverage
```

Expected: 전체 테스트 통과. `scripts/`는 측정 대상이 아니므로 커버리지 수치는 영향 없음.

- [ ] **Step 6: 커밋**

```bash
git add scripts/coverage-ratchet.ts tests/scripts/coverageRatchet.test.ts
git commit -m "feat(coverage): 래칫 비교 로직 (compareCoverage)"
```

---

### Task 5: 래칫 CLI wrapper + npm 스크립트

**Files:**
- Create: `scripts/check-coverage-ratchet.ts`
- Modify: `package.json`

- [ ] **Step 1: CLI wrapper 작성**

`scripts/check-coverage-ratchet.ts`를 신규 생성:

```ts
import { readFileSync, existsSync } from "node:fs";
import {
  compareCoverage,
  type CoverageBaseline,
  type CoverageSummary,
} from "./coverage-ratchet.js";

const BASELINE_PATH = ".coverage-baseline.json";
const SUMMARY_PATH = "coverage/coverage-summary.json";

if (!existsSync(BASELINE_PATH)) {
  console.error(`[coverage-ratchet] baseline 파일이 없음: ${BASELINE_PATH}`);
  process.exit(2);
}
if (!existsSync(SUMMARY_PATH)) {
  console.error(
    `[coverage-ratchet] coverage 요약 파일이 없음: ${SUMMARY_PATH}. 먼저 \`npm run test:coverage\`를 실행하세요.`,
  );
  process.exit(2);
}

const baseline = JSON.parse(
  readFileSync(BASELINE_PATH, "utf8"),
) as CoverageBaseline;
const summary = JSON.parse(
  readFileSync(SUMMARY_PATH, "utf8"),
) as CoverageSummary;
const tolerance =
  typeof baseline.tolerance === "number" ? baseline.tolerance : 0.5;

const result = compareCoverage(baseline, summary, tolerance);

const fmt = (n: number) => `${n.toFixed(2)}%`;

if (!result.ok) {
  console.error("[coverage-ratchet] FAIL — 다음 메트릭이 baseline보다 낮음:");
  for (const f of result.failures) {
    console.error(
      `  - ${f.metric}: baseline ${fmt(f.baseline)} -> current ${fmt(
        f.current,
      )} (delta ${f.delta.toFixed(2)}%p, tolerance ${tolerance}%p)`,
    );
  }
  console.error(
    "테스트를 추가하거나, 의도된 변경이라면 별도 PR로 .coverage-baseline.json을 조정하세요.",
  );
  process.exit(1);
}

console.log("[coverage-ratchet] PASS");
for (const s of result.suggestions) {
  console.log(
    `  Suggestion: ${s.metric} ${fmt(s.baseline)} -> ${fmt(
      s.current,
    )} (delta +${s.delta.toFixed(2)}%p). baseline 상향 PR 고려.`,
  );
}
```

- [ ] **Step 2: `package.json`에 npm 스크립트 추가**

`scripts` 블록의 `test:coverage` 다음 줄에 추가:

```json
"test:coverage": "vitest run --coverage",
"coverage:ratchet": "tsx scripts/check-coverage-ratchet.ts",
```

- [ ] **Step 3: 수동 동작 확인 (baseline 없을 때)**

Run:
```bash
npm run coverage:ratchet
```

Expected: exit 2 + stderr `[coverage-ratchet] baseline 파일이 없음: .coverage-baseline.json`

- [ ] **Step 4: 커밋**

```bash
git add scripts/check-coverage-ratchet.ts package.json
git commit -m "feat(coverage): coverage-ratchet CLI wrapper + npm 스크립트"
```

---

### Task 6: 초기 `.coverage-baseline.json` 생성

**Files:**
- Create: `.coverage-baseline.json`

- [ ] **Step 1: 최신 커버리지 측정**

Run:
```bash
npm run test:coverage
```

Expected: 통과.

- [ ] **Step 2: `coverage/coverage-summary.json`에서 4개 메트릭 추출**

Run:
```bash
node -e "const s = require('./coverage/coverage-summary.json').total; console.log(JSON.stringify({lines: s.lines.pct, statements: s.statements.pct, functions: s.functions.pct, branches: s.branches.pct}, null, 2))"
```

Expected: 4개 메트릭의 % 값이 출력됨. 이 값들을 다음 단계의 baseline 파일에 그대로 넣음.

- [ ] **Step 3: `.coverage-baseline.json` 작성**

위에서 얻은 값을 `<LINES>`, `<STATEMENTS>`, `<FUNCTIONS>`, `<BRANCHES>` 자리에 대입해 작성:

```json
{
  "total": {
    "lines":      { "pct": <LINES> },
    "statements": { "pct": <STATEMENTS> },
    "functions":  { "pct": <FUNCTIONS> },
    "branches":   { "pct": <BRANCHES> }
  },
  "tolerance": 0.5
}
```

- [ ] **Step 4: 래칫 통과 확인 (자기 자신과 비교)**

Run:
```bash
npm run coverage:ratchet
```

Expected: `[coverage-ratchet] PASS` (suggestion 없음 — 자기 자신과 같으므로 delta 0)

- [ ] **Step 5: 의도적 실패 시뮬레이션 (검증용, 커밋 안 함)**

Run:
```bash
node -e "const fs=require('fs'); const j=require('./.coverage-baseline.json'); j.total.lines.pct += 5; fs.writeFileSync('.coverage-baseline.json', JSON.stringify(j, null, 2))"
npm run coverage:ratchet
```

Expected: exit 1 + stderr에 `lines: baseline ... -> current ... (delta -5.00%p, tolerance 0.5%p)` 형태 출력.

복구:
```bash
git checkout .coverage-baseline.json
npm run coverage:ratchet
```

Expected: 다시 PASS.

- [ ] **Step 6: 커밋**

```bash
git add .coverage-baseline.json
git commit -m "feat(coverage): 초기 coverage baseline 커밋"
```

---

### Task 7: CI에 래칫 step 추가

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: `test` job에 ratchet step 추가**

`.github/workflows/ci.yml`의 `test` job에서 "Run tests with coverage" step과 "Upload coverage artifact" step 사이에 추가:

```yaml
      - name: Run tests with coverage
        run: npm run test:coverage

      - name: Coverage ratchet
        run: npm run coverage:ratchet

      - name: Upload coverage artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/
          retention-days: 14
```

- [ ] **Step 2: 커밋**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(coverage): 래칫 게이팅 step 추가"
```

- [ ] **Step 3: PR로 동작 검증 (정상 케이스)**

PR 2를 push하여 CI에서 `Coverage ratchet` step이 PASS로 표시되는지 확인.

- [ ] **Step 4: PR로 동작 검증 (실패 케이스 — 옵션, 별도 임시 PR)**

검증용 임시 브랜치에서 임의의 테스트 한 개를 `it.skip(...)`로 비활성화 → push → CI의 `Coverage ratchet` step이 FAIL이고, 로그에 어떤 메트릭이 얼마나 떨어졌는지 표시되는지 확인. 검증 후 브랜치 폐기.

---

## PR 3 — 운영 문서

### Task 8: LLD + CLAUDE.md 인덱스 갱신

**Files:**
- Create: `docs/features/test-coverage.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: LLD 작성**

`docs/features/test-coverage.md`를 신규 생성:

```markdown
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

## 래칫 동작

- baseline 4개 메트릭(lines/statements/functions/branches) 중 하나라도 `current + tolerance < baseline`이면 CI 실패.
- `tolerance: 0.5` (%p) — 부동소수점/마이크로 변동의 가짜 양성 방지.
- 어느 메트릭이 +1.0%p 이상 상승하면 "baseline 상향 권장" 안내 (실패 아님).

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

- **PR 코멘트가 안 보임**: `test` job 로그에서 `Report coverage on PR` step 출력 확인. org의 워크플로 권한 정책 점검.
- **래칫이 가짜 양성을 일으킴**: `tolerance`를 0.5 → 1.0으로 일시 상향하지 말고, 어떤 메트릭이 흔들리는지 먼저 식별. 통상 `branches`가 가장 흔들림.
- **새 파일 추가로 baseline 하락**: 해당 파일의 기본 테스트도 같은 PR에 포함시키거나, 측정 대상에서 제외할지 검토.
```

- [ ] **Step 2: `CLAUDE.md` LLD 인덱스에 항목 추가**

`CLAUDE.md`의 LLD 목록 섹션에서 적절한 위치에 추가. 예를 들어 `[CI 파이프라인](docs/features/ci-pipeline.md)` 다음 줄:

```markdown
- [CI 파이프라인](docs/features/ci-pipeline.md)
- [Test Coverage 도입](docs/features/test-coverage.md)
- [Discord 커맨드 자동 배포](docs/features/deploy-commands.md)
```

- [ ] **Step 3: 커밋**

```bash
git add docs/features/test-coverage.md CLAUDE.md
git commit -m "docs(coverage): LLD 추가 + CLAUDE.md 인덱스 갱신"
```

---

## 완료 정의 (Definition of Done)

- [ ] `npm run test:coverage`가 로컬과 CI 모두에서 통과한다.
- [ ] PR마다 `vitest-coverage-report-action`이 커버리지 표 코멘트를 게시한다.
- [ ] `coverage-report` artifact를 CI run에서 다운로드할 수 있다.
- [ ] `.coverage-baseline.json`이 리포에 커밋되어 있다.
- [ ] 의도적으로 테스트를 비활성화한 PR이 `Coverage ratchet` step에서 실패한다.
- [ ] 정상 PR은 `Coverage ratchet` step을 통과한다.
- [ ] `docs/features/test-coverage.md` LLD가 존재하고 `CLAUDE.md` 인덱스에 링크돼 있다.
