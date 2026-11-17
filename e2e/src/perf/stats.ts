import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Summary {
  n: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

/** Nearest-rank percentile of a sorted list. */
const pct = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;

export function summarize(values: number[]): Summary {
  if (values.length === 0) return { n: 0, min: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0 };
  const s = [...values].sort((a, b) => a - b);
  const r = (x: number) => Math.round(x * 10) / 10;
  return {
    n: s.length,
    min: r(s[0]!),
    p50: r(pct(s, 50)),
    p95: r(pct(s, 95)),
    p99: r(pct(s, 99)),
    max: r(s[s.length - 1]!),
    mean: r(s.reduce((a, b) => a + b, 0) / s.length),
  };
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Where results go (git-ignored). */
export const resultsDir = join(root, 'perf-results');
/** Committed reference results; a run is compared against the file of the same name. */
export const baselineDir = join(root, 'perf-baseline');

export function writeResult(name: string, result: unknown) {
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(join(resultsDir, `${name}.json`), JSON.stringify(result, null, 2));
}

/**
 * Compares `current` metrics (lower is better) with the committed baseline of the same name and returns the ones that
 * got worse by more than `tolerance` (default 0.5 = 50%; shared runners are noisy, this only catches real regressions).
 * No baseline file = nothing to compare (copy a result from `perf-results/` to `perf-baseline/` to start tracking).
 */
export function regressions(
  name: string,
  current: Record<string, number>,
  tolerance = Number(process.env.PERF_TOLERANCE ?? 0.5),
): string[] {
  const file = join(baselineDir, `${name}.json`);
  if (!existsSync(file)) return [];
  const base = JSON.parse(readFileSync(file, 'utf8')) as { metrics?: Record<string, number> };
  const out: string[] = [];
  for (const [k, v] of Object.entries(current)) {
    const b = base.metrics?.[k];
    if (b !== undefined && b > 0 && v > b * (1 + tolerance))
      out.push(`${k}: ${v} vs baseline ${b} (+${Math.round((v / b - 1) * 100)}%)`);
  }
  return out;
}
