import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { collectWorkingTreeChanges } from "./local-review";

function git(root: string, args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

describe("working-tree review context", () => {
  it("captures staged, unstaged, and untracked text changes with a stable digest", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-local-review-"));
    try {
      git(root, ["init", "-q"]);
      git(root, ["config", "user.email", "mergeproof@example.com"]);
      git(root, ["config", "user.name", "MergeProof Test"]);
      await writeFile(join(root, "tracked.ts"), "export const value = 1;\n", "utf8");
      git(root, ["add", "tracked.ts"]);
      git(root, ["commit", "-qm", "initial"]);
      await writeFile(join(root, "tracked.ts"), "export const value = 2;\n", "utf8");
      await writeFile(join(root, "new.ts"), "export const added = true;\n", "utf8");

      const result = await collectWorkingTreeChanges(root);

      expect(result.files.map((file) => file.path)).toEqual(["new.ts", "tracked.ts"]);
      expect(result.files.find((file) => file.path === "new.ts")?.status).toBe("untracked");
      expect(result.files.find((file) => file.path === "tracked.ts")?.patch).toContain("export const value = 2");
      expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
      const second = await collectWorkingTreeChanges(root);
      expect(second.digest).toBe(result.digest);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
