// Benchmark scenario definitions and CLI runner for Spritze's DI hot paths.
//
// Usage:
//   bun run bench                    # normal run, grouped headline output
//   bun run bench:quick              # quick run, grouped headline output
//   bun run bench -- --case <name>   # run a single case by name (headline
//                                    # or diagnostic), normal settings
//   bun run bench -- --case <name> --quick
//   bun run bench -- --details       # complete per-case statistics
//   bun run bench -- --json          # valid machine-readable JSON only

import { cpus } from "node:os";
import { type Container, createContainer } from "../src/index.ts";
import {
  assertFixtureSemantics,
  bindAll,
  buildContainer,
  CachedSingleton,
  ConfigToken,
  FactorySingletonToken,
  FactoryTransientToken,
  FactoryWithDepsToken,
  LoggerToken,
  MixedGraphRoot,
  SingletonGraphRoot,
  TokenBoundSingletonToken,
  TransientLeaf,
} from "./fixtures.ts";
import { type BenchCase, type CaseResult, NORMAL_OPTIONS, QUICK_OPTIONS, type RunOptions, runCase } from "./harness.ts";
import {
  type BenchmarkRunJson,
  type EnrichedResult,
  formatGrouped,
  type OutputMode,
  parseArgs,
  renderHelp,
  selectCases,
} from "./report.ts";

// --- Scenario setup ------------------------------------------------------
// Container(s) built once, outside timing, and reused by every case except
// container-setup (which measures exactly this construction) and
// cold-singleton-graph (which must build a fresh container per operation).

const sharedContainer: Container = buildContainer();
// Force the cached-singleton scenarios to warm state ahead of measurement;
// the harness's own warm-up loop also does this, but this makes intent
// explicit for readers of this file.
sharedContainer.resolve(CachedSingleton);
sharedContainer.resolve(TokenBoundSingletonToken);
sharedContainer.resolve(SingletonGraphRoot);

function buildColdSingletonGraphContainer(): Container {
  const c = bindAll(createContainer());
  return c;
}

let coldContainer: Container;

interface ScenarioConfig {
  readonly name: string;
  readonly description: string;
  readonly diagnostic?: boolean;
  readonly run: () => unknown;
  readonly beforeBatch?: () => void;
  readonly group: string;
  readonly phase: "hot" | "cold" | "setup";
  readonly meaning: string;
}

const scenarios: readonly ScenarioConfig[] = [
  {
    name: "direct-cached-singleton",
    description: "resolve(CachedSingleton) by class reference after the singleton is already cached.",
    run: () => sharedContainer.resolve(CachedSingleton),
    group: "Hot resolution",
    phase: "hot",
    meaning: "cache-hit direct class lookup",
  },
  {
    name: "token-singleton-alias",
    description: "resolve(TokenBoundSingletonToken) via a token bound to a singleton class, already cached.",
    run: () => sharedContainer.resolve(TokenBoundSingletonToken),
    group: "Hot resolution",
    phase: "hot",
    meaning: "token-bound singleton alias",
  },
  {
    name: "transient-leaf",
    description: "resolve(TransientLeaf): a transient class with zero dependencies.",
    run: () => sharedContainer.resolve(TransientLeaf),
    group: "Hot resolution",
    phase: "hot",
    meaning: "zero-dep transient construction",
  },
  {
    name: "mixed-transient-graph",
    description: "resolve(MixedGraphRoot): an 8-node transient graph mixing class, token, and value deps.",
    run: () => sharedContainer.resolve(MixedGraphRoot),
    group: "Hot resolution",
    phase: "hot",
    meaning: "8-node mixed transient graph",
  },
  {
    name: "cold-singleton-graph",
    description:
      "Build a fresh container, bind all fixtures, then resolve SingletonGraphRoot exactly once " +
      "(first resolution only). Container build + bindings happen outside the timed window; only " +
      "the resolve() call is timed.",
    beforeBatch: () => {
      coldContainer = buildColdSingletonGraphContainer();
    },
    run: () => coldContainer.resolve(SingletonGraphRoot),
    group: "Cold resolution",
    phase: "cold",
    meaning: "first-resolve singleton graph on a fresh container",
  },
  {
    name: "cached-singleton-graph",
    description: "resolve(SingletonGraphRoot) on a container where the whole singleton graph is already cached.",
    run: () => sharedContainer.resolve(SingletonGraphRoot),
    group: "Hot resolution",
    phase: "hot",
    meaning: "warm singleton graph cache",
  },
  {
    name: "container-setup",
    description: "createContainer() plus every fixture binding (bindAll): the one-time setup cost, not resolution.",
    run: () => bindAll(createContainer()),
    group: "Setup",
    phase: "setup",
    meaning: "container and binding creation",
  },
  {
    name: "token-value-lookup",
    description: "resolve(ConfigToken): a token bound directly to a plain value.",
    run: () => sharedContainer.resolve(ConfigToken),
    group: "Hot resolution",
    phase: "hot",
    meaning: "value token lookup",
  },
  {
    name: "factory-transient",
    description: "resolve(FactoryTransientToken): a token bound to a transient factory with no nested dependencies.",
    run: () => sharedContainer.resolve(FactoryTransientToken),
    group: "Hot resolution",
    phase: "hot",
    meaning: "transient factory call",
  },
  {
    name: "factory-singleton-cached",
    description: "resolve(FactorySingletonToken): a token bound to a singleton factory, already cached.",
    run: () => sharedContainer.resolve(FactorySingletonToken),
    group: "Hot resolution",
    phase: "hot",
    meaning: "cached singleton factory result",
  },
  {
    name: "factory-with-deps",
    description:
      "resolve(FactoryWithDepsToken): a transient factory that resolves a transient leaf and a cached singleton.",
    run: () => sharedContainer.resolve(FactoryWithDepsToken),
    group: "Hot resolution",
    phase: "hot",
    meaning: "factory with nested transient and singleton",
  },
  {
    name: "token-class-lookup-diagnostic",
    description:
      "Diagnostic only: resolve(LoggerToken), a token bound to a singleton class, isolating the " +
      "token-to-binding lookup step from the direct-class-reference path. Not a headline result.",
    diagnostic: true,
    run: () => sharedContainer.resolve(LoggerToken),
    group: "Diagnostics",
    phase: "hot",
    meaning: "token-to-class lookup in isolation",
  },
];

function toBenchCase(sc: ScenarioConfig): BenchCase {
  return {
    name: sc.name,
    description: sc.description,
    diagnostic: sc.diagnostic,
    run: sc.run,
    beforeBatch: sc.beforeBatch,
  };
}

async function gitRevision(): Promise<string> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "ignore" });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) return "unknown";
    return out.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

async function gitDirty(): Promise<boolean | "unknown"> {
  try {
    const proc = Bun.spawn(["git", "status", "--porcelain", "--untracked-files=normal"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    return code === 0 ? out.length > 0 : "unknown";
  } catch {
    return "unknown";
  }
}

async function buildJson(results: readonly EnrichedResult[], mode: "normal" | "quick"): Promise<BenchmarkRunJson> {
  return {
    schemaVersion: 1,
    meta: {
      bunVersion: Bun.version,
      platform: process.platform,
      arch: process.arch,
      gitRevision: await gitRevision(),
      gitDirty: await gitDirty(),
      cpuModel: cpus()[0]?.model ?? "unknown",
      logicalCpuCount: cpus().length,
      command: Bun.argv.join(" "),
      mode,
      timestamp: new Date().toISOString(),
    },
    results,
  };
}

function exit(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

async function main(): Promise<void> {
  const argv = Bun.argv.slice(2);
  const cli = parseArgs(argv);

  if (cli.errors.length > 0) {
    exit(`${cli.errors.map((e) => `error: ${e}`).join("\n")}\n\n${renderHelp()}`);
  }

  if (cli.outputMode === "help") {
    console.log(renderHelp());
    process.exit(0);
  }

  const options: RunOptions = cli.quick ? QUICK_OPTIONS : NORMAL_OPTIONS;
  const mode: "normal" | "quick" = cli.quick ? "quick" : "normal";

  let rawOutputMode: OutputMode = cli.outputMode;
  if (cli.caseName && rawOutputMode === "default") {
    // A single explicit case is most useful with complete numbers.
    rawOutputMode = "details";
  }

  let selected: readonly BenchCase[];
  try {
    selected = selectCases(cli.caseName, scenarios.map(toBenchCase));
  } catch (err) {
    exit(err instanceof Error ? err.message : String(err));
  }

  assertFixtureSemantics();

  const runResults: EnrichedResult[] = [];
  for (const sc of scenarios) {
    if (!selected.some((s) => s.name === sc.name)) continue;

    const result: CaseResult = runCase(toBenchCase(sc), options);
    const enriched: EnrichedResult = {
      scenario: sc.name,
      description: sc.description,
      diagnostic: Boolean(sc.diagnostic),
      batchSize: result.batchSize,
      samples: result.samples,
      perOpNs: result.perOpNs,
      stats: result.stats,
      presentation: {
        group: sc.group,
        phase: sc.phase,
        meaning: sc.meaning,
      },
    };
    runResults.push(enriched);
  }

  if (rawOutputMode === "json") {
    const run = await buildJson(runResults, mode);
    console.log(JSON.stringify(run, null, 2));
    return;
  }

  // Human text modes print after measurement. No raw JSON suffix.
  console.log(formatGrouped(runResults, { details: rawOutputMode === "details" }));
}

await main();
