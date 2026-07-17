import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanLspDiagnostics } from "./lsp-diagnostics";

describe("bounded LSP diagnostics ingestion", () => {
  it("turns JSON diagnostics into quality findings with file citations", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-lsp-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "diagnostics.json"), JSON.stringify({ diagnostics: [{ path: "src/app.ts", line: 8, severity: "error", message: "Unsafe branch", code: "TS999", source: "typescript" }] }), "utf8");
    const result = await scanLspDiagnostics(root, "diagnostics.json", "head");
    expect(result.unavailable).toEqual([]);
    expect(result.findings[0]).toMatchObject({ path: "src/app.ts", line: 8, severity: "high", category: "quality", citation: { commitSha: "head" } });
  });

  it("rejects diagnostics paths outside the repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-lsp-"));
    const result = await scanLspDiagnostics(root, "../diagnostics.json", "head");
    expect(result.findings).toHaveLength(0);
    expect(result.unavailable[0]).toContain("inside the repository");
  });
});

