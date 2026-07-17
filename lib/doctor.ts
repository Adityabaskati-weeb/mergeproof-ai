import { execFileSync } from "node:child_process";
import { access, constants, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export type DoctorStatus = "pass" | "warn" | "fail";
export type DoctorCheck = { id: string; status: DoctorStatus; message: string; remediation?: string };
export type DoctorReport = { repository: string; generatedAt: string; checks: DoctorCheck[]; ok: boolean };

function commandAvailable(command: string, args: string[] = ["--version"]): boolean {
  try {
    execFileSync(command, args, { stdio: "ignore", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

function gitHead(repository: string): string | undefined {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 }).trim(); }
  catch { return undefined; }
}

async function writableMergeProofDirectory(repository: string): Promise<boolean> {
  const directory = join(repository, ".mergeproof");
  try { await mkdir(directory, { recursive: true }); await access(directory, constants.W_OK); return true; }
  catch { return false; }
}

export async function runDoctor(root = process.cwd()): Promise<DoctorReport> {
  const repository = resolve(root);
  const checks: DoctorCheck[] = [];
  const majorNode = Number(process.versions.node.split(".")[0]) >= 20;
  checks.push(majorNode ? { id: "node", status: "pass", message: `Node.js ${process.versions.node} is supported.` } : { id: "node", status: "fail", message: `Node.js ${process.versions.node} is too old.`, remediation: "Install Node.js 20 or newer." });
  checks.push(commandAvailable("git") ? { id: "git", status: "pass", message: "Git is available." } : { id: "git", status: "fail", message: "Git is not available on PATH.", remediation: "Install Git and restart the terminal." });
  const head = gitHead(repository);
  checks.push(head ? { id: "repository", status: "pass", message: `Git repository detected at ${repository} (HEAD ${head.slice(0, 12)}).` } : { id: "repository", status: "fail", message: `No usable Git repository was found at ${repository}.`, remediation: "Run doctor from a Git checkout or pass --repo." });
  checks.push(await writableMergeProofDirectory(repository) ? { id: "storage", status: "pass", message: ".mergeproof storage is writable." } : { id: "storage", status: "fail", message: ".mergeproof storage is not writable.", remediation: "Grant write permission to the repository or choose a writable checkout." });
  const provider = (process.env.MERGEPROOF_PROVIDER || "openai").toLowerCase();
  const hasCredential = provider === "anthropic" ? Boolean(process.env.ANTHROPIC_API_KEY) : Boolean(process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL);
  checks.push(hasCredential ? { id: "model-credentials", status: "pass", message: `${provider} model credentials are configured.` } : { id: "model-credentials", status: "warn", message: `No ${provider} model credential was detected.`, remediation: provider === "anthropic" ? "Set ANTHROPIC_API_KEY or choose another provider." : "Set OPENAI_API_KEY or configure an OpenAI-compatible OPENAI_BASE_URL." });
  if (commandAvailable("gh", ["auth", "status", "--hostname", "github.com"])) checks.push({ id: "github-auth", status: "pass", message: "GitHub CLI authentication is available." });
  else checks.push({ id: "github-auth", status: "warn", message: "GitHub CLI authentication is unavailable; public GitHub reads may still work.", remediation: "Run gh auth login or configure a GitHub token for private repositories and publication." });
  const npmAvailable = process.platform === "win32"
    ? commandAvailable(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm --version"])
    : commandAvailable("npm");
  checks.push(npmAvailable ? { id: "npm", status: "pass", message: "npm is available for verification commands." } : { id: "npm", status: "warn", message: "npm is not available; JavaScript verification commands will not run." });
  checks.push(commandAvailable("cargo") ? { id: "cargo", status: "pass", message: "Cargo is available for native desktop builds." } : { id: "cargo", status: "warn", message: "Cargo is not available; native Tauri packaging cannot run in this environment.", remediation: "Install Rust via rustup to build the desktop bundle." });
  checks.push(process.env.TAVILY_API_KEY || process.env.BRAVE_SEARCH_API_KEY ? { id: "web-search", status: "pass", message: "Opt-in web search credentials are configured." } : { id: "web-search", status: "warn", message: "Web search is disabled because no Tavily or Brave credential is configured.", remediation: "Set TAVILY_API_KEY or BRAVE_SEARCH_API_KEY only if external research is desired." });
  return { repository, generatedAt: new Date().toISOString(), checks, ok: checks.every((check) => check.status !== "fail") };
}

export function renderDoctor(report: DoctorReport): string {
  return [`MergeProof doctor: ${report.ok ? "ready" : "blocked"}`, `Repository: ${report.repository}`, "", ...report.checks.map((check) => `${check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL"} ${check.id}: ${check.message}${check.remediation ? ` (${check.remediation})` : ""}`)].join("\n");
}
