import { describe, expect, it } from "vitest";
import { evaluateAnalysis } from "./evaluation";

describe("evaluateAnalysis", () => {
  it("reports evidence coverage and abstention", () => {
    const report = evaluateAnalysis({ decision: "needs-evidence", contract: { promise: "", code: "", tests: "", release: "" }, rows: [{ criterion: "One", evidence: "", state: "warn", citations: [{ path: "a.ts", commitSha: "sha", url: "https://github.com/a/b/blob/sha/a.ts" }] }, { criterion: "Two", evidence: "", state: "fail", citations: [] }], trace: { fetchedSources: 1, citedSources: 1, unsupportedClaims: 2, model: "test", elapsedMs: 1, retrieval: { enabled: true, indexedChunks: 4, selectedChunks: 1 } } });
    expect(report.citationCoverage).toBe(0.5);
    expect(report.abstained).toBe(true);
    expect(report.retrievalChunks).toBe(1);
  });
});
