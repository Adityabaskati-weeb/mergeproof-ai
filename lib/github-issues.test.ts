import { describe, expect, it } from "vitest";
import { buildGithubFollowUpDraft } from "./github-issues";
import type { Analysis } from "./types";

const analysis: Analysis = {
  decision: "needs-evidence",
  contract: { promise: "", code: "", tests: "", release: "" },
  rows: [{ criterion: "Rollback", evidence: "No rollback evidence", state: "warn", citations: [] }],
  securityFindings: [{ id: "secret", title: "Secret", severity: "high", path: "src/a.ts", line: 2, detail: "Secret literal", citation: { path: "src/a.ts", commitSha: "sha", url: "https://github.com/acme/app/blob/sha/src/a.ts#L2" }, category: "security" }],
  trace: { fetchedSources: 1, citedSources: 0, unsupportedClaims: 0, model: "test:model", elapsedMs: 1, headSha: "sha" },
  walkthrough: { summary: "", changeStack: [], sequenceDiagram: "", entityRelationshipDiagram: "", entityEvidence: [], effortScore: 1, effortReason: "", relatedIssues: [{ provider: "jira", key: "APP-1", summary: "Related", url: "https://jira.example/browse/APP-1" }], suggestedReviewers: [], suggestedLabels: [], citations: [], evidenceMode: "deterministic" },
};

describe("GitHub follow-up enrichment", () => {
  it("builds dedupe-safe, related-issue, and smart-label metadata", () => {
    const draft = buildGithubFollowUpDraft("https://github.com/acme/app/pull/7", analysis, "sha", "MergeProof follow-up");
    expect(draft.title).toBe("MergeProof follow-up");
    expect(draft.suggestedLabels).toEqual(["mergeproof", "mergeproof:needs-evidence", "security"]);
    expect(draft.relatedUrls).toEqual(["https://jira.example/browse/APP-1"]);
    expect(draft.body).toContain("Suggested labels");
    expect(draft.body).toContain("APP-1");
  });
});
