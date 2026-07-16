import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { defaultCodeqlQuery, detectCodeqlLanguages, parseNpmAuditOutput, parseSarifOutput, parseSemgrepOutput, scanExternalSecurity } from "./external-security";

describe("external security adapters", () => {
  it("normalizes npm audit, Semgrep, and SARIF findings", () => {
    const npmFindings = parseNpmAuditOutput(JSON.stringify({ vulnerabilities: { lodash: { severity: "high", via: [{ title: "prototype pollution" }] } } }), "C:/repo", "sha");
    const semgrepFindings = parseSemgrepOutput(JSON.stringify({ results: [{ check_id: "javascript.eval", path: "src/a.ts", start: { line: 4 }, extra: { severity: "ERROR", message: "Avoid eval" } }] }), "C:/repo", "sha");
    const sarifFindings = parseSarifOutput(JSON.stringify({ runs: [{ tool: { driver: { name: "CodeQL" } }, results: [{ ruleId: "js/xss", level: "error", message: { text: "XSS" }, locations: [{ physicalLocation: { artifactLocation: { uri: "src/a.ts" }, region: { startLine: 9 } } }] }] }] }), "C:/repo", "sha");
    expect(npmFindings[0]).toMatchObject({ severity: "high", path: "package-lock.json" });
    expect(semgrepFindings[0]).toMatchObject({ severity: "high", path: "src/a.ts", line: 4 });
    expect(sarifFindings[0]).toMatchObject({ severity: "high", path: "src/a.ts", line: 9 });
  });

  it("selects a deterministic CodeQL language and query suite", () => {
    expect(detectCodeqlLanguages("C:/repo")).toEqual(["javascript-typescript"]);
    expect(defaultCodeqlQuery("javascript-typescript")).toBe("javascript-code-scanning.qls");
    expect(defaultCodeqlQuery("python")).toBe("python-code-scanning.qls");
  });

  it("does not treat a missing CodeQL database as a clean scan", async () => {
    const root = await fs.mkdtemp(join(process.env.TEMP ?? ".", "mergeproof-codeql-missing-"));
    try {
      await expect(scanExternalSecurity({ repoPath: root, commitSha: "sha", codeqlDatabase: join(root, ".codeql", "db") })).resolves.toMatchObject({ tools: [], unavailable: ["codeql database"], findings: [] });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
