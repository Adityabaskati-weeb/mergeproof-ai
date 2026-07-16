import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLinkedIssues } from "./issues";

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
});
