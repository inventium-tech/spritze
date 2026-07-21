// Zero-dependency benchmark harness for Bun.
//
// Design notes (see bench/README.md for full methodology):
// - Timing uses Bun.nanoseconds() exclusively; no external packages.
// - Each case is measured in *batches* sized to land roughly in the
//   10-25ms range, so per-call overhead of Bun.nanoseconds() itself is
//   negligible relative to the measured work.
// - Warm-up runs for >=200ms (normal mode) before any sample is recorded.
// - Normal mode collects >=50 batch samples; quick mode may reduce both
//   the warm-up time and sample count, but never skips warm-up entirely.
// - No "no-op loop" duration is subtracted from results: every reported
//   number is the directly observed batch time, divided by batch size.
// - Every batch's return value is fed into a module-level volatile sink so
//   the optimizer cannot discard the work as dead code.

export interface CaseResult {
  readonly name: string;
  readonly batchSize: number;
  readonly samples: readonly number[]; // nanoseconds per batch
  readonly perOpNs: readonly number[]; // nanoseconds per single operation
  readonly stats: Stats;
}

export interface Stats {
  readonly median: number;
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  readonly iqr: number; // Q3 - Q1, nanoseconds per op
  readonly opsPerSec: number;
}

export interface BenchCase {
  readonly name: string;
  /** Human-readable one-line description of what the case measures. */
  readonly description: string;
  /**
   * Diagnostic cases are excluded from the default `bun run bench` run
   * (still runnable explicitly via --case) and must never be presented as
   * headline results.
   */
  readonly diagnostic?: boolean;
  /**
   * Run exactly one operation and return a value that must be fed to the
   * sink. Called many times per batch by the harness.
   */
  readonly run: () => unknown;
  /**
   * Optional per-batch setup hook, called before timing starts for a batch
   * and NOT included in the timed window. Use this for cases whose steady
   * state requires a fresh container per operation (e.g. cold singleton
   * resolution) where per-operation setup must happen but not be timed as
   * part of `run`.
   */
  readonly beforeBatch?: () => void;
}

export interface RunOptions {
  readonly quick: boolean;
  readonly warmupMs: number;
  readonly minSamples: number;
  readonly targetBatchMs: number;
}

export const NORMAL_OPTIONS: RunOptions = {
  quick: false,
  warmupMs: 250,
  minSamples: 51,
  targetBatchMs: 18,
};

export const QUICK_OPTIONS: RunOptions = {
  quick: true,
  warmupMs: 200, // still >= the 200ms floor required by spec
  minSamples: 15,
  targetBatchMs: 12,
};

// Volatile sink: every case result is consumed so V8/JavaScriptCore-style
// dead-code elimination cannot prove the computed values are unused. The
// checksum is written into a module-level variable with no observable read
// side effect; the write itself is the signal that the work must be retained.
let sinkChecksum = 0;

function consume(value: unknown): void {
  // Cheap, deterministic touch of the value so the call is not elidable.
  if (typeof value === "object" && value !== null) {
    sinkChecksum = (sinkChecksum + 1) | 0;
  } else if (typeof value === "number") {
    sinkChecksum = (sinkChecksum + value) | 0;
  }
}

function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 1) return sortedAsc[0] as number;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const loVal = sortedAsc[lo] as number;
  const hiVal = sortedAsc[hi] as number;
  if (lo === hi) return loVal;
  const frac = idx - lo;
  return loVal + (hiVal - loVal) * frac;
}

function computeStats(perOpNs: readonly number[]): Stats {
  const sorted = [...perOpNs].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;
  const median = percentile(sorted, 0.5);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const min = sorted[0] as number;
  const max = sorted[sorted.length - 1] as number;
  const opsPerSec = mean > 0 ? 1e9 / mean : 0;
  return { median, mean, min, max, iqr: q3 - q1, opsPerSec };
}

/**
 * Run one batch of `batchSize` operations and return elapsed nanoseconds.
 * Timing starts immediately before the loop and ends immediately after;
 * nothing else (allocation of the loop variable, etc.) is inside a
 * separately-timed region because there is no separate region to subtract.
 */
function runBatch(runOp: () => unknown, batchSize: number): number {
  const start = Bun.nanoseconds();
  for (let i = 0; i < batchSize; i++) {
    consume(runOp());
  }
  return Bun.nanoseconds() - start;
}

/**
 * Run one batch for a case that has an untimed per-operation `beforeBatch`
 * setup step (e.g. building a fresh container before timing only its first
 * resolve). Each operation pauses/resumes the clock around `beforeBatch`,
 * so the returned total reflects only `run()` time summed across the batch.
 *
 * This costs two extra Bun.nanoseconds() calls per operation compared to
 * runBatch; documented as a known limitation for cases that use it (see
 * bench/README.md).
 */
function runBatchWithUntimedSetup(bc: BenchCase, batchSize: number): number {
  const beforeBatch = bc.beforeBatch;
  if (!beforeBatch) {
    return runBatch(bc.run, batchSize);
  }
  let total = 0;
  for (let i = 0; i < batchSize; i++) {
    beforeBatch();
    const start = Bun.nanoseconds();
    consume(bc.run());
    total += Bun.nanoseconds() - start;
  }
  return total;
}

/**
 * Calibrate a batch size so a single batch takes roughly `targetMs`.
 * Starts small and doubles until the target is reached or a sane ceiling
 * is hit, so calibration itself stays fast.
 */
function calibrateBatchSize(bc: BenchCase, targetMs: number): number {
  const targetNs = targetMs * 1e6;
  let batchSize = 1;
  for (let attempt = 0; attempt < 30; attempt++) {
    const elapsed = runBatchWithUntimedSetup(bc, batchSize);
    if (elapsed >= targetNs || batchSize >= 1_000_000) {
      return batchSize;
    }
    // Grow proportionally to how far off we are, capped at 8x per step to
    // avoid wildly overshooting on the first fast batch.
    const ratio = elapsed > 0 ? targetNs / elapsed : 8;
    const growth = Math.min(8, Math.max(2, ratio));
    batchSize = Math.ceil(batchSize * growth);
  }
  return batchSize;
}

export function runCase(bc: BenchCase, options: RunOptions): CaseResult {
  // Warm up for >= warmupMs before recording anything.
  const warmupDeadline = Bun.nanoseconds() + options.warmupMs * 1e6;
  // Use a modest fixed batch during warm-up; exact size doesn't matter, it
  // just needs to keep the JIT/engine warm for the required duration.
  while (Bun.nanoseconds() < warmupDeadline) {
    for (let i = 0; i < 64; i++) {
      bc.beforeBatch?.();
      consume(bc.run());
    }
  }

  const batchSize = Math.max(1, calibrateBatchSize(bc, options.targetBatchMs));

  const samples: number[] = [];
  for (let s = 0; s < options.minSamples; s++) {
    samples.push(runBatchWithUntimedSetup(bc, batchSize));
  }

  const perOpNs = samples.map((ns) => ns / batchSize);
  const stats = computeStats(perOpNs);

  return { name: bc.name, batchSize, samples, perOpNs, stats };
}
