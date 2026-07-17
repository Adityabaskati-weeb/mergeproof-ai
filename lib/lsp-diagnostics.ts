import { promises as fs } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SecurityFinding } from "./types";

export type LspDiagnosticsReport = { findings: SecurityFinding[]; unavailable: string[] };
type Diagnostic = { path?: unknown; line?: unknown; severity?: unknown; message?: unknown; code?: unknown; source?: unknown };

function severity(value: unknown): SecurityFinding["severity"] {
  const normalized = String(value ?? "warning").toLowerCase();
  return normalized === "error" || normalized === "critical" || normalized === "high" ? "high" : normalized === "hint" || normalized === "info" || normalized === "low" ? "low" : "medium";
}

function safePath(root: string, value: string): string | undefined {
  const candidate = resolve(root, value);
  const repository = resolve(root);
  const lowerCandidate = process.platform === "win32" ? candidate.toLowerCase() : candidate;
  const lowerRepository = process.platform === "win32" ? repository.toLowerCase() : repository;
  const prefix = `${lowerRepository}${process.platform === "win32" ? "\\" : "/"}`;
  if (lowerCandidate !== lowerRepository && !lowerCandidate.startsWith(prefix)) return undefined;
  return relative(repository, candidate).replace(/\\/g, "/");
}

function parse(value: string): Diagnostic[] {
  const payload = JSON.parse(value) as unknown;
  const items = Array.isArray(payload) ? payload : payload && typeof payload === "object" && Array.isArray((payload as { diagnostics?: unknown }).diagnostics) ? (payload as { diagnostics: unknown[] }).diagnostics : [];
  return items.filter((item): item is Diagnostic => Boolean(item) && typeof item === "object");
}

export async function scanLspDiagnostics(root: string, diagnosticsPath: string, commitSha: string): Promise<LspDiagnosticsReport> {
  const path = safePath(root, diagnosticsPath);
  if (!path || !/\.json$/i.test(path)) return { findings: [], unavailable: ["LSP diagnostics path must be a JSON file inside the repository."] };
  const absolute = join(resolve(root), path);
  let diagnostics: Diagnostic[];
  try { diagnostics = parse(await fs.readFile(absolute, "utf8")).slice(0, 10_000); }
  catch (error) { return { findings: [], unavailable: [`${basename(path)}: ${error instanceof Error ? error.message : "invalid JSON"}`] }; }
  const findings: SecurityFinding[] = [];
  for (const [index, diagnostic] of diagnostics.entries()) {
    const diagnosticPath = typeof diagnostic.path === "string" ? safePath(root, diagnostic.path) : undefined;
    if (!diagnosticPath) continue;
    const line = Math.max(1, Math.min(1_000_000, Number(diagnostic.line ?? 1) || 1));
    const message = typeof diagnostic.message === "string" && diagnostic.message.trim() ? diagnostic.message.trim().slice(0, 4_000) : "LSP reported a diagnostic.";
    const source = typeof diagnostic.source === "string" && diagnostic.source.trim() ? diagnostic.source.trim().slice(0, 100) : "LSP";
    const code = diagnostic.code === undefined ? "" : ` [${String(diagnostic.code).slice(0, 100)}]`;
    findings.push({ id: `lsp:${source}:${index}:${diagnosticPath}:${line}`, title: `${source} diagnostic${code}`, severity: severity(diagnostic.severity), path: diagnosticPath, line, detail: message, citation: { path: diagnosticPath, commitSha, url: `${pathToFileURL(join(resolve(root), diagnosticPath)).toString()}#L${line}` }, category: "quality" });
  }
  return { findings, unavailable: [] };
}

