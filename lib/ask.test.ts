import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("./models", () => ({
  createModelProvider: () => ({ name: "test:local", answer: async (context: { repositoryEvidence: unknown[] }) => ({ answer: `evidence=${context.repositoryEvidence.length}` }) }),
}));

import { askRepository } from "./ask";

describe("repository ask", () => {
  it("rejects empty questions before loading a model or repository", async () => {
    await expect(askRepository("   ")).rejects.toThrow("non-empty question");
  });

  it("answers from bounded local evidence without changing source files", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-ask-"));
    try {
      execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
      const source = join(root, "auth.ts");
      await writeFile(source, "export function authenticate(token: string) { return Boolean(token); }\n", "utf8");
      const before = await readFile(source, "utf8");
      const result = await askRepository("How does authenticate work?", undefined, { repoPath: root, retrievalTopK: 4 });
      expect(result).toMatchObject({ answer: "evidence=1", trace: { model: "test:local", readOnly: true } });
      expect(await readFile(source, "utf8")).toBe(before);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
