import { promises as fs } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("./models", () => ({
  createModelProvider: vi.fn(() => ({ name: "test:completion", complete: vi.fn(async (context: { filePath: string; before: string; after: string }) => ({ completion: `${context.filePath}:${context.before.endsWith("con")}:${context.after.startsWith("st")}` })) })),
}));

import { completeFile } from "./completion";

describe("code completion", () => {
  it("returns a bounded, non-mutating completion at a cursor", async () => {
    const root = join(process.cwd(), `.tmp-completion-${Date.now()}`);
    try {
      await fs.mkdir(root, { recursive: true });
      const file = join(root, "src.ts");
      await fs.writeFile(file, "const value = const;\n", "utf8");
      const before = await fs.readFile(file, "utf8");
      const result = await completeFile("src.ts", "test-model", { repoPath: root, line: 1, column: 18 });
      expect(result.completion).toBe("src.ts:true:true");
      expect(result.trace.nonMutating).toBe(true);
      expect(await fs.readFile(file, "utf8")).toBe(before);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
