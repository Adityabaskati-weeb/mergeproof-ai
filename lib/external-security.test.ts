import { describe, expect, it } from "vitest";
import { parseNpmAuditOutput, parseSarifOutput, parseSemgrepOutput } from "./external-security";

describe("external security adapters", () => {
  it("normalizes npm audit, Semgrep, and SARIF findings", () => {
    const npmFindings = parseNpmAuditOutput(JSON.stringify({ vulnerabilities: { lodash: { severity: "high", via: [{ title: "prototype pollution" }] } } }), "C:/repo", "sha");
    const semgrepFindings = parseSemgrepOutput(JSON.stringify({ results: [{ check_id: "javascript.eval", path: "src/a.ts", start: { line: 4 }, extra: { severity: "ERROR", message: "Avoid eval" } }] }), "C:/repo", "sha");
    const sarifFindings = parseSarifOutput(JSON.stringify({ runs: [{ tool: { driver: { name: "CodeQL" } }, results: [{ ruleId: "js/xss", level: "error", message: { text: "XSS" }, locations: [{ physicalLocation: { artifactLocation: { uri: "src/a.ts" }, region: { startLine: 9 } } }] }] }] }), "C:/repo", "sha");
    expect(npmFindings[0]).toMatchObject({ severity: "high", path: "package-lock.json" });
    expect(semgrepFindings[0]).toMatchObject({ severity: "high", path: "src/a.ts", line: 4 });
    expect(sarifFindings[0]).toMatchObject({ severity: "high", path: "src/a.ts", line: 9 });
  });
});
