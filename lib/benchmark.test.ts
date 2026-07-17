import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attestAnalysis } from "./attestation";
import { benchmarkReviews, renderBenchmarkMarkdown } from "./benchmark";
import type { Analysis } from "./types";

function analysis(decision: Analysis["decision"], attested: boolean): Analysis {
  const value: Analysis = { decision, contract: { promise: "p", code: "c", tests: "t", release: "r" }, rows: [{ criterion: "tests", evidence: "src/a.ts proves it", state: decision === "ready" ? "pass" : "warn", citations: [{ path: "src/a.ts", commitSha: "abc", url: "https://example.test/src/a.ts" }] }], trace: { fetchedSources: 1, citedSources: 1, unsupportedClaims: decision === "ready" ? 0 : 1, model: "test:model", elapsedMs: 10, headSha: "abc" } };
  if (attested) value.trace.attestation = attestAnalysis(value);
  return value;
}

describe("offline review benchmark", () => {
  it("scores saved analyses without a model or network", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-benchmark-"));
    try {
      const good = analysis("ready", true);
      await writeFile(join(root, "good.json"), JSON.stringify(good), "utf8");
      await writeFile(join(root, "bad.json"), JSON.stringify(analysis("needs-evidence", false)), "utf8");
      const summary = await benchmarkReviews(root, ["good.json", "bad.json"]);
      expect(summary.total).toBe(2);
      expect(summary.validAttestations).toBe(1);
      expect(summary.invalidAttestations).toBe(1);
      expect(summary.citationCoverage).toBe(1);
      expect(summary.unsupportedClaims).toBe(1);
      expect(renderBenchmarkMarkdown(summary)).toContain("Criterion citation coverage: 100.0%");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
