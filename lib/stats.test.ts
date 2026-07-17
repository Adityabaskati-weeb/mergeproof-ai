import { describe, expect, it } from "vitest";
import { buildReviewStats } from "./stats";

describe("review stats", () => {
  it("aggregates review, finding, and outcome history", () => {
    const result = buildReviewStats([
      { id: "a", recordedAt: "2026-01-01", action: "review", target: "x", decision: "ready", model: "test", attestation: "a", elapsedMs: 10 },
      { id: "b", recordedAt: "2026-01-02", action: "analyze", target: "y", decision: "needs-evidence", model: "test", elapsedMs: 30 },
    ], [
      { id: "f1", recordedAt: "2026-01-01", decision: "needs-evidence", severity: "major", disposition: "open", fileName: "a.ts", criterion: "x", comment: "x", codegenInstructions: "x", suggestions: [], citations: [], source: "criterion" },
      { id: "f2", recordedAt: "2026-01-01", decision: "needs-evidence", severity: "minor", disposition: "ignored", fileName: "b.ts", criterion: "y", comment: "y", codegenInstructions: "y", suggestions: [], citations: [], source: "criterion" },
    ], []);
    expect(result.reviews.total).toBe(2);
    expect(result.reviews.averageElapsedMs).toBe(20);
    expect(result.findings).toMatchObject({ total: 2, open: 1, ignored: 1 });
    expect(result.findings.bySeverity).toEqual({ major: 1, minor: 1 });
  });
});
