import { promises as fs } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPrompts, recordPrompt, renderPromptRecord } from "./prompt-log";

describe("prompt replay", () => {
  it("stores bounded, digest-bearing prompts only when explicitly requested", async () => {
    const root = join(process.cwd(), `.tmp-prompts-${Date.now()}`);
    try {
      const record = await recordPrompt(root, { action: "review", model: "test:model", system: "system", user: "user" });
      const prompts = await readPrompts(root);
      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toMatchObject({ id: record.id, digest: record.digest, bytes: 11 });
      expect(renderPromptRecord(prompts[0])).toContain("### User\nuser");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
