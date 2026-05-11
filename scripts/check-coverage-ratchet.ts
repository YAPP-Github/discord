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
