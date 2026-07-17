import { describe, expect, it } from "vitest";
import { runImplementationAgent } from "./implementation-agent";

describe("implementation agent boundary", () => {
  it("rejects empty requests before touching a repository", async () => {
    await expect(runImplementationAgent("   ", undefined, { repoPath: process.cwd() })).rejects.toThrow("must not be empty");
  });

  it("requires explicit verification before applying a patch", async () => {
    await expect(runImplementationAgent("add a health endpoint", undefined, { repoPath: process.cwd(), apply: true })).rejects.toThrow("requires --verify");
  });
});
