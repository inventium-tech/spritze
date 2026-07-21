import { describe, expect, it } from "bun:test";
import { type EnrichedResult, formatGrouped, formatJson, formatNs, parseArgs, renderHelp } from "../bench/report.ts";

function syntheticResult(overrides: {
  readonly scenario: string;
  readonly diagnostic?: boolean;
  readonly group: string;
  readonly phase?: "hot" | "cold" | "setup";
  readonly meaning?: string;
  readonly median?: number;
}): EnrichedResult {
  const samples = [100, 110, 120, 130, 140];
  const perOpNs = samples.map((n) => n / 10);
  const mean = perOpNs.reduce((a, b) => a + b, 0) / perOpNs.length;
  return {
    scenario: overrides.scenario,
    description: `desc-${overrides.scenario}`,
    diagnostic: overrides.diagnostic ?? false,
    batchSize: 10,
    samples,
    perOpNs,
    stats: {
      median: overrides.median ?? 11,
      mean,
      min: Math.min(...perOpNs),
      max: Math.max(...perOpNs),
      iqr: 2,
      opsPerSec: mean > 0 ? 1e9 / mean : 0,
    },
    presentation: {
      group: overrides.group,
      phase: overrides.phase ?? "hot",
      meaning: overrides.meaning ?? "meaning",
    },
  };
}

describe("parseArgs", () => {
  it("parses default flags", () => {
    const cli = parseArgs([]);
    expect(cli.quick).toBe(false);
    expect(cli.caseName).toBeUndefined();
    expect(cli.outputMode).toBe("default");
    expect(cli.errors).toHaveLength(0);
  });

  it("parses --quick", () => {
    expect(parseArgs(["--quick"]).quick).toBe(true);
  });

  it("parses --case <name>", () => {
    expect(parseArgs(["--case", "foo"]).caseName).toBe("foo");
  });

  it("parses --case=<name>", () => {
    expect(parseArgs(["--case=foo"]).caseName).toBe("foo");
  });

  it("rejects missing --case value", () => {
    const cli = parseArgs(["--case"]);
    expect(cli.errors).toContain("--case requires a scenario name");
    expect(cli.outputMode).toBe("default");
  });

  it("rejects empty --case= value", () => {
    const cli = parseArgs(["--case="]);
    expect(cli.errors).toContain("--case= requires a scenario name");
  });

  it("parses --details", () => {
    expect(parseArgs(["--details"]).outputMode).toBe("details");
  });

  it("parses --json", () => {
    expect(parseArgs(["--json"]).outputMode).toBe("json");
  });

  it("parses --help", () => {
    expect(parseArgs(["--help"]).outputMode).toBe("help");
    expect(parseArgs(["-h"]).outputMode).toBe("help");
  });

  it("rejects --details with --json", () => {
    const cli = parseArgs(["--details", "--json"]);
    expect(cli.errors).toContain("--details and --json cannot be used together");
  });

  it("rejects unknown options", () => {
    const cli = parseArgs(["--unknown"]);
    expect(cli.errors).toContain("Unknown option: --unknown");
  });
});

describe("formatNs", () => {
  it("renders nanoseconds when small", () => {
    expect(formatNs(12.3)).toBe("12.3 ns");
  });

  it("renders microseconds", () => {
    expect(formatNs(1234)).toBe("1.234 us");
  });

  it("renders milliseconds", () => {
    expect(formatNs(1_234_567)).toBe("1.235 ms");
  });
});

describe("formatGrouped", () => {
  it("groups deterministic order and labels diagnostics", () => {
    const results = [
      syntheticResult({ scenario: "setup-a", group: "Setup", phase: "setup" }),
      syntheticResult({ scenario: "hot-a", group: "Hot resolution" }),
      syntheticResult({ scenario: "cold-a", group: "Cold resolution", phase: "cold" }),
      syntheticResult({
        scenario: "diag-a",
        group: "Diagnostics",
        diagnostic: true,
        phase: "hot",
      }),
    ];
    const text = formatGrouped(results);
    const groupOrder = ["Hot resolution", "Cold resolution", "Setup", "Diagnostics"];
    const offsets = groupOrder.map((g) => text.indexOf(g));
    expect(offsets.every((o) => o >= 0)).toBe(true);
    const isAscending = offsets.every((offset, i) => i === 0 || offset > (offsets[i - 1] ?? -Infinity));
    expect(isAscending).toBe(true);
    expect(text).toContain("diag-a [diagnostic]");
  });

  it("does not show ratio or winner claims", () => {
    const text = formatGrouped([
      syntheticResult({ scenario: "a", group: "Hot resolution" }),
      syntheticResult({ scenario: "b", group: "Hot resolution" }),
    ]);
    expect(text).not.toMatch(/winner|fastest|vs|x\s*faster|slower/i);
  });

  it("renders median ns/op and plain-language meaning by default", () => {
    const text = formatGrouped([
      syntheticResult({
        scenario: "direct",
        group: "Hot resolution",
        median: 42,
        meaning: "cache-hit direct class lookup",
      }),
    ]);
    expect(text).toContain("direct");
    expect(text).toContain("42.0 ns");
    expect(text).toContain("cache-hit direct class lookup");
  });
});

describe("formatGrouped details mode", () => {
  it("includes all stats and batch info", () => {
    const text = formatGrouped([syntheticResult({ scenario: "a", group: "Hot resolution" })], { details: true });
    expect(text).toContain("median/op");
    expect(text).toContain("mean/op");
    expect(text).toContain("min/op");
    expect(text).toContain("max/op");
    expect(text).toContain("iqr/op");
    expect(text).toContain("ops/sec");
    expect(text).toContain("batch:");
    expect(text).toContain("samples:");
  });
});

describe("formatJson", () => {
  it("produces parseable JSON with metadata and schema version", () => {
    const run = {
      schemaVersion: 1,
      meta: {
        bunVersion: "1.0.0",
        platform: "linux",
        arch: "x64",
        gitRevision: "abc",
        gitDirty: false,
        cpuModel: "Test CPU",
        logicalCpuCount: 4,
        command: "bun bench",
        mode: "quick" as const,
        timestamp: new Date().toISOString(),
      },
      results: [syntheticResult({ scenario: "a", group: "Hot resolution" })],
    };
    const out = formatJson(run);
    const parsed = JSON.parse(out);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.meta.bunVersion).toBe("1.0.0");
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].presentation.group).toBe("Hot resolution");
  });
});

describe("renderHelp", () => {
  it("mentions key flags and examples", () => {
    const help = renderHelp();
    expect(help).toContain("--case");
    expect(help).toContain("--quick");
    expect(help).toContain("--details");
    expect(help).toContain("--json");
    expect(help).toContain("--help");
  });
});
