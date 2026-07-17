import { afterEach, describe, expect, it, vi } from "vitest";
import { publishChangeRequestCheck, publishChangeRequestComment, publishChangeRequestReview } from "./change-publish";
import { checkConclusionForAnalysis } from "./github-publish";
import { formatPullRequestSummary, mergePullRequestSummary, MERGEPROOF_SUMMARY_END, MERGEPROOF_SUMMARY_START, evaluateApprovalGate, reviewEventForAnalysis, reviewEventForDecision } from "./github-review";
import { attestAnalysis } from "./attestation";
import type { Analysis } from "./types";

afterEach(() => vi.unstubAllGlobals());

const analysis: Analysis = {
  decision: "needs-evidence",
  contract: { promise: "change", code: "code", tests: "tests", release: "release" },
  rows: [{ criterion: "keep behavior", evidence: "changed file", state: "warn", citations: [] }],
  trace: { fetchedSources: 1, citedSources: 0, unsupportedClaims: 0, model: "test:model", elapsedMs: 1, headSha: "git-sha" },
};

describe("provider publication", () => {
  it("honors the request-changes workflow policy", () => {
    expect(reviewEventForDecision("needs-evidence")).toBe("REQUEST_CHANGES");
    expect(reviewEventForDecision("needs-evidence", false)).toBe("COMMENT");
    expect(reviewEventForDecision("needs-owner", true)).toBe("COMMENT");
    expect(reviewEventForDecision("ready", false)).toBe("APPROVE");
  });

  it("keeps shadow checks neutral regardless of the model decision", () => {
    expect(checkConclusionForAnalysis({ ...analysis, decision: "needs-evidence" }, "shadow")).toBe("neutral");
    expect(checkConclusionForAnalysis({ ...analysis, decision: "ready" }, "shadow")).toBe("neutral");
    expect(checkConclusionForAnalysis({ ...analysis, decision: "ready" }, "enforce")).toBe("success");
  });

  it("publishes warning-only custom check failures as comments instead of request-changes", () => {
    const warningOnly = { ...analysis, trace: { ...analysis.trace, customCheckWarnings: 1, blockingFailures: 0 } };
    expect(reviewEventForAnalysis(warningOnly, true)).toBe("COMMENT");
    expect(checkConclusionForAnalysis(warningOnly, "enforce")).toBe("neutral");
  });

  it("requires proof completeness before an approval can be published", () => {
    const ready: Analysis = {
      ...analysis,
      decision: "ready",
      rows: [{ criterion: "keep behavior", evidence: "changed file", state: "pass", citations: [{ path: "src/index.ts", commitSha: "git-sha", url: "https://github.com/acme/payments/blob/git-sha/src/index.ts#L1" }] }],
      trace: { ...analysis.trace, citedSources: 1, blockingFailures: 0, attestation: undefined },
    };
    const unsigned = evaluateApprovalGate(ready, "git-sha");
    expect(unsigned.eligible).toBe(false);
    expect(unsigned.reasons).toContain("analysis attestation is missing or invalid");

    const signed = { ...ready, trace: { ...ready.trace, attestation: attestAnalysis(ready) } };
    expect(evaluateApprovalGate(signed, "git-sha")).toEqual({ eligible: true, reasons: [] });
    expect(evaluateApprovalGate(signed, "new-head").reasons).toContain("analysis head SHA does not match the current pull request head");
  });

  it("refreshes only the marker-scoped PR summary and preserves author content", () => {
    const first = formatPullRequestSummary(analysis);
    const body = `Author context\n\n${first}`;
    const refreshed = mergePullRequestSummary(body, formatPullRequestSummary({ ...analysis, decision: "ready" }));
    expect(refreshed).toContain("Author context");
    expect(refreshed).toContain("**Decision:** `ready`");
    expect(refreshed.match(new RegExp(MERGEPROOF_SUMMARY_START, "g"))).toHaveLength(1);
    expect(refreshed.match(new RegExp(MERGEPROOF_SUMMARY_END, "g"))).toHaveLength(1);
  });

  it("appends a generated summary when the PR body has no MergeProof block", () => {
    const summary = formatPullRequestSummary(analysis);
    expect(mergePullRequestSummary("Author context", summary)).toBe(`Author context\n\n${summary}`);
  });

  it("publishes GitLab status and review note through the normalized dispatcher", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      return { ok: true, status: 200, json: async () => ({ sha: "git-sha", web_url: "https://gitlab.com/note/1" }) };
    }));

    await publishChangeRequestCheck("https://gitlab.com/acme/payments/-/merge_requests/7", analysis);
    await publishChangeRequestReview("https://gitlab.com/acme/payments/-/merge_requests/7", analysis);

    expect(calls.some((call) => call.method === "POST" && call.url.includes("/statuses/"))).toBe(true);
    expect(calls.some((call) => call.method === "POST" && call.url.includes("/notes"))).toBe(true);
  });

  it("uses the Azure DevOps project segment before _git for provider comments", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return { ok: true, status: 200, json: async () => ({}) };
    }));
    await publishChangeRequestComment("https://dev.azure.com/acme/platform/_git/api/pullrequest/11", "hello");
    expect(calls[0]).toContain("/platform/_apis/git/repositories/api/pullRequests/11/threads");
  });
});
