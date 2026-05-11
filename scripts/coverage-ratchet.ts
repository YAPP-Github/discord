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
