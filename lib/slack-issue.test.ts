import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./analyze", () => ({
  analyzePullRequest: vi.fn(async () => ({ decision: "needs-evidence", rows: [{ criterion: "rate limiting", evidence: "No proof", state: "warn", citations: [] }], trace: { citedSources: 0, model: "test", fetchedSources: 1, unsupportedClaims: 0, elapsedMs: 1 } })),
}));
vi.mock("./issues", () => ({
  createGitLabIssue: vi.fn(async () => "https://gitlab.com/acme/api/-/issues/43"),
  createJiraIssue: vi.fn(async () => "https://acme.atlassian.net/browse/PLAT-43"),
  createLinearIssue: vi.fn(async () => "https://linear.app/acme/issue/PLAT-43"),
}));
vi.mock("./github-issues", () => ({ createGithubIssueFromAnalysis: vi.fn() }));

import { runSlackCommand } from "./slack-agent";

describe("Slack issue creation", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("creates a GitLab follow-up from a GitLab merge request", async () => {
    await expect(runSlackCommand({ action: "issue", prUrl: "https://gitlab.com/acme/api/-/merge_requests/42" }, { signingSecret: "secret" })).resolves.toContain("https://gitlab.com/acme/api/-/issues/43");
  });

  it("routes an explicit Slack issue request to Jira", async () => {
    vi.stubEnv("MERGEPROOF_SLACK_ISSUE_PROVIDER", "jira");
    await expect(runSlackCommand({ action: "issue", prUrl: "https://github.com/acme/api/pull/42" }, { signingSecret: "secret" })).resolves.toContain("https://acme.atlassian.net/browse/PLAT-43");
  });
});
