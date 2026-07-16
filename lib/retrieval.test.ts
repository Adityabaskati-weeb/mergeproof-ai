import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexRepository } from "./retrieval";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("indexRepository", () => {
  it("chunks text files and excludes generated directories", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "mergeproof-"));
    temporaryDirectories.push(root);
    await fs.mkdir(join(root, "src"));
    await fs.mkdir(join(root, "node_modules"));
    await fs.writeFile(join(root, "src", "retry.ts"), "export function retry() {\n  return true;\n}\n", "utf8");
    await fs.writeFile(join(root, "node_modules", "ignored.js"), "ignored", "utf8");
    await fs.writeFile(join(root, ".env"), "OPENAI_API_KEY=secret", "utf8");
    const result = await indexRepository(root);
    expect(result.index.chunks.some((chunk) => chunk.path.endsWith("retry.ts"))).toBe(true);
    expect(result.index.chunks.some((chunk) => chunk.path.includes("node_modules"))).toBe(false);
    expect(result.index.chunks.some((chunk) => chunk.path === ".env")).toBe(false);
    expect(result.index.commitSha).toBe("working-tree");
  });
});
