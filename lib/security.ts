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

function addedLines(patch: string): Array<{ line: number; text: string }> {
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
        });
      }
    }
  }
  return findings.filter((finding, index, values) => values.findIndex((candidate) => candidate.id === finding.id) === index);
}
