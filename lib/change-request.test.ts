import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchChangeRequest, parseChangeRequestUrl } from "./change-request";

afterEach(() => vi.unstubAllGlobals());

describe("change request URL parsing", () => {
  it("accepts GitHub, GitLab, Bitbucket, and Azure DevOps URLs", () => {
    expect(parseChangeRequestUrl("https://github.com/acme/payments/pull/42").provider).toBe("github");
    expect(parseChangeRequestUrl("https://gitlab.com/platform/team/payments/-/merge_requests/7")).toMatchObject({ provider: "gitlab", ref: { owner: "platform/team", repo: "payments", number: 7 } });
    expect(parseChangeRequestUrl("https://bitbucket.org/acme/payments/pull-requests/9")).toMatchObject({ provider: "bitbucket", ref: { owner: "acme", repo: "payments", number: 9 } });
    expect(parseChangeRequestUrl("https://dev.azure.com/acme/Platform/_git/payments/pullrequest/11")).toMatchObject({ provider: "azure-devops", ref: { owner: "acme", repo: "payments", number: 11 } });
  });

  it("rejects unsupported change-request URLs", () => {
    expect(() => parseChangeRequestUrl("https://example.com/acme/review/1")).toThrow("Expected a GitHub pull request");
  });

  it("normalizes provider API responses into the shared evidence context", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.includes("gitlab") && url.includes("/diffs") ? { diffs: [{ new_path: "src/a.ts", diff: "@@ -1 +1 @@\n-old\n+new" }] }
        : url.includes("gitlab") && url.includes("/merge_requests/7") ? { title: "GitLab change", description: "## Requirements\n- keep behavior", sha: "git-sha", diff_refs: { base_sha: "base-sha" } }
        : url.includes("gitlab") && url.includes("/commits") ? [{ id: "git-commit", title: "commit", web_url: "https://gitlab.com/commit" }]
        : url.includes("bitbucket") && url.endsWith("/diff") ? "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new"
        : url.includes("bitbucket") && url.includes("/pullrequests/9") && !url.includes("/commits") && !url.includes("/comments") && !url.includes("/statuses") ? { title: "Bitbucket change", summary: { raw: "requirements" }, source: { commit: { hash: "bb-head" } }, destination: { commit: { hash: "bb-base" } } }
        : url.includes("bitbucket") && url.includes("/commits") ? { values: [] }
        : url.includes("bitbucket") && url.includes("/comments") ? { values: [] }
        : url.includes("bitbucket") && url.includes("/statuses") ? { values: [] }
        : url.includes("azure") && url.includes("pullrequests/11?") ? { title: "Azure change", description: "requirements", repository: { id: "repo-id" }, lastMergeSourceCommit: { commitId: "az-head" }, lastMergeTargetCommit: { commitId: "az-base" } }
        : url.includes("azure") && url.includes("/commits?") ? { value: [] }
        : url.includes("azure") && url.includes("/iterations?") ? { value: [{ id: 1 }] }
        : url.includes("azure") && url.includes("/iterations/1/changes") ? { changeEntries: [{ changeType: "add", item: { path: "/src/a.ts", url: "https://dev.azure.com/file" } }] }
        : [];
      return { ok: true, status: 200, json: async () => payload, text: async () => String(payload) };
    }));

    const gitlab = await fetchChangeRequest(parseChangeRequestUrl("https://gitlab.com/platform/payments/-/merge_requests/7"));
    const bitbucket = await fetchChangeRequest(parseChangeRequestUrl("https://bitbucket.org/acme/payments/pull-requests/9"));
    const azure = await fetchChangeRequest(parseChangeRequestUrl("https://dev.azure.com/acme/Platform/_git/payments/pullrequest/11"));
    expect(gitlab.files[0].path).toBe("src/a.ts");
    expect(bitbucket.headSha).toBe("bb-head");
    expect(azure.headSha).toBe("az-head");
  });
});
