import { describe, expect, it } from "vitest";
import { renderInteractiveFinding } from "./review-interactive";
import type { StoredFinding } from "./findings";

describe("interactive review presentation", () => {
  it("renders actionable, disposition-aware finding context", () => {
    const finding: StoredFinding = { id: "finding-1", recordedAt: "2026-01-01T00:00:00.000Z", decision: "needs-evidence", disposition: "ignored", severity: "major", fileName: "src/auth.ts", line: 42, criterion: "Authentication", comment: "Missing evidence.", codegenInstructions: "Add a regression test.", suggestions: [], citations: [], source: "criterion" };
    const output = renderInteractiveFinding(finding, 0, 1);
    expect(output).toContain("IGNORED");
    expect(output).toContain("src/auth.ts:42");
    expect(output).toContain("i ignore");
  });
});
