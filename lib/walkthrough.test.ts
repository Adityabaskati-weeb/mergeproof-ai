import { describe, expect, it } from "vitest";
import { buildWalkthrough, renderWalkthroughMarkdown } from "./walkthrough";
import type { PullRequestContext } from "./github";

function context(): PullRequestContext {
  return {
    ref: { owner: "acme", repo: "app", number: 7, url: "https://github.com/acme/app/pull/7" },
    title: "Add payment retry flow",
    body: "## Acceptance Criteria\n- Retries are bounded",
    headSha: "head-sha",
    baseSha: "base-sha",
    files: [
      { path: "src/types/payment.ts", patch: "+export type Payment = {}", status: "modified", additions: 1, deletions: 0, url: "https://github.com/acme/app/blob/head-sha/src/types/payment.ts" },
      { path: "src/payment/service.ts", patch: "+export function retry() {}", status: "modified", additions: 1, deletions: 0, url: "https://github.com/acme/app/blob/head-sha/src/payment/service.ts" },
      { path: "tests/payment.test.ts", patch: "+it(\"retries\")", status: "added", additions: 1, deletions: 0, url: "https://github.com/acme/app/blob/head-sha/tests/payment.test.ts" },
    ],
    checks: [],
    sources: new Set(["https://github.com/acme/app/pull/7"]),
    issues: [],
    suggestedReviewers: ["@payments-team"],
  };
}

describe("review walkthrough", () => {
  it("groups changes into an ordered evidence-backed stack", () => {
    const walkthrough = buildWalkthrough(context(), { decision: "needs-evidence", contract: { promise: "Bounded retries", code: "", tests: "", release: "" } });
    expect(walkthrough.changeStack.map((layer) => layer.id)).toEqual(["contract", "integration", "tests"]);
    expect(walkthrough.citations).toHaveLength(3);
    expect(walkthrough.effortScore).toBe(1);
    expect(walkthrough.sequenceDiagram).toContain("sequenceDiagram");
    expect(walkthrough.sequenceDiagram).toContain("Evidence-derived change flow");
    expect(walkthrough.suggestedReviewers).toEqual(["@payments-team"]);
    expect(walkthrough.suggestedLabels).toEqual(["tests"]);
  });

  it("renders a publishable markdown artifact without inventing sources", () => {
    const walkthrough = buildWalkthrough(context());
    const markdown = renderWalkthroughMarkdown(walkthrough, "needs-owner");
    expect(markdown).toContain("## MergeProof walkthrough");
    expect(markdown).toContain("Decision:");
    expect(markdown).toContain("src/payment/service.ts");
    expect(markdown).toContain("https://github.com/acme/app/blob/head-sha/src/payment/service.ts");
    expect(markdown).toContain("```mermaid");
  });
});
