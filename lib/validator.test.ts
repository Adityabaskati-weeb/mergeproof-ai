import { describe, expect, it } from "vitest";
import type { PullRequestContext } from "./github";
import type { ModelAnalysis } from "./models";
import { validateAnalysis } from "./validator";

const context: PullRequestContext = {
  ref: { owner: "acme", repo: "payments", number: 42, url: "https://github.com/acme/payments/pull/42" },
  title: "Add retry policy",
  body: "## Acceptance Criteria\n- Retries twice",
  headSha: "abc123",
  baseSha: "def456",
  files: [{ path: "src/retry.ts", patch: "+retry", status: "modified", additions: 1, deletions: 0, url: "https://github.com/acme/payments/blob/abc123/src/retry.ts" }],
  checks: [],
  sources: new Set(["https://github.com/acme/payments/blob/abc123/src/retry.ts", "https://github.com/acme/payments/pull/42"]),
};

const contract = { promise: "Retry twice", code: "Retry loop", tests: "Unit test", release: "No migration" };

describe("validateAnalysis", () => {
  it("accepts citations with GitHub line anchors", () => {
    const result: ModelAnalysis = {
      contract,
      rows: [{ criterion: "Retries twice", evidence: "Retry loop is present.", state: "pass", citations: [{ path: "src/retry.ts", commitSha: "abc123", url: "https://github.com/acme/payments/blob/abc123/src/retry.ts#L1-L4" }] }],
    };
    expect(validateAnalysis(result, context, ["Retries twice"], "gpt-5.6", 12).decision).toBe("ready");
  });

  it("downgrades stale or invented citations", () => {
    const result: ModelAnalysis = {
      contract,
      rows: [{ criterion: "Retries twice", evidence: "The implementation is correct.", state: "pass", citations: [{ path: "src/retry.ts", commitSha: "wrong-sha", url: "https://example.com/invented" }] }],
    };
    const analysis = validateAnalysis(result, context, ["Retries twice"], "gpt-5.6", 12);
    expect(analysis.decision).toBe("needs-evidence");
    expect(analysis.trace.citedSources).toBe(0);
    expect(analysis.rows[0].state).toBe("warn");
  });

  it("rejects unsupported criteria claims and missing rows", () => {
    const result: ModelAnalysis = {
      contract,
      rows: [{ criterion: "Unrequested behavior", evidence: "Extra claim", state: "pass", citations: [{ path: "src/retry.ts", commitSha: "abc123", url: "https://github.com/acme/payments/blob/abc123/src/retry.ts" }] }],
    };
    const analysis = validateAnalysis(result, context, ["Retries twice"], "gpt-5.6", 12);
    expect(analysis.decision).toBe("needs-evidence");
    expect(analysis.trace.unsupportedClaims).toBe(1);
    expect(analysis.rows[0].state).toBe("fail");
  });

  it("accepts a citation from an explicitly linked repository commit", () => {
    const related = { ...context, sources: new Set([...context.sources, "file:///C:/shared/contracts.ts"]), sourceCommits: new Set(["related-sha"]) };
    const result: ModelAnalysis = {
      contract,
      rows: [{ criterion: "Retries twice", evidence: "The shared contract requires the retry behavior.", state: "pass", citations: [{ path: "contracts.ts", commitSha: "related-sha", url: "file:///C:/shared/contracts.ts#L1-L4" }] }],
    };
    expect(validateAnalysis(result, related, ["Retries twice"], "gpt-5.6", 12).decision).toBe("ready");
  });
});
