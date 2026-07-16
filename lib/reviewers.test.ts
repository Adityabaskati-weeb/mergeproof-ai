import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { suggestReviewers } from "./reviewers";

describe("reviewer suggestions", () => {
  it("combines MergeProof rules and CODEOWNERS matches", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-reviewers-"));
    await mkdir(join(root, ".mergeproof"), { recursive: true });
    await writeFile(join(root, ".mergeproof", "reviewers.json"), JSON.stringify({ rules: [{ paths: ["src/payments/**"], reviewers: ["@payments"] }] }), "utf8");
    await mkdir(join(root, ".github"), { recursive: true });
    await writeFile(join(root, ".github", "CODEOWNERS"), "infra/** @platform\n", "utf8");
    await expect(suggestReviewers(root, ["src/payments/retry.ts", "infra/main.tf"])).resolves.toEqual(["@payments", "@platform"]);
  });
});
