import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("./models", () => ({
  createModelProvider: () => ({
    name: "test:planner",
    plan: async (context: { headSha: string; repositoryEvidence: Array<{ path: string; url: string }> }) => ({
      summary: "A grounded plan",
      risks: [{ risk: "Verify the contract", severity: "medium", citations: context.repositoryEvidence.slice(0, 1).map((chunk) => ({ path: chunk.path, commitSha: context.headSha, url: chunk.url })) }],
      steps: [{ title: "Update the source", detail: "Make the smallest supported change.", citations: context.repositoryEvidence.slice(0, 1).map((chunk) => ({ path: chunk.path, commitSha: context.headSha, url: chunk.url })) }],
    }),
  }),
}));

import { planWorkItem } from "./work-plan";

describe("free-form work planning", () => {
  it("rejects an empty request before touching a repository", async () => {
    await expect(planWorkItem("   ")).rejects.toThrow("non-empty request");
  });

  it("returns only citations from the current local evidence set", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-plan-"));
    try {
      execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
      await writeFile(join(root, "auth.ts"), "export function authenticate(token: string) { return Boolean(token); }\n", "utf8");
      execFileSync("git", ["add", "auth.ts"], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["-c", "user.name=MergeProof", "-c", "user.email=mergeproof@example.com", "commit", "-m", "init"], { cwd: root, stdio: "ignore" });
      const result = await planWorkItem("Improve authenticate token validation", undefined, { repoPath: root });
      expect(result).toMatchObject({ trace: { model: "test:planner", local: true } });
      expect(result.steps[0]?.citations[0]?.path).toBe("auth.ts");
      expect(result.trace.citedSources).toBe(2);
      expect(await readFile(join(root, "auth.ts"), "utf8")).toContain("authenticate");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
