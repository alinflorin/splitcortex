import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';

// Helpers of the perf project: statistics, a recorder that writes results.json and a Markdown summary (compared with the
// previous run's results when there are any), bounded concurrency, and a streamed chat call that timestamps every piece.

export const now = () => performance.now();
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface Stat {
  n: number;
  min: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i]!;
}

export function stats(samples: number[]): Stat {
  const s = [...samples].sort((a, b) => a - b);
  const sum = s.reduce((x, y) => x + y, 0);
  return {
    n: s.length,
    min: s[0] ?? NaN,
    mean: s.length ? sum / s.length : NaN,
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    p99: percentile(s, 99),
    max: s.at(-1) ?? NaN,
  };
}

/** Runs `fn(0..total-1)` with at most `concurrency` in flight; results keep their index. */
export async function runPool<T>(
  total: number,
  concurrency: number,
  fn: (i: number) => Promise<T>,
): Promise<T[]> {
  const out = new Array<T>(total);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= total) return;
      out[i] = await fn(i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  return out;
}

/** How late this process's own timers fire: the load generator's health. High values mean the client was the limit. */
export function lagMonitor() {
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();
  return {
    reset: () => h.reset(),
    /** p99 and max in ms (the histogram counts nanoseconds). */
    read: () => ({ p99: h.percentile(99) / 1e6, max: h.max / 1e6 }),
    stop: () => h.disable(),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Chat calls
// ---------------------------------------------------------------------------------------------------------------------

/** The text the fake engine (`run --fake`) streams for `n` tokens. */
export const fakeText = (n: number) => Array.from({ length: n }, (_, i) => `tok${i} `).join('');

export interface ChatTiming {
  status: number;
  /** Request sent until the first piece of text (streams) or the whole answer (otherwise). */
  ttfbMs: number;
  totalMs: number;
  text: string;
  /** Time between consecutive pieces. */
  gaps: number[];
  done: boolean;
  /** A network error or timeout, when there was no status. */
  error?: string;
}

/** One chat completion, streamed or not, measured from the client. Never throws. */
export async function chat(
  baseUrl: string,
  key: string | null,
  body: object,
  opts: { stream?: boolean; timeoutMs?: number; path?: string } = {},
): Promise<ChatTiming> {
  const started = now();
  const result: ChatTiming = {
    status: 0,
    ttfbMs: NaN,
    totalMs: NaN,
    text: '',
    gaps: [],
    done: false,
  };
  try {
    const res = await fetch(`${baseUrl}/v1${opts.path ?? '/chat/completions'}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify(opts.stream ? { ...body, stream: true } : body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    });
    result.status = res.status;
    if (!opts.stream || !res.body) {
      const text = await res.text();
      result.ttfbMs = result.totalMs = now() - started;
      try {
        const j = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
        result.text = j.choices?.[0]?.message?.content ?? '';
      } catch {
        // an error body that is not JSON: the status is what counts
      }
      result.done = res.ok;
      return result;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let last = NaN;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          result.done = true;
          continue;
        }
        try {
          const piece = (JSON.parse(data) as { choices?: { delta?: { content?: string } }[] })
            .choices?.[0]?.delta?.content;
          if (piece) {
            const t = now();
            if (Number.isNaN(result.ttfbMs)) result.ttfbMs = t - started;
            else result.gaps.push(t - last);
            last = t;
            result.text += piece;
          }
        } catch {
          // a line that is not JSON is not a piece
        }
      }
    }
    result.totalMs = now() - started;
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    result.totalMs = now() - started;
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------------------------------

export interface Metric {
  name: string;
  /** `ms` is compared with the previous run (lower is better); anything else is only reported. */
  unit: string;
  stat: Stat;
  note?: string;
}

interface Results {
  version: 1;
  at: string;
  info: Record<string, unknown>;
  metrics: Metric[];
}

export const RESULTS_DIR = 'perf-results';
const BASELINE = process.env.PERF_BASELINE?.trim() || 'perf-baseline/results.json';

/** Slower than this many times the previous p95 (plus the slack) counts as a regression. */
const FACTOR = 2;
const SLACK_MS = 25;

export class Recorder {
  readonly metrics: Metric[] = [];
  readonly info: Record<string, unknown> = {};

  add(name: string, samples: number[], unit = 'ms', note?: string) {
    const clean = samples.filter((x) => Number.isFinite(x));
    this.metrics.push({ name, unit, stat: stats(clean), note });
  }

  /** A single number (a count, a duration of one event). */
  value(name: string, v: number, unit: string, note?: string) {
    this.add(name, [v], unit, note);
  }

  /** Writes results.json and summary.md; returns the metrics that are slower than the previous run allows. */
  write(): string[] {
    mkdirSync(RESULTS_DIR, { recursive: true });
    const results: Results = {
      version: 1,
      at: new Date().toISOString(),
      info: this.info,
      metrics: this.metrics,
    };
    writeFileSync(`${RESULTS_DIR}/results.json`, JSON.stringify(results, null, 2));

    let before = new Map<string, Metric>();
    if (existsSync(BASELINE)) {
      try {
        const prev = JSON.parse(readFileSync(BASELINE, 'utf8')) as Results;
        before = new Map(prev.metrics.map((m) => [m.name, m]));
      } catch {
        // an unreadable baseline is the same as none
      }
    }
    const regressions: string[] = [];
    const f = (x: number) => (Number.isFinite(x) ? (x < 10 ? x.toFixed(2) : x.toFixed(1)) : '-');
    const rows = this.metrics.map((m) => {
      const b = before.get(m.name);
      let vs = '';
      if (b && m.unit === 'ms' && Number.isFinite(b.stat.p95)) {
        const ratio = m.stat.p95 / b.stat.p95;
        vs = `${f(b.stat.p95)} (x${ratio.toFixed(2)})`;
        if (m.stat.p95 > b.stat.p95 * FACTOR + SLACK_MS) {
          vs += ' ⚠';
          regressions.push(`${m.name}: p95 ${f(m.stat.p95)} ms, was ${f(b.stat.p95)} ms`);
        }
      }
      return `| ${m.name} | ${m.unit} | ${m.stat.n} | ${f(m.stat.p50)} | ${f(m.stat.p95)} | ${f(m.stat.p99)} | ${f(m.stat.max)} | ${vs} |${m.note ? ` ${m.note}` : ''}`;
    });
    const md = [
      '## Performance',
      '',
      '```json',
      JSON.stringify(this.info),
      '```',
      '',
      '| metric | unit | n | p50 | p95 | p99 | max | previous p95 | note |',
      '|---|---|---|---|---|---|---|---|---|',
      ...rows,
      '',
      before.size
        ? `⚠ = p95 above ${FACTOR}x the previous run plus ${SLACK_MS} ms.`
        : 'No previous run to compare with.',
      '',
    ].join('\n');
    writeFileSync(`${RESULTS_DIR}/summary.md`, md);
    return regressions;
  }
}
