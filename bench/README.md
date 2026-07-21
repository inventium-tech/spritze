# Spritze benchmarks

Zero-dependency Bun micro-benchmarks for Spritze's dependency-injection hot
paths. No external packages; timing uses `Bun.nanoseconds()` exclusively.

## Running

```sh
bun run bench                  # normal run, grouped headline output
bun run bench:quick            # quick run (shorter warm-up, fewer samples)
bun run bench -- --details     # complete per-case statistics
bun run bench -- --json        # machine-readable JSON only (stdout)
bun run bench -- --case <name> # run a single scenario, normal settings
bun run bench -- --case <name> --quick
```

Default output groups scenarios under plain labels and prints the median
nanoseconds per operation plus a plain-language meaning line, without ratio or
winner claims. For full statistics use `--details`; for captured results use
`--json > results.json`. Redirecting `--json` output yields valid JSON because
no human text is emitted; this repository does not commit benchmark results.

Before timing or printing results, the runner performs semantic preflight
checks covering fixture bindings, transient/singleton lifetimes, graph wiring,
and per-container singleton isolation. A failed check aborts the run without
reporting benchmark data.

## Methodology

- **Timing source**: `Bun.nanoseconds()` only. No `performance.now()`, no
  external benchmarking package (no `mitata`, `tinybench`, etc.).
- **Batching**: each case runs in batches of N back-to-back operations,
  sized so one batch takes roughly 10-25ms. This keeps `Bun.nanoseconds()`
  call overhead and loop bookkeeping a small fraction of the measured work.
  Batch size is calibrated per case at the start of each run/case and then
  held fixed for all samples of that case.
- **Warm-up**: every case is warmed up for at least 200ms (250ms in normal
  mode) before any sample is recorded, so JIT tiering has a chance to
  stabilize before measurement starts.
- **Samples**: normal mode collects at least 51 batch samples per case;
  quick mode reduces this to 15 to keep local iteration fast. Quick-mode
  numbers are for local sanity checks only, not for any headline claim.
- **No baseline subtraction**: reported per-operation numbers are the
  directly observed batch time divided by batch size. Spritze does not
  subtract a "no-op loop" baseline from any result. If overhead from the
  harness itself (loop counter increments, function call overhead) matters
  to your use case, treat every number here as an upper bound including
  that overhead, not a pure isolation of DI resolution cost.
- **Volatile sink**: every operation's return value is written into a
  module-level variable and lightly touched (a cheap arithmetic/identity
  check) so the JavaScript engine cannot prove the computed value is dead
  and elide the work. This is a heuristic, not a guarantee against every
  possible optimization; see "Limitations" below.
- **Setup exclusion**: for cases whose steady-state operation legitimately
  requires untimed per-operation setup (currently only
  `cold-singleton-graph`, which must build a fresh container before timing
  its first resolve), the harness pauses the clock around that setup step
  using two additional `Bun.nanoseconds()` calls per operation instead of
  one. This adds a small, consistent timer-call overhead to that scenario
  specifically; it is not present in any other case.
- **Statistics reported per case**: median, mean, min, max, interquartile
  range (Q3 - Q1), and operations/second (derived from the mean). All are
  computed over per-operation nanoseconds (batch time / batch size).
  Default grouped output shows only the median and a meaning line.
- **Groups and presentation labels**: each scenario belongs to a
  presentation group (`Hot resolution`, `Cold resolution`, `Setup`, or
  `Diagnostics`) and carries a `phase` (`hot`/`cold`/`setup`) plus a short
  plain-language `meaning`. Groups print in that deterministic order.
- **JSON output schema**: schema version `1`. The JSON object has `meta`
  and `results`. `meta` includes Bun version, `process.platform`,
  `process.arch`, CPU model and logical CPU count, current git revision
  (`git rev-parse HEAD`, or `"unknown"` if unavailable), whether the
  working tree is dirty, the exact process command (`Bun.argv`), run mode
  (`normal`/`quick`), and an ISO timestamp. Each result includes scenario
  name, description, diagnostic flag, batch size, every raw batch sample
  (ns), every derived per-operation value (ns), computed stats, and
  presentation group/phase/meaning.

## Scenarios

| name | group | measures |
| --- | --- | --- |
| `direct-cached-singleton` | Hot resolution | `resolve(Class)` for an already-cached singleton, by direct class reference. Isolates the cache-hit path. |
| `token-singleton-alias` | Hot resolution | `resolve(Token)` for a token bound to an already-cached singleton class. Isolates token-lookup + cache-hit vs. direct class reference. |
| `transient-leaf` | Hot resolution | `resolve(Class)` for a transient class with zero dependencies. Isolates per-call construction overhead with no graph traversal. |
| `mixed-transient-graph` | Hot resolution | `resolve(Root)` for an 8-node transient graph mixing class dependencies, a token bound to a singleton class, and a token bound to a plain value. Representative of realistic composition, not a worst case. |
| `cold-singleton-graph` | Cold resolution | Build a fresh container, bind all fixtures, then resolve a 3-node singleton graph exactly once (first resolution, before anything is cached). Container build + bindings are excluded from the timed window; only the `resolve()` call is timed. |
| `cached-singleton-graph` | Hot resolution | `resolve(Root)` for the same singleton graph as above, once every node is already cached. |
| `container-setup` | Setup | `createContainer()` plus every fixture binding call. Measures one-time setup cost, not resolution. |
| `token-value-lookup` | Hot resolution | `resolve(Token)` for a token bound directly to a plain value (no class construction). |
| `factory-transient` | Hot resolution | `resolve(Token)` for a token bound to a transient factory with no nested dependencies. |
| `factory-singleton-cached` | Hot resolution | `resolve(Token)` for a token bound to an already-cached singleton factory. |
| `factory-with-deps` | Hot resolution | `resolve(Token)` for a transient factory that resolves a transient leaf and a cached singleton. |
| `token-class-lookup-diagnostic` | Diagnostics *(diagnostic, excluded from default run)* | `resolve(Token)` for a token bound to an already-cached singleton class, run in isolation to help separate token-lookup cost from other scenarios' overhead. Not a headline result; do not quote in isolation as a performance claim. |

Diagnostic scenarios are never included in the default `bun run bench` /
`bun run bench:quick` output; they must be requested explicitly via
`--case <name>` and must not be presented as headline results.

## Reproducibility limits

- Results depend on the exact Bun version, OS, CPU, machine load, and power
  state at capture time. A number from one machine is not directly
  comparable to a number from another.
- This harness runs in a single process with no CPU pinning, no isolation
  from other processes on the machine, and no repeated-run statistical
  aggregation across process restarts. Treat single-run output as
  indicative, not authoritative; for any claim that matters, run multiple
  times and look at the spread (min/max/IQR) across runs, not just within
  one run's samples.
- V8/JavaScriptCore-class JIT engines can still optimize code in ways a
  volatile sink does not fully prevent (e.g. hoisting invariant sub-
  expressions across loop iterations in especially simple cases). The sink
  strategy used here is standard practice for zero-dependency
  micro-benchmarking but is not a formal guarantee.
- `bun run bench:quick` numbers use shorter warm-up and far fewer samples
  than normal mode and are intended for fast local iteration while editing
  the harness or fixtures, not for recording or citing results.

## What this does not claim

- No specific current numbers are recorded in this document or in the
  repository's `ROADMAP.md`. Marking the benchmark infrastructure task done
  means the harness exists and runs correctly, not that any particular
  performance figure has been achieved or published.
- No comparison is made, implied, or intended against any other dependency
  injection library, framework, or runtime. These benchmarks measure only
  Spritze's own code paths against itself over time, on whatever machine
  they are run on.
- "Fast" and "small" claims elsewhere in this project's documentation are
  falsifiable via this harness, but this harness by itself does not assert
  that any such claim is currently true or false; that requires actually
  running it and looking at the numbers in context.
