import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initializeRepository } from "./init";

describe("repository initialization", () => {
  it("creates an idempotent local evidence policy without overwriting edits", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-init-"));
    try {
      const first = await initializeRepository(root);
      expect(first.configurationCreated).toBe(true);
      expect(first.files.some((file) => file.path === ".mergeproof/instructions.md" && file.created)).toBe(true);
      const instructions = join(root, ".mergeproof", "instructions.md");
      await import("node:fs/promises").then(({ writeFile }) => writeFile(instructions, "custom instructions\n", "utf8"));
      const second = await initializeRepository(root);
      expect(second.configurationCreated).toBe(false);
      expect(await readFile(instructions, "utf8")).toBe("custom instructions\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
