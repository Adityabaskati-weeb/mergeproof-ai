import { afterEach, describe, expect, it } from "vitest";
import { fetchGithubReviewThreads } from "./github-threads";

describe("GitHub review threads", () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  const originalDisable = process.env.MERGEPROOF_DISABLE_GH_AUTH;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
    if (originalDisable === undefined) delete process.env.MERGEPROOF_DISABLE_GH_AUTH;
    else process.env.MERGEPROOF_DISABLE_GH_AUTH = originalDisable;
  });

  it("normalizes unresolved and resolved threads into citation sources", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [{ id: "thread-1", isResolved: false, isOutdated: false, path: "src/auth.ts", line: 12, comments: { nodes: [{ body: "Validate the token audience.", url: "https://github.com/acme/app/pull/7#discussion_r1", author: { login: "reviewer" } }] } }, { id: "thread-2", isResolved: true, isOutdated: false, path: "README.md", comments: { nodes: [] } }] } } } } })) as Response);
    const result = await fetchGithubReviewThreads({ owner: "acme", repo: "app", number: 7, url: "https://github.com/acme/app/pull/7" });
    expect(result.threads).toHaveLength(2);
    expect(result.threads[0]).toMatchObject({ path: "src/auth.ts", line: 12, isResolved: false });
    expect(result.sources).toContain("https://github.com/acme/app/pull/7#discussion_r1");
  });

  it("reports missing credentials instead of pretending threads are clean", async () => {
    delete process.env.GITHUB_TOKEN;
    process.env.MERGEPROOF_DISABLE_GH_AUTH = "1";
    const result = await fetchGithubReviewThreads({ owner: "acme", repo: "app", number: 7, url: "https://github.com/acme/app/pull/7" });
    expect(result.threads).toEqual([]);
    expect(result.unavailable).toBeTruthy();
  });
});
