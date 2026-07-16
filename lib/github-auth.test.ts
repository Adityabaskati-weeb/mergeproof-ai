import { afterEach, describe, expect, it, vi } from "vitest";
import { createGithubClient, resolveGithubToken } from "./github-auth";

afterEach(() => vi.unstubAllEnvs());

describe("GitHub authentication", () => {
  it("prefers an explicit token for local and CI use", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");
    await expect(resolveGithubToken(true)).resolves.toBe("test-token");
    await expect(createGithubClient(true)).resolves.toBeDefined();
  });

  it("explains the required GitHub App fields when publishing without a token", async () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    vi.stubEnv("GITHUB_APP_ID", "");
    vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "");
    vi.stubEnv("GITHUB_PRIVATE_KEY", "");
    await expect(resolveGithubToken(true)).rejects.toThrow("GITHUB_APP_INSTALLATION_ID");
  });
});
