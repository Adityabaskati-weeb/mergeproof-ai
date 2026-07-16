import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import type { PullRequestRef } from "./github";

export type KnowledgeFact = {
  id: string;
  repository: string;
  content: string;
  paths: string[];
  source: "human";
  approved: true;
  recordedAt: string;
};

const KNOWLEDGE_FILE = join(".mergeproof", "knowledge.jsonl");
const MAX_KNOWLEDGE_BYTES = 2_000_000;
const MAX_KNOWLEDGE_ENTRIES = 500;
const MAX_FACT_LENGTH = 2_000;

function repositoryKey(ref: PullRequestRef): string {
  return `${ref.owner}/${ref.repo}`.toLowerCase();
}

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? []);
}

function redact(value: string): string {
  return value.replace(/(gh[pousr]|github_pat|xox[baprs]|AKIA)[A-Za-z0-9_\-]{8,}/g, "[REDACTED]").replace(/(password|secret|token|api[_-]?key)\s*[:=]\s*["'][^"']+["']/gi, "$1=[REDACTED]").slice(0, MAX_FACT_LENGTH);
}

export function knowledgeFilePath(root: string): string {
  return join(resolve(root), KNOWLEDGE_FILE);
}

export async function readKnowledge(root: string, ref: PullRequestRef, changedPaths: string[] = [], query = "", limit = 12): Promise<KnowledgeFact[]> {
  try {
    const file = knowledgeFilePath(root);
    const stat = await fs.stat(file);
    if (stat.size > MAX_KNOWLEDGE_BYTES) return [];
    const wanted = tokens(query);
    const paths = changedPaths.map((path) => path.replace(/\\/g, "/").toLowerCase());
    const entries = (await fs.readFile(file, "utf8")).split(/\r?\n/).filter(Boolean).slice(-MAX_KNOWLEDGE_ENTRIES).flatMap((line) => {
      try {
        const entry = JSON.parse(line) as KnowledgeFact;
        if (!entry.approved || entry.repository.toLowerCase() !== repositoryKey(ref)) return [];
        const scoped = entry.paths.length === 0 || paths.some((path) => entry.paths.some((scope) => path === scope || path.startsWith(`${scope}/`)));
        if (!scoped) return [];
        return [entry];
      } catch {
        return [];
      }
    });
    if (!wanted.size) return entries.slice(-Math.max(1, limit));
    return entries.map((entry) => ({ entry, score: [...wanted].reduce((score, token) => score + (tokens(entry.content).has(token) ? 1 : 0), 0) })).filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score || b.entry.recordedAt.localeCompare(a.entry.recordedAt)).slice(0, Math.max(1, limit)).map((candidate) => candidate.entry);
  } catch {
    return [];
  }
}

export async function addKnowledge(root: string, ref: PullRequestRef, content: string, paths: string[] = []): Promise<KnowledgeFact> {
  const normalizedContent = redact(content.trim());
  if (!normalizedContent) throw new Error("Knowledge fact cannot be empty.");
  const normalizedPaths = [...new Set(paths.map((path) => path.trim().replace(/\\/g, "/").replace(/^\.\//, "")).filter(Boolean))].slice(0, 50);
  const id = createHash("sha256").update(`${repositoryKey(ref)}\0${normalizedContent}\0${normalizedPaths.join("\0")}`).digest("hex").slice(0, 20);
  const fact: KnowledgeFact = { id, repository: repositoryKey(ref), content: normalizedContent, paths: normalizedPaths, source: "human", approved: true, recordedAt: new Date().toISOString() };
  const file = knowledgeFilePath(root);
  await fs.mkdir(resolve(root, ".mergeproof"), { recursive: true });
  let existing = "";
  try { existing = await fs.readFile(file, "utf8"); } catch { /* first fact */ }
  if (!existing.split(/\r?\n/).some((line) => line.includes(`"id":"${id}"`))) await fs.appendFile(file, `${JSON.stringify(fact)}\n`, "utf8");
  return fact;
}
