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

export type KnowledgeProposal = {
  id: string;
  repository: string;
  content: string;
  paths: string[];
  proposedBy: string;
  status: "pending" | "approved" | "rejected";
  proposedAt: string;
  decidedAt?: string;
  decisionReason?: string;
};

const KNOWLEDGE_FILE = join(".mergeproof", "knowledge.jsonl");
const PROPOSALS_FILE = join(".mergeproof", "knowledge-proposals.jsonl");
const DECISIONS_FILE = join(".mergeproof", "knowledge-decisions.jsonl");
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

function proposalsFilePath(root: string): string { return join(resolve(root), PROPOSALS_FILE); }
function decisionsFilePath(root: string): string { return join(resolve(root), DECISIONS_FILE); }
function refFromRepository(value: string): PullRequestRef {
  const match = value.match(/^([^/]+)\/([^/]+)$/);
  if (!match) throw new Error("Knowledge repository must use the owner/repo format.");
  return { owner: match[1], repo: match[2], number: 0, url: `https://github.com/${value}` };
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

export async function proposeKnowledge(root: string, ref: PullRequestRef, content: string, paths: string[] = [], proposedBy = "operator"): Promise<KnowledgeProposal> {
  const normalizedContent = redact(content.trim());
  if (!normalizedContent) throw new Error("Knowledge proposal cannot be empty.");
  const normalizedPaths = [...new Set(paths.map((path) => path.trim().replace(/\\/g, "/").replace(/^\.\//, "")).filter(Boolean))].slice(0, 50);
  const repository = repositoryKey(ref);
  const id = createHash("sha256").update(`proposal\0${repository}\0${normalizedContent}\0${normalizedPaths.join("\0")}`).digest("hex").slice(0, 20);
  const proposal: KnowledgeProposal = { id, repository, content: normalizedContent, paths: normalizedPaths, proposedBy: redact(proposedBy.trim() || "operator").slice(0, 200), status: "pending", proposedAt: new Date().toISOString() };
  await fs.mkdir(resolve(root, ".mergeproof"), { recursive: true });
  let existing = "";
  try { existing = await fs.readFile(proposalsFilePath(root), "utf8"); } catch { /* first proposal */ }
  if (!existing.split(/\r?\n/).some((line) => line.includes(`"id":"${id}"`))) await fs.appendFile(proposalsFilePath(root), `${JSON.stringify(proposal)}\n`, "utf8");
  return (await readKnowledgeProposals(root, repository)).find((item) => item.id === id) ?? proposal;
}

export async function readKnowledgeProposals(root: string, repository?: string, limit = 100): Promise<KnowledgeProposal[]> {
  let proposals: KnowledgeProposal[] = [];
  try {
    const file = await fs.readFile(proposalsFilePath(root), "utf8");
    proposals = file.split(/\r?\n/).filter(Boolean).slice(-MAX_KNOWLEDGE_ENTRIES).flatMap((line) => {
      try {
        const value = JSON.parse(line) as KnowledgeProposal;
        return typeof value.id === "string" && typeof value.repository === "string" && typeof value.content === "string" && (!repository || value.repository === repository.toLowerCase()) ? [value] : [];
      } catch { return []; }
    });
  } catch { return []; }
  try {
    const decisions = (await fs.readFile(decisionsFilePath(root), "utf8")).split(/\r?\n/).filter(Boolean).slice(-MAX_KNOWLEDGE_ENTRIES).flatMap((line) => {
      try { return [JSON.parse(line) as { id?: string; status?: KnowledgeProposal["status"]; decidedAt?: string; reason?: string }]; } catch { return []; }
    });
    for (const decision of decisions) {
      const proposal = proposals.find((item) => item.id === decision.id);
      if (proposal && (decision.status === "approved" || decision.status === "rejected")) { proposal.status = decision.status; proposal.decidedAt = decision.decidedAt; proposal.decisionReason = decision.reason; }
    }
  } catch { /* proposals can be read before any decisions exist */ }
  return proposals.slice(-Math.max(1, Math.min(MAX_KNOWLEDGE_ENTRIES, limit))).reverse();
}

async function decideKnowledge(root: string, id: string, status: "approved" | "rejected", reason?: string): Promise<KnowledgeProposal> {
  const proposal = (await readKnowledgeProposals(root)).find((item) => item.id === id);
  if (!proposal) throw new Error(`Knowledge proposal not found: ${id}`);
  if (proposal.status === "approved" || proposal.status === "rejected") return proposal;
  const decidedAt = new Date().toISOString();
  if (status === "approved") await addKnowledge(root, refFromRepository(proposal.repository), proposal.content, proposal.paths);
  await fs.mkdir(resolve(root, ".mergeproof"), { recursive: true });
  await fs.appendFile(decisionsFilePath(root), `${JSON.stringify({ id, status, decidedAt, ...(reason?.trim() ? { reason: redact(reason.trim()).slice(0, 500) } : {}) })}\n`, "utf8");
  return { ...proposal, status, decidedAt, ...(reason?.trim() ? { decisionReason: redact(reason.trim()).slice(0, 500) } : {}) };
}

export function approveKnowledge(root: string, id: string, reason?: string): Promise<KnowledgeProposal> { return decideKnowledge(root, id, "approved", reason); }
export function rejectKnowledge(root: string, id: string, reason?: string): Promise<KnowledgeProposal> { return decideKnowledge(root, id, "rejected", reason); }
