import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadHooks, readHooksConfig, runHooks } from "./hooks";

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

  it("lets validation distinguish a malformed configuration from an absent one", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-hooks-invalid-"));
    try {
      await mkdir(join(root, ".mergeproof"), { recursive: true });
      await writeFile(join(root, ".mergeproof", "hooks.json"), "not-json", "utf8");
      expect((await loadHooks(root)).enabled).toBe(false);
      await expect(readHooksConfig(root)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
