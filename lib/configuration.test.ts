import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateMergeProofConfiguration, readMergeProofConfiguration, renderConfiguration } from "./configuration";

describe("configuration", () => {
  it("generates an explicit starter policy and reports repository guidance", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-config-"));
    try {
      const generated = await generateMergeProofConfiguration(root);
      expect(generated.created).toBe(true);
      expect(await readFile(join(root, ".mergeproof", "config.json"), "utf8")).toContain("gpt-5.6");
      const snapshot = await readMergeProofConfiguration(root);
      expect(snapshot.exists).toBe(true);
      expect(renderConfiguration(snapshot)).toContain("Provider: openai");
      expect((await generateMergeProofConfiguration(root)).created).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
