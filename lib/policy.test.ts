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
    await expect(loadPolicy(root)).resolves.toEqual({ provider: "anthropic", minCitationsPerCriterion: 1, instructions: "## .mergeproof/instructions.md\nPrefer explicit rollback evidence." });
  });

  it("loads path-specific instructions and repository skills", async () => {
    const root = await fs.mkdtemp(join(process.env.TEMP ?? ".", "mergeproof-policy-discovered-"));
    temporaryDirectories.push(root);
    await fs.mkdir(join(root, ".github", "instructions"), { recursive: true });
    await fs.mkdir(join(root, ".github", "skills", "review"), { recursive: true });
    await fs.writeFile(join(root, ".github", "instructions", "typescript.instructions.md"), "Use strict TypeScript.", "utf8");
    await fs.writeFile(join(root, ".github", "skills", "review", "SKILL.md"), "Review error paths.", "utf8");
    await expect(loadPolicy(root)).resolves.toMatchObject({ instructions: expect.stringContaining(".github/instructions/typescript.instructions.md") });
    await expect(loadPolicy(root)).resolves.toMatchObject({ instructions: expect.stringContaining("Review error paths.") });
  });

  it("applies Copilot-style applyTo globs to changed paths", async () => {
    const root = await fs.mkdtemp(join(process.env.TEMP ?? ".", "mergeproof-policy-scoped-"));
    temporaryDirectories.push(root);
    await fs.mkdir(join(root, ".github", "instructions"), { recursive: true });
    await fs.writeFile(join(root, ".github", "instructions", "typescript.instructions.md"), "---\napplyTo: \"**/*.ts\"\n---\nUse strict TypeScript.", "utf8");
    await fs.writeFile(join(root, ".github", "instructions", "python.instructions.md"), "---\napplyTo: \"**/*.py\"\n---\nUse typed Python.", "utf8");
    await expect(loadPolicy(root, ["src/auth.ts"])).resolves.toMatchObject({ instructions: expect.stringContaining("Use strict TypeScript.") });
    await expect(loadPolicy(root, ["src/auth.ts"])).resolves.toMatchObject({ instructions: expect.not.stringContaining("Use typed Python.") });
  });

  it("loads bounded natural-language pre-merge checks", async () => {
    const root = await fs.mkdtemp(join(process.env.TEMP ?? ".", "mergeproof-policy-checks-"));
    temporaryDirectories.push(root);
    await fs.mkdir(join(root, ".mergeproof"), { recursive: true });
    await fs.writeFile(join(root, ".mergeproof", "checks.json"), JSON.stringify([{ name: "API compatibility", instructions: "Require compatibility evidence." }, { name: "", instructions: "ignored" }]), "utf8");
    await expect(loadPolicy(root)).resolves.toMatchObject({ customChecks: [{ name: "API compatibility", instructions: "Require compatibility evidence." }] });
  });

  it("inherits a bounded central policy and lets the repository override scalar values", async () => {
    const root = await fs.mkdtemp(join(process.env.TEMP ?? ".", "mergeproof-policy-inheritance-"));
    temporaryDirectories.push(root);
    await fs.mkdir(join(root, ".mergeproof"), { recursive: true });
    const central = join(root, "organization-policy.json");
    await fs.writeFile(central, JSON.stringify({ model: "org-model", minCitationsPerCriterion: 2, customChecks: [{ name: "Central API", instructions: "Require API evidence." }] }), "utf8");
    await fs.writeFile(join(root, ".mergeproof", "config.json"), JSON.stringify({ extends: "../organization-policy.json", model: "repo-model", customChecks: [{ name: "Local release", instructions: "Require release evidence." }] }), "utf8");
    await expect(loadPolicy(root)).resolves.toMatchObject({ model: "repo-model", minCitationsPerCriterion: 2, customChecks: [{ name: "Central API" }, { name: "Local release" }] });
  });
});
