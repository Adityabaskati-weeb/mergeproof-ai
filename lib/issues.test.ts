import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitLabIssue, fetchLinkedIssues } from "./issues";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fetchLinkedIssues", () => {
  it("does not call Jira when credentials are not configured", async () => {
    await expect(fetchLinkedIssues("implements PROJ-42")).resolves.toEqual([]);
  });

  it("loads linked Linear acceptance criteria when configured", async () => {
    vi.stubEnv("LINEAR_API_KEY", "linear-test-key");
    vi.stubEnv("LINEAR_TEAM_KEY", "ENG");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: { issues: { nodes: [{ identifier: "ENG-42", title: "Retry behavior", description: "## Acceptance Criteria\n- retries are bounded", state: { name: "Todo" } }] } } }) })));
    await expect(fetchLinkedIssues("See https://linear.app/acme/issue/ENG-42/retry-behavior")).resolves.toMatchObject([{ provider: "linear", key: "ENG-42", acceptanceCriteria: ["retries are bounded"] }]);
  });

  it("creates a GitLab issue for a nested project path", async () => {
    vi.stubEnv("GITLAB_TOKEN", "gitlab-test-token");
    const fetchMock = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ web_url: "https://gitlab.com/acme/platform/api/-/issues/43" }) }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createGitLabIssue("https://gitlab.com/acme/platform/api/-/merge_requests/42", "Follow-up", "Evidence")).resolves.toBe("https://gitlab.com/acme/platform/api/-/issues/43");
    expect(fetchMock).toHaveBeenCalledWith("https://gitlab.com/api/v4/projects/acme%2Fplatform%2Fapi/issues", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "PRIVATE-TOKEN": "gitlab-test-token" }) }));
  });
});
