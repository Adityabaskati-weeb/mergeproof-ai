import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertPermission, readPermissionPolicy } from "./permissions";

describe("explicit MergeProof permissions", () => {
  it("denies configured mutation actions and protected paths", async () => {
    const root = await mkdtemp(join(process.env.TEMP ?? ".", "mergeproof-permissions-"));
    await mkdir(join(root, ".mergeproof"));
    await writeFile(join(root, ".mergeproof", "permissions.json"), JSON.stringify({ actions: { apply: "deny" }, deniedPaths: ["secrets/**"] }), "utf8");
    await expect(assertPermission(root, "apply", { paths: ["src/app.ts"], verified: true })).rejects.toThrow("apply");
    await expect(assertPermission(root, "publish", { paths: ["secrets/token.txt"] })).rejects.toThrow("deniedPaths");
  });

  it("enforces verification and normalizes the policy surface", async () => {
    const root = await mkdtemp(join(process.env.TEMP ?? ".", "mergeproof-permissions-"));
    await mkdir(join(root, ".mergeproof"));
    await writeFile(join(root, ".mergeproof", "permissions.json"), JSON.stringify({ default: "deny", actions: { apply: "allow" }, requireVerification: true, allowedPaths: ["src/**"] }), "utf8");
    const policy = await readPermissionPolicy(root);
    expect(policy.default).toBe("deny");
    await expect(assertPermission(root, "apply", { paths: ["src/app.ts"], verified: false })).rejects.toThrow("verification");
    await expect(assertPermission(root, "apply", { paths: ["docs/readme.md"], verified: true })).rejects.toThrow("outside allowedPaths");
  });
});
