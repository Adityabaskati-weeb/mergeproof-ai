import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

  it("limits a review to the requested directory scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-local-scope-"));
    try {
      git(root, ["init", "-q"]);
      git(root, ["config", "user.email", "mergeproof@example.com"]);
      git(root, ["config", "user.name", "MergeProof Test"]);
      await mkdir(join(root, "src"), { recursive: true });
      await mkdir(join(root, "docs"), { recursive: true });
      await writeFile(join(root, "src", "app.ts"), "export const value = 1;\n", "utf8");
      await writeFile(join(root, "docs", "notes.md"), "initial\n", "utf8");
      git(root, ["add", "."]);
      git(root, ["commit", "-qm", "initial"]);
      await writeFile(join(root, "src", "app.ts"), "export const value = 2;\n", "utf8");
      await writeFile(join(root, "docs", "notes.md"), "changed\n", "utf8");

      const result = await collectWorkingTreeChanges(root, ["src"]);
      expect(result.files.map((file) => file.path)).toEqual(["src/app.ts"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("separates committed and uncommitted review scopes", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-local-review-types-"));
    try {
      git(root, ["init", "-q"]);
      git(root, ["config", "user.email", "mergeproof@example.com"]);
      git(root, ["config", "user.name", "MergeProof Test"]);
      await writeFile(join(root, "tracked.ts"), "export const value = 1;\n", "utf8");
      git(root, ["add", "tracked.ts"]);
      git(root, ["commit", "-qm", "initial"]);
      await writeFile(join(root, "tracked.ts"), "export const value = 2;\n", "utf8");
      git(root, ["add", "tracked.ts"]);
      git(root, ["commit", "-qm", "committed change"]);
      await writeFile(join(root, "tracked.ts"), "export const value = 3;\n", "utf8");

      const committed = await collectWorkingTreeChanges(root, [], { reviewType: "committed" });
      expect(committed.files.map((file) => file.path)).toEqual(["tracked.ts"]);
      expect(committed.files[0]?.status).toBe("committed");
      expect(committed.files[0]?.patch).toContain("export const value = 2");

      const uncommitted = await collectWorkingTreeChanges(root, [], { reviewType: "uncommitted" });
      expect(uncommitted.files.map((file) => file.path)).toEqual(["tracked.ts"]);
      expect(uncommitted.files[0]?.status).toBe("M");
      expect(uncommitted.files[0]?.patch).toContain("export const value = 3");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
