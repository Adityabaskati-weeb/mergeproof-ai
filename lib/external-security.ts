import { execFileSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import type { SecurityFinding } from "./types";

const MAX_OUTPUT_BYTES = 12 * 1024 * 1024;

export type ExternalSecurityOptions = { repoPath: string; commitSha: string; semgrep?: boolean; npmAudit?: boolean; codeqlDatabase?: string; codeqlCreate?: boolean; codeqlLanguages?: string; codeqlQuery?: string };
export type ExternalSecurityReport = { findings: SecurityFinding[]; tools: string[]; unavailable: string[] };

type SarifResult = {
  ruleId?: string;
  level?: string;
  message?: { text?: string };
  locations?: Array<{ physicalLocation?: { artifactLocation?: { uri?: string }; region?: { startLine?: number } } }>;
};

type SarifRun = {
  tool?: { driver?: { name?: string; rules?: Array<{ id?: string; shortDescription?: { text?: string } }> } };
  results?: SarifResult[];
};

function commandOutput(executable: string, args: string[], cwd: string): { stdout: string; stderr: string; available: boolean; success: boolean } {
  try {
    return { stdout: execFileSync(executable, args, { cwd, encoding: "utf8", maxBuffer: MAX_OUTPUT_BYTES, stdio: ["ignore", "pipe", "pipe"] }).toString(), stderr: "", available: true, success: true };
  } catch (error) {
    const value = error as { stdout?: string | Buffer; stderr?: string | Buffer; code?: string | number };
    return { stdout: value.stdout?.toString() ?? "", stderr: value.stderr?.toString() ?? "", available: value.code !== "ENOENT", success: false };
  }
}

function severity(value: unknown): SecurityFinding["severity"] {
  const normalized = String(value ?? "medium").toLowerCase();
  return normalized === "critical" || normalized === "high" || normalized === "error" ? "high" : normalized === "low" || normalized === "note" ? "low" : "medium";
}

function localPath(root: string, value: string): string {
  const withoutFileScheme = value.startsWith("file:") ? fileURLToPath(value) : value;
  const relativePath = relative(resolve(root), resolve(root, withoutFileScheme));
  return relativePath && !relativePath.startsWith("..") ? relativePath.replace(/\\/g, "/") : basename(withoutFileScheme);
}

function citation(root: string, path: string, line: number, commitSha: string): SecurityFinding["citation"] {
  return { path, commitSha, url: `${pathToFileURL(join(resolve(root), path)).toString()}#L${line}` };
}

export function detectCodeqlLanguages(root: string): string[] {
  const languages: string[] = [];
  const exists = (name: string) => existsSync(join(root, name));
  if (exists("package.json") || exists("tsconfig.json")) languages.push("javascript-typescript");
  if (exists("pyproject.toml") || exists("requirements.txt")) languages.push("python");
  if (exists("go.mod")) languages.push("go");
  if (exists("Cargo.toml")) languages.push("rust");
  if (exists("pom.xml") || exists("build.gradle")) languages.push("java-kotlin");
  if (exists("Gemfile")) languages.push("ruby");
  return languages.length ? languages : ["javascript-typescript"];
}

export function defaultCodeqlQuery(language: string): string {
  const normalized = language.split(",")[0].trim();
  const names: Record<string, string> = { "javascript-typescript": "javascript-code-scanning.qls", python: "python-code-scanning.qls", go: "go-code-scanning.qls", rust: "rust-code-scanning.qls", "java-kotlin": "java-code-scanning.qls", ruby: "ruby-code-scanning.qls" };
  return names[normalized] ?? "security-and-quality.qls";
}

export function parseNpmAuditOutput(value: string, root: string, commitSha: string): SecurityFinding[] {
  try {
    const payload = JSON.parse(value) as { vulnerabilities?: Record<string, { severity?: string; via?: unknown[]; range?: string }> };
    return Object.entries(payload.vulnerabilities ?? {}).map(([name, vulnerability]) => {
      const path = "package-lock.json";
      const detail = (vulnerability.via ?? []).map((item) => typeof item === "string" ? item : (item as { title?: string; url?: string; range?: string }).title ?? (item as { url?: string }).url ?? (item as { range?: string }).range ?? "dependency advisory").join("; ");
      return { id: `npm-audit:${name}`, title: `Dependency vulnerability: ${name}`, severity: severity(vulnerability.severity), path, line: 1, detail: `${detail || "npm audit reported a vulnerability."}${vulnerability.range ? ` (${vulnerability.range})` : ""}`, citation: citation(root, path, 1, commitSha) };
    });
  } catch {
    return [];
  }
}

export function parseSemgrepOutput(value: string, root: string, commitSha: string): SecurityFinding[] {
  try {
    const payload = JSON.parse(value) as { results?: Array<{ check_id?: string; path?: string; start?: { line?: number }; extra?: { message?: string; severity?: string } }> };
    return (payload.results ?? []).map((result, index) => {
      const path = localPath(root, result.path ?? "unknown");
      const line = Number(result.start?.line ?? 1);
      return { id: `semgrep:${result.check_id ?? index}:${path}:${line}`, title: `Semgrep: ${result.check_id ?? "finding"}`, severity: severity(result.extra?.severity), path, line, detail: result.extra?.message ?? "Semgrep reported a finding.", citation: citation(root, path, line, commitSha) };
    });
  } catch {
    return [];
  }
}

export function parseSarifOutput(value: string, root: string, commitSha: string): SecurityFinding[] {
  try {
    const payload = JSON.parse(value) as { runs?: SarifRun[] };
    const findings: SecurityFinding[] = [];
    for (const run of payload.runs ?? []) {
      const tool = run.tool?.driver?.name ?? "SARIF";
      for (const [index, result] of (run.results ?? []).entries()) {
        const location = result.locations?.[0]?.physicalLocation;
        const path = localPath(root, location?.artifactLocation?.uri ?? "unknown");
        const line = Number(location?.region?.startLine ?? 1);
        const rule = run.tool?.driver?.rules?.find((candidate) => candidate.id === result.ruleId);
        findings.push({ id: `sarif:${tool}:${result.ruleId ?? index}:${path}:${line}`, title: `${tool}: ${rule?.shortDescription?.text ?? result.ruleId ?? "finding"}`, severity: severity(result.level), path, line, detail: result.message?.text ?? "SARIF reported a finding.", citation: citation(root, path, line, commitSha) });
      }
    }
    return findings;
  } catch {
    return [];
  }
}

export async function scanExternalSecurity(options: ExternalSecurityOptions): Promise<ExternalSecurityReport> {
  const root = resolve(options.repoPath);
  const findings: SecurityFinding[] = [];
  const tools: string[] = [];
  const unavailable: string[] = [];
  if (options.npmAudit && (await fs.stat(join(root, "package-lock.json")).catch(() => undefined))) {
    const executable = process.platform === "win32" ? "npm.cmd" : "npm";
    const result = commandOutput(executable, ["audit", "--json", "--omit=dev"], root);
    if (!result.available) unavailable.push("npm audit");
    else {
      tools.push("npm audit");
      findings.push(...parseNpmAuditOutput(result.stdout, root, options.commitSha));
    }
  }
  if (options.semgrep) {
    const result = commandOutput(process.platform === "win32" ? "semgrep.exe" : "semgrep", ["--json", "--config", "auto", "--quiet", "."], root);
    if (!result.available) unavailable.push("semgrep");
    else {
      tools.push("semgrep");
      findings.push(...parseSemgrepOutput(result.stdout, root, options.commitSha));
    }
  }
  if (options.codeqlDatabase) {
    const temporary = await fs.mkdtemp(join(tmpdir(), "mergeproof-codeql-"));
    const sarifPath = join(temporary, "results.sarif");
    const database = resolve(options.codeqlDatabase);
    const databaseExists = await fs.stat(database).then(() => true).catch(() => false);
    let ready = databaseExists;
    if (!databaseExists && options.codeqlCreate) {
      const languages = options.codeqlLanguages || detectCodeqlLanguages(root).join(",");
      const create = commandOutput("codeql", ["database", "create", database, `--language=${languages}`, `--source-root=${root}`, "--build-mode=none"], root);
      ready = create.available && create.success && await fs.stat(database).then(() => true).catch(() => false);
      if (!create.available) unavailable.push("codeql");
      else if (!ready) unavailable.push("codeql database creation");
    } else if (!databaseExists) {
      unavailable.push("codeql database");
    }
    if (ready) {
      const language = (options.codeqlLanguages || detectCodeqlLanguages(root).join(",")).split(",")[0];
      const query = options.codeqlQuery || defaultCodeqlQuery(language);
      const result = commandOutput("codeql", ["database", "analyze", database, query, "--format=sarif-latest", `--output=${sarifPath}`], root);
      const sarif = await fs.readFile(sarifPath, "utf8").catch(() => "");
      if (!result.available || (!result.success && !sarif)) unavailable.push("codeql");
      else if (!sarif) unavailable.push("codeql results");
      else {
        tools.push("codeql");
        findings.push(...parseSarifOutput(sarif, root, options.commitSha));
      }
    }
    await fs.rm(temporary, { recursive: true, force: true });
  }
  return { findings: findings.filter((finding, index, values) => values.findIndex((candidate) => candidate.id === finding.id) === index), tools, unavailable };
}
