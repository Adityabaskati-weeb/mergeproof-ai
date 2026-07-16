import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import type { PullRequestRef } from "./github";
import type { Analysis, ReviewMemoryEntry } from "./types";

const MEMORY_FILE = join(".mergeproof", "memory.jsonl");
const MAX_MEMORY_BYTES = 5_000_000;
const MAX_MEMORY_ENTRIES = 500;

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? []);
}

function redact(value: string): string {
  return value.replace(/(gh[pousr]|github_pat|xox[baprs]|AKIA)[A-Za-z0-9_\-]{8,}/g, "[REDACTED]").replace(/(password|secret|token|api[_-]?key)\s*[:=]\s*["'][^"']+["']/gi, "$1=[REDACTED]").slice(0, 1500);
}

function repositoryKey(ref: PullRequestRef): string {
  return `${ref.owner}/${ref.repo}`.toLowerCase();
}

export function memoryFilePath(root: string): string {
  return join(resolve(root), MEMORY_FILE);
}

export async function readReviewMemory(root: string, ref: PullRequestRef, query = "", limit = 5): Promise<ReviewMemoryEntry[]> {
  return readRepositoryMemory(root, repositoryKey(ref), query, limit);
}

export async function readRepositoryMemory(root: string, repository: string, query = "", limit = 5): Promise<ReviewMemoryEntry[]> {
  try {
    const file = memoryFilePath(root);
    const stat = await fs.stat(file);
    if (stat.size > MAX_MEMORY_BYTES) return [];
    const content = await fs.readFile(file, "utf8");
    const wanted = tokens(query);
    const entries = content.split(/\r?\n/).filter(Boolean).slice(-MAX_MEMORY_ENTRIES).flatMap((line) => {
      try {
        const entry = JSON.parse(line) as ReviewMemoryEntry;
        return entry.repository.toLowerCase() === repository.toLowerCase() ? [entry] : [];
      } catch {
        return [];
      }
    });
    if (!wanted.size) return entries.slice(-Math.max(1, limit));
    return entries.map((entry) => {
      const haystack = tokens(`${entry.title} ${entry.criteria.join(" ")} ${entry.findings.map((finding) => finding.criterion).join(" ")}`);
      const score = [...wanted].reduce((count, token) => count + (haystack.has(token) ? 1 : 0), 0);
      return { entry, score };
    }).filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score || b.entry.recordedAt.localeCompare(a.entry.recordedAt)).slice(0, Math.max(1, limit)).map((candidate) => candidate.entry);
  } catch {
    return [];
  }
}

export async function recordReviewMemory(root: string, ref: PullRequestRef, prUrl: string, title: string, criteria: string[], analysis: Analysis): Promise<string> {
  const file = memoryFilePath(root);
  await fs.mkdir(resolve(root, ".mergeproof"), { recursive: true });
  const entry: ReviewMemoryEntry = {
    repository: repositoryKey(ref),
    prUrl,
    headSha: analysis.trace.headSha ?? "unknown",
    title: title.slice(0, 500),
    decision: analysis.decision,
    criteria: criteria.slice(0, 100).map((criterion) => criterion.slice(0, 500)),
    findings: analysis.rows.slice(0, 100).map((row) => ({ criterion: redact(row.criterion).slice(0, 500), state: row.state, evidence: redact(row.evidence) })),
    securityFindings: (analysis.securityFindings ?? []).slice(0, 100),
    model: analysis.trace.model,
    recordedAt: new Date().toISOString(),
  };
  await fs.appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
  return file;
}
