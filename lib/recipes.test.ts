import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRecipes } from "./recipes";

describe("repository finishing-touch recipes", () => {
  it("loads bounded named recipes and ignores malformed entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-recipes-test-"));
    try {
      await mkdir(join(root, ".mergeproof"), { recursive: true });
      await writeFile(join(root, ".mergeproof", "recipes.json"), JSON.stringify({ recipes: [{ name: "tests", description: "Add tests", instructions: "Add focused tests", paths: ["tests"] }, { name: "bad name", instructions: "ignored" }, { name: "", instructions: "ignored" }] }), "utf8");
      await expect(loadRecipes(root)).resolves.toEqual([{ name: "tests", description: "Add tests", instructions: "Add focused tests", paths: ["tests"] }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
