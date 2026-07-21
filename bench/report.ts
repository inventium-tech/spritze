// Pure benchmark reporting helpers: CLI parsing, deterministic grouping,
// human-readable default/details text, and valid JSON output.
//
// This module has no side effects and does not depend on Bun globals beyond
// what callers pass in, so it can be unit-tested with synthetic data.

import type { BenchCase, CaseResult } from "./harness.ts";

export type OutputMode = "default" | "details" | "json" | "help";

export interface ParsedCli {
  readonly quick: boolean;
  readonly caseName: string | undefined;
  readonly outputMode: OutputMode;
  readonly errors: readonly string[];
}

export interface EnrichedResult {
  readonly scenario: string;
  readonly description: string;
  readonly diagnostic: boolean;
  readonly batchSize: number;
  readonly samples: readonly number[];
  readonly perOpNs: readonly number[];
  readonly stats: CaseResult["stats"];
  readonly presentation: {
    readonly group: string;
    readonly phase: string;
    readonly meaning: string;
  };
}

export interface BenchmarkRunJson {
  readonly schemaVersion: number;
  readonly meta: {
    readonly bunVersion: string;
    readonly platform: string;
    readonly arch: string;
    readonly gitRevision: string;
    readonly gitDirty: boolean | "unknown";
    readonly cpuModel: string;
    readonly logicalCpuCount: number;
    readonly command: string;
    readonly mode: "normal" | "quick";
    readonly timestamp: string;
  };
  readonly results: readonly EnrichedResult[];
}

const GROUP_ORDER = ["Hot resolution", "Cold resolution", "Setup", "Diagnostics"];

export function parseArgs(argv: readonly string[]): ParsedCli {
  let quick = false;
  let caseName: string | undefined;
  let details = false;
  let json = false;
  let help = false;
  const errors: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--quick") {
      quick = true;
    } else if (arg === "--details") {
      details = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--case") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        errors.push("--case requires a scenario name");
      } else {
        caseName = next;
        i++;
      }
    } else if (arg.startsWith("--case=")) {
      const value = arg.slice("--case=".length);
      if (value.length === 0) {
        errors.push("--case= requires a scenario name");
      } else {
        caseName = value;
      }
    } else {
      errors.push(`Unknown option: ${arg}`);
    }
  }

  if (details && json) {
    errors.push("--details and --json cannot be used together");
  }

  let outputMode: OutputMode = "default";
  if (errors.length === 0) {
    if (help) outputMode = "help";
    else if (json) outputMode = "json";
    else if (details) outputMode = "details";
  }

  return { quick, caseName, outputMode, errors };
}

export function selectCases(caseName: string | undefined, all: readonly BenchCase[]): readonly BenchCase[] {
  if (caseName) {
    const found = all.find((c) => c.name === caseName);
    if (!found) {
      const names = all.map((c) => c.name).join(", ");
      throw new Error(`Unknown bench case "${caseName}". Known cases: ${names}`);
    }
    return [found];
  }
  return all.filter((c) => !c.diagnostic);
}

export function renderHelp(): string {
  return [
    "Usage: bun run bench [options]",
    "       bun run bench:quick [options]",
    "",
    "Options:",
    "  --case <name>   Run a single scenario by name (headline or diagnostic)",
    "  --case=<name>",
    "  --quick         Reduce warm-up and sample count for fast iteration",
    "  --details       Print complete per-scenario statistics",
    "  --json          Print only valid JSON to stdout",
    "  --help, -h      Show this help message",
    "",
    "Examples:",
    "  bun run bench",
    "  bun run bench:quick",
    "  bun run bench -- --case token-class-lookup-diagnostic --quick",
    "  bun run bench -- --details",
    "  bun run bench -- --json > results.json",
    "",
  ].join("\n");
}

export function formatNs(ns: number): string {
  if (ns >= 1e6) return `${(ns / 1e6).toFixed(3)} ms`;
  if (ns >= 1e3) return `${(ns / 1e3).toFixed(3)} us`;
  return `${ns.toFixed(1)} ns`;
}

function groupIndex(group: string): number {
  const idx = GROUP_ORDER.indexOf(group);
  return idx >= 0 ? idx : GROUP_ORDER.length;
}

function groupResults(results: readonly EnrichedResult[]): Map<string, EnrichedResult[]> {
  const sorted = [...results].sort((a, b) => {
    const ga = groupIndex(a.presentation.group);
    const gb = groupIndex(b.presentation.group);
    if (ga !== gb) return ga - gb;
    // Preserve input order within a group (cases are already deterministic).
    const ia = results.indexOf(a);
    const ib = results.indexOf(b);
    return ia - ib;
  });

  const map = new Map<string, EnrichedResult[]>();
  for (const r of sorted) {
    const list = map.get(r.presentation.group) ?? [];
    list.push(r);
    map.set(r.presentation.group, list);
  }
  return map;
}

function scenarioColumnWidth(results: readonly EnrichedResult[]): number {
  return Math.max(1, ...results.map((r) => r.scenario.length));
}

export function formatGrouped(
  results: readonly EnrichedResult[],
  options: { readonly details?: boolean } = {},
): string {
  if (results.length === 0) {
    return "No benchmark results.\n";
  }

  const groups = groupResults(results);
  const width = scenarioColumnWidth(results);
  const lines: string[] = [];
  let firstGroup = true;

  for (const [group, items] of groups) {
    if (!firstGroup) lines.push("");
    lines.push(group);
    for (const item of items) {
      const tag = item.diagnostic ? " [diagnostic]" : "";
      if (options.details) {
        const s = item.stats;
        lines.push(`  ${item.scenario}${tag}`);
        lines.push(`    median/op: ${formatNs(s.median)}   ${item.presentation.meaning}`);
        lines.push(
          [
            `    mean/op:   ${formatNs(s.mean)}`,
            `min/op: ${formatNs(s.min)}`,
            `max/op: ${formatNs(s.max)}`,
            `iqr/op: ${formatNs(s.iqr)}`,
            `ops/sec: ${s.opsPerSec.toFixed(0)}`,
            `batch: ${item.batchSize}`,
            `samples: ${item.samples.length}`,
          ].join("  "),
        );
      } else {
        const label = `${item.scenario}${tag}`.padEnd(width + tag.length);
        lines.push(`  ${label}  ${formatNs(item.stats.median).padStart(11)}  ${item.presentation.meaning}`);
      }
    }
    firstGroup = false;
  }

  return `${lines.join("\n")}\n`;
}

export function formatJson(run: BenchmarkRunJson): string {
  return `${JSON.stringify(run, null, 2)}\n`;
}
