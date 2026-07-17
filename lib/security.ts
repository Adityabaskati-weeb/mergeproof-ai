import { promises as fs } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PullRequestContext } from "./github";
import type { SecurityFinding } from "./types";

type Pattern = { id: string; title: string; severity: SecurityFinding["severity"]; detail: string; pattern: RegExp };

const PATTERNS: Pattern[] = [
  { id: "private-key", title: "Private key material added", severity: "high", detail: "A private key block was added to the pull request.", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/i },
  { id: "aws-access-key", title: "Cloud access key added", severity: "high", detail: "An AWS-style access key was added to the change.", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "github-token", title: "GitHub token added", severity: "high", detail: "A GitHub access token pattern was added to the change.", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { id: "slack-token", title: "Slack token added", severity: "high", detail: "A Slack bot or app token pattern was added to the change.", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: "credential-assignment", title: "Credential literal added", severity: "high", detail: "A credential-like value was assigned directly in source.", pattern: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\b\s*[:=]\s*["'][^"']{8,}["']/i },
  { id: "dynamic-eval", title: "Dynamic code execution added", severity: "medium", detail: "Dynamic evaluation can execute untrusted input and requires explicit review.", pattern: /\beval\s*\(|\bnew\s+Function\s*\(/ },
  { id: "shell-exec", title: "Shell execution added", severity: "medium", detail: "A shell execution API was added and should be reviewed for command injection.", pattern: /\b(?:child_process\.)?(?:exec|execFile|spawn|fork)\s*\(|\bos\.system\s*\(/ },
  { id: "unsafe-html", title: "Raw HTML injection sink added", severity: "medium", detail: "Raw HTML rendering was added and requires sanitization review.", pattern: /dangerouslySetInnerHTML|innerHTML\s*=/ },
  { id: "install-script", title: "Dependency install script changed", severity: "medium", detail: "Install-time scripts execute with developer or CI privileges.", pattern: /["'](?:preinstall|install|postinstall)["']\s*:/i },
];

const REPOSITORY_IGNORED_DIRECTORIES = new Set([".git", ".mergeproof", "node_modules", "dist", "build", "target", ".next", "coverage"]);
const REPOSITORY_SENSITIVE_NAMES = new Set([".env", ".env.local", ".env.production", ".env.development", "id_rsa", "credentials.json"]);
const REPOSITORY_SENSITIVE_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx"]);

async function collectRepositoryFiles(root: string, current: string, output: string[], depth = 0): Promise<void> {
  if (depth > 20 || output.length >= 5_000) return;
  for (const entry of await fs.readdir(current, { withFileTypes: true })) {
    if (entry.isDirectory() && REPOSITORY_IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) await collectRepositoryFiles(root, absolute, output, depth + 1);
    else if (entry.isFile()) output.push(relative(root, absolute).replace(/\\/g, "/"));
  }
}

export async function scanRepositorySecurity(root: string, commitSha = "repository"): Promise<SecurityFinding[]> {
  const repositoryRoot = resolve(root);
  const paths: string[] = [];
  await collectRepositoryFiles(repositoryRoot, repositoryRoot, paths);
  const findings: SecurityFinding[] = [];
  for (const path of paths) {
    if (REPOSITORY_SENSITIVE_NAMES.has(basename(path).toLowerCase()) || REPOSITORY_SENSITIVE_EXTENSIONS.has(extname(path).toLowerCase())) continue;
    const absolute = join(repositoryRoot, path);
    const stat = await fs.stat(absolute).catch(() => undefined);
    if (!stat || stat.size > 250_000) continue;
    const buffer = await fs.readFile(absolute).catch(() => undefined);
    if (!buffer || buffer.includes(0)) continue;
    const lines = buffer.toString("utf8").split(/\r?\n/);
    for (const [index, text] of lines.entries()) {
      for (const pattern of PATTERNS) {
        if (!pattern.pattern.test(text)) continue;
        findings.push({ id: `repository:${pattern.id}:${path}:${index + 1}`, title: pattern.title, severity: pattern.severity, path, line: index + 1, detail: pattern.detail, citation: { path, commitSha, url: `${pathToFileURL(absolute).toString()}#L${index + 1}` }, category: "security" });
      }
    }
  }
  return findings;
}

export function addedLines(patch: string): Array<{ line: number; text: string }> {
  const result: Array<{ line: number; text: string }> = [];
  let nextLine = 1;
  for (const line of patch.split(/\r?\n/)) {
    const hunk = line.match(/^@@ [^+]*\+(\d+)(?:,\d+)?/);
    if (hunk) {
      nextLine = Number(hunk[1]);
      continue;
    }
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) {
      result.push({ line: nextLine, text: line.slice(1) });
      nextLine += 1;
      continue;
    }
    if (!line.startsWith("\\")) nextLine += 1;
  }
  return result;
}

export function scanPullRequestSecurity(context: PullRequestContext): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const file of context.files) {
    for (const added of addedLines(file.patch)) {
      for (const pattern of PATTERNS) {
        if (!pattern.pattern.test(added.text)) continue;
        findings.push({
          id: `${pattern.id}:${file.path}:${added.line}`,
          title: pattern.title,
          severity: pattern.severity,
          path: file.path,
          line: added.line,
          detail: pattern.detail,
          citation: { path: file.path, commitSha: context.headSha, url: `${file.url}#L${added.line}` },
          category: "security",
        });
      }
    }
  }
  return findings.filter((finding, index, values) => values.findIndex((candidate) => candidate.id === finding.id) === index);
}
