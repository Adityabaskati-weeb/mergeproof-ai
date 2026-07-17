import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clearFindings, readFindings, recordAgentFindings, setFindingDisposition } from "./findings";
import type { Analysis } from "./types";

const analysis: Analysis = {
  decision: "needs-evidence",
  contract: { promise: "p", code: "c", tests: "t", release: "r" },
  rows: [{ criterion: "Tests", evidence: "No tests cited.", state: "warn", citations: [] }],
  trace: { fetchedSources: 1, citedSources: 0, unsupportedClaims: 0, model: "test:model", elapsedMs: 1, headSha: "abc" },
};

describe("local review findings", () => {
  it("persists bounded findings and filters them by path/head", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-findings-"));
    try {
      expect(await recordAgentFindings(root, analysis)).toHaveLength(1);
      const finding = (await readFindings(root, { headSha: "abc", path: "(review contract)" }))[0];
      expect(finding.disposition).toBe("open");
      await setFindingDisposition(root, finding.id, "ignored", "not applicable");
      expect(await readFindings(root, { headSha: "abc" })).toHaveLength(0);
      expect((await readFindings(root, { headSha: "abc", includeIgnored: true }))[0].disposition).toBe("ignored");
      await setFindingDisposition(root, finding.id, "open");
      expect((await readFindings(root, { headSha: "abc" })).length).toBe(1);
      expect((await readFindings(root, { path: "missing.ts" })).length).toBe(0);
      expect((await readFile(join(root, ".mergeproof", "findings.jsonl"), "utf8")).split(/\r?\n/).filter(Boolean)).toHaveLength(1);
      await clearFindings(root);
      expect(await readFindings(root)).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
