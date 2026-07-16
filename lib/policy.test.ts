import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPolicy } from "./policy";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("loadPolicy", () => {
  it("loads JSON policy and bounded team instructions", async () => {
    const root = await fs.mkdtemp(join(process.env.TEMP ?? ".", "mergeproof-policy-"));
    temporaryDirectories.push(root);
    await fs.mkdir(join(root, ".mergeproof"));
    await fs.writeFile(join(root, ".mergeproof", "config.json"), JSON.stringify({ provider: "anthropic", minCitationsPerCriterion: 1 }), "utf8");
    await fs.writeFile(join(root, ".mergeproof", "instructions.md"), "Prefer explicit rollback evidence.", "utf8");
    await expect(loadPolicy(root)).resolves.toEqual({ provider: "anthropic", minCitationsPerCriterion: 1, instructions: "Prefer explicit rollback evidence." });
  });
});
