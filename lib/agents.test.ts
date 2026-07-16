import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { combineInstructions, loadAgentProfile } from "./agents";

describe("custom agent profiles", () => {
  it("loads only named repository profiles and combines them with base instructions", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-agents-"));
    try {
      await mkdir(join(root, ".github", "agents"), { recursive: true });
      await writeFile(join(root, ".github", "agents", "security.agent.md"), "Check auth boundaries and never approve missing evidence.", "utf8");
      const profile = await loadAgentProfile(root, "security");
      expect(profile?.path).toBe(".github/agents/security.agent.md");
      expect(combineInstructions("Use exact citations.", profile)).toContain("Check auth boundaries");
      await expect(loadAgentProfile(root, "../secrets")).rejects.toThrow("Agent profile names");
      await expect(loadAgentProfile(root, "missing")).rejects.toThrow("was not found");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
