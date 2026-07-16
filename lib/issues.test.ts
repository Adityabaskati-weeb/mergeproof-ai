import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLinkedIssues } from "./issues";

afterEach(() => vi.unstubAllEnvs());

describe("fetchLinkedIssues", () => {
  it("does not call Jira when credentials are not configured", async () => {
    await expect(fetchLinkedIssues("implements PROJ-42")).resolves.toEqual([]);
  });
});
