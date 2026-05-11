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
