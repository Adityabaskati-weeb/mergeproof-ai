import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderDoctor, runDoctor } from "./doctor";

describe("MergeProof doctor", () => {
  it("reports actionable environment checks without exposing secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-doctor-"));
    try {
      const report = await runDoctor(root);
      expect(report.checks.map((check) => check.id)).toEqual(expect.arrayContaining(["node", "git", "repository", "storage", "model-credentials"]));
      expect(renderDoctor(report)).toContain("MergeProof doctor:");
      expect(renderDoctor(report)).not.toContain(process.env.OPENAI_API_KEY ?? "__missing_key__");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
