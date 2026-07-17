import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanRepositorySecurity } from "./security";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("repository security agent", () => {
  it("scans committed source beyond the current diff and skips sensitive files", async () => {
    const root = await fs.mkdtemp(join(process.env.TEMP ?? ".", "mergeproof-security-agent-"));
    roots.push(root);
    await fs.mkdir(join(root, "src"), { recursive: true });
    await fs.mkdir(join(root, "node_modules"), { recursive: true });
    await fs.writeFile(join(root, "src", "app.ts"), 'const password = "not-a-placeholder-secret";\n', "utf8");
    await fs.writeFile(join(root, ".env"), 'API_KEY="should-not-be-read"\n', "utf8");
    await fs.writeFile(join(root, "node_modules", "dependency.js"), 'const password = "dependency-secret";\n', "utf8");
    const findings = await scanRepositorySecurity(root, "sha");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ path: "src/app.ts", citation: { commitSha: "sha" }, severity: "high" });
  });
});
