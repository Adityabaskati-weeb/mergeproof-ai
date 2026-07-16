import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadHooks, runHooks } from "./hooks";

describe("governed lifecycle hooks", () => {
  it("accepts only named safe commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-hooks-"));
    try {
      await mkdir(join(root, ".mergeproof"), { recursive: true });
      await writeFile(join(root, ".mergeproof", "hooks.json"), JSON.stringify({ enabled: true, beforeReview: ["npm-typecheck"], afterReview: [] }), "utf8");
      expect((await loadHooks(root)).beforeReview).toEqual(["npm-typecheck"]);
      const report = await runHooks(root, "afterReview", true);
      expect(report).toMatchObject({ enabled: true, after: [], failed: [] });
      await writeFile(join(root, ".mergeproof", "hooks.json"), JSON.stringify({ enabled: true, beforeReview: ["powershell -Command whoami"] }), "utf8");
      await expect(loadHooks(root)).rejects.toThrow("Unsupported MergeProof hook");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
