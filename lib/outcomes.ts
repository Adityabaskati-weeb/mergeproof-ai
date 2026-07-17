import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { PullRequestRef } from "./github";
import type { Analysis } from "./types";

export type OutcomeLabel = "merged" | "closed-unmerged" | "false-positive" | "missed-risk" | "accepted" | "rejected";
export type ReviewOutcome = { id: string; recordedAt: string; repository: string; target: string; label: OutcomeLabel; predictedDecision?: Analysis["decision"]; headSha?: string; attestation?: string; reason?: string };
export type OutcomeSummary = { total: number; labels: Record<string, number>; decisions: Record<string, number>; readyCalibration?: { merged: number; notMerged: number; total: number; rate: number } };

const MAX_OUTCOMES = 2_000;

function outcomePath(root: string): string { return join(resolve(root), ".mergeproof", "outcomes.jsonl"); }
function repositoryKey(ref: PullRequestRef): string { return `${ref.owner}/${ref.repo}`.toLowerCase(); }

export async function recordOutcome(root: string, ref: PullRequestRef, target: string, label: OutcomeLabel, metadata: { analysis?: Analysis; predictedDecision?: Analysis["decision"]; headSha?: string; attestation?: string; reason?: string } = {}): Promise<ReviewOutcome> {
  await mkdir(join(resolve(root), ".mergeproof"), { recursive: true });
  const value: ReviewOutcome = {
    id: `outcome-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    recordedAt: new Date().toISOString(),
    repository: repositoryKey(ref),
    target: target.slice(0, 2_000),
    label,
    ...(metadata.analysis ? { predictedDecision: metadata.analysis.decision, headSha: metadata.analysis.trace.headSha, attestation: metadata.analysis.trace.attestation?.digest } : metadata.predictedDecision ? { predictedDecision: metadata.predictedDecision, ...(metadata.headSha ? { headSha: metadata.headSha } : {}), ...(metadata.attestation ? { attestation: metadata.attestation } : {}) } : {}),
    ...(metadata.reason ? { reason: metadata.reason.slice(0, 2_000) } : {}),
  };
  await appendFile(outcomePath(root), `${JSON.stringify(value)}\n`, "utf8");
  return value;
}

export async function readOutcomes(root: string, repository?: string, limit = MAX_OUTCOMES): Promise<ReviewOutcome[]> {
  try {
    const lines = (await readFile(outcomePath(root), "utf8")).split(/\r?\n/).filter(Boolean).slice(-MAX_OUTCOMES);
    return lines.flatMap((line) => {
      try {
        const value = JSON.parse(line) as ReviewOutcome;
        return typeof value.id === "string" && typeof value.target === "string" && (!repository || value.repository === repository.toLowerCase()) ? [value] : [];
      } catch { return []; }
    }).slice(-Math.max(1, Math.min(limit, MAX_OUTCOMES))).reverse();
  } catch { return []; }
}

export function summarizeOutcomes(outcomes: ReviewOutcome[]): OutcomeSummary {
  const labels: Record<string, number> = {};
  const decisions: Record<string, number> = {};
  for (const outcome of outcomes) {
    labels[outcome.label] = (labels[outcome.label] ?? 0) + 1;
    if (outcome.predictedDecision) decisions[outcome.predictedDecision] = (decisions[outcome.predictedDecision] ?? 0) + 1;
  }
  const judged = outcomes.filter((outcome) => outcome.predictedDecision === "ready" && ["merged", "closed-unmerged", "accepted", "rejected"].includes(outcome.label));
  if (!judged.length) return { total: outcomes.length, labels, decisions };
  const merged = judged.filter((outcome) => outcome.label === "merged" || outcome.label === "accepted").length;
  return { total: outcomes.length, labels, decisions, readyCalibration: { merged, notMerged: judged.length - merged, total: judged.length, rate: Number((merged / judged.length).toFixed(4)) } };
}
