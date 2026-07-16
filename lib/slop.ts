import type { PullRequestContext } from "./github";
import type { SecurityFinding } from "./types";
import { addedLines } from "./security";

export function scanSlopSignals(context: PullRequestContext): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  let additions = 0;
  let firstChangedFile: { path: string; line: number; url: string } | undefined;
  for (const file of context.files) {
    const lines = addedLines(file.patch);
    additions += lines.length;
    if (!firstChangedFile && lines[0]) firstChangedFile = { path: file.path, line: lines[0].line, url: file.url };
    for (const line of lines) {
      const checks: Array<{ id: string; title: string; detail: string; match: boolean }> = [
        { id: "placeholder", title: "Placeholder implementation added", detail: "The change contains a placeholder or not-implemented marker that may indicate unfinished generated code.", match: /\b(?:TODO|FIXME|TBD|not implemented|lorem ipsum|your[-_ ]?(?:api|token|key))\b/i.test(line.text) },
        { id: "swallowed-error", title: "Error is silently swallowed", detail: "An empty catch block was added; this can hide failures and should be justified.", match: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(line.text) },
      ];
      for (const check of checks) {
        if (!check.match) continue;
        findings.push({ id: `${check.id}:${file.path}:${line.line}`, title: check.title, severity: "medium", path: file.path, line: line.line, detail: check.detail, category: "quality", citation: { path: file.path, commitSha: context.headSha, url: `${file.url}#L${line.line}` } });
      }
    }
  }
  if (additions >= 800 && !context.files.some((file) => /(^|\/)(test|tests|__tests__)(\/|$)|\.(?:test|spec)\./i.test(file.path))) {
    const file = firstChangedFile ?? { path: "(change set)", line: 1, url: context.ref.url };
    findings.push({ id: "large-uncovered-change", title: "Large change has no apparent test file", severity: "medium", path: file.path, line: file.line, detail: "A large change set was added without an apparent test file. Confirm coverage before merging.", category: "quality", citation: { path: file.path, commitSha: context.headSha, url: `${file.url}#L${file.line}` } });
  }
  return findings.filter((finding, index, values) => values.findIndex((candidate) => candidate.id === finding.id) === index);
}
