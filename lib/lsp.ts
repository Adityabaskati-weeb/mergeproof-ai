import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";

export type LspServer = { name: string; command: string; args: string[]; fileExtensions: Record<string, string> };
export type LspConfigReport = { path?: string; servers: LspServer[]; warnings: string[] };
export type LspTestResult = { name: string; available: boolean; message: string };

function configCandidates(root: string): string[] {
  return [join(resolve(root), ".github", "lsp.json"), join(resolve(root), ".mergeproof", "lsp.json")];
}

function normalizeServer(value: unknown): LspServer | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as { command?: unknown; args?: unknown; fileExtensions?: unknown };
  if (typeof item.command !== "string" || !item.command.trim()) return undefined;
  const fileExtensions = item.fileExtensions && typeof item.fileExtensions === "object" ? Object.fromEntries(Object.entries(item.fileExtensions).filter(([key, value]) => key.startsWith(".") && typeof value === "string").slice(0, 100)) as Record<string, string> : {};
  return { name: "", command: item.command.trim().slice(0, 500), args: Array.isArray(item.args) ? item.args.filter((arg): arg is string => typeof arg === "string").slice(0, 50) : [], fileExtensions };
}

export async function readLspConfig(root = process.cwd()): Promise<LspConfigReport> {
  const warnings: string[] = [];
  for (const path of configCandidates(root)) {
    try {
      const parsed = JSON.parse(await fs.readFile(path, "utf8")) as { lspServers?: unknown };
      const raw = parsed && typeof parsed === "object" && parsed.lspServers && typeof parsed.lspServers === "object" ? Object.entries(parsed.lspServers) : [];
      const servers = raw.slice(0, 20).flatMap(([name, value]) => {
        const server = normalizeServer(value);
        return server ? [{ ...server, name: name.slice(0, 100) }] : [];
      });
      if (!servers.length && raw.length) warnings.push("No valid LSP server entries were found in the configured file.");
      return { path, servers, warnings };
    } catch {
      // Try the next supported repository-local location.
    }
  }
  return { servers: [], warnings: ["No .github/lsp.json or .mergeproof/lsp.json configuration was found."] };
}

export function testLspServers(config: LspConfigReport, selected?: string): LspTestResult[] {
  const servers = selected ? config.servers.filter((server) => server.name === selected) : config.servers;
  if (selected && !servers.length) return [{ name: selected, available: false, message: "Configured LSP server was not found." }];
  return servers.map((server) => {
    try {
      execFileSync(server.command, [...server.args, "--version"], { stdio: "ignore", timeout: 5_000, windowsHide: true });
      return { name: server.name, available: true, message: `${server.command} is available.` };
    } catch {
      return { name: server.name, available: false, message: `${server.command} could not be started with --version.` };
    }
  });
}

export function renderLspConfig(config: LspConfigReport): string {
  return [`LSP configuration: ${config.path ?? "not found"}`, ...config.servers.map((server) => `- ${server.name}: ${server.command} ${server.args.join(" ")} (${Object.keys(server.fileExtensions).join(", ") || "no extensions"})`), ...config.warnings.map((warning) => `WARN: ${warning}`)].join("\n");
}
