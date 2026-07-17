import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { combineInstructions, loadAdditionalInstructions, loadAgentProfile } from "./agents";

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

  it("loads explicit additional instruction files only from the repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-agent-config-"));
    try {
      await writeFile(join(root, "review.md"), "Treat external config as review guidance.", "utf8");
      expect(await loadAdditionalInstructions(root, ["review.md"])).toContain("Treat external config");
      await expect(loadAdditionalInstructions(root, ["../outside.md"])).rejects.toThrow("inside the repository");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
