import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import type { ReviewPlan } from "./models";

const HISTORY_PATH = ".mergeproof/plan-history.jsonl";
const MAX_ENTRIES = 200;

export type PlanHistoryEntry = {
  id: string;
  version: number;
  recordedAt: string;
  kind: "change-request" | "work-item";
  target: string;
  request: string;
  model: string;
  headSha: string;
  digest: string;
  plan: ReviewPlan;
};

function planDigest(plan: ReviewPlan): string {
  return createHash("sha256").update(JSON.stringify({ summary: plan.summary, risks: plan.risks, steps: plan.steps })).digest("hex");
}

function planId(kind: PlanHistoryEntry["kind"], target: string, request: string): string {
  return createHash("sha256").update(`${kind}\n${target}\n${request.trim().toLowerCase()}`).digest("hex").slice(0, 16);
}

async function readEntries(root: string): Promise<PlanHistoryEntry[]> {
  try {
    const lines = (await fs.readFile(join(resolve(root), HISTORY_PATH), "utf8")).split(/\r?\n/).filter(Boolean);
    return lines.map((line) => JSON.parse(line) as PlanHistoryEntry).filter((entry) => entry && typeof entry.id === "string" && typeof entry.version === "number");
  } catch {
    return [];
  }
}

export async function recordPlanVersion(root: string, plan: ReviewPlan, options: { kind: PlanHistoryEntry["kind"]; target: string; request?: string }): Promise<PlanHistoryEntry> {
  const repositoryRoot = resolve(root);
  const request = options.request?.trim() || options.target;
  const id = planId(options.kind, options.target, request);
  const entries = await readEntries(repositoryRoot);
  const version = Math.max(0, ...entries.filter((entry) => entry.id === id).map((entry) => entry.version)) + 1;
  const entry: PlanHistoryEntry = { id, version, recordedAt: new Date().toISOString(), kind: options.kind, target: options.target, request: request.slice(0, 16_000), model: plan.trace.model, headSha: plan.trace.headSha, digest: planDigest(plan), plan: { ...plan, trace: { ...plan.trace, planId: id, version } } };
  await fs.mkdir(join(repositoryRoot, ".mergeproof"), { recursive: true });
  const next = [...entries, entry].slice(-MAX_ENTRIES);
  await fs.writeFile(join(repositoryRoot, HISTORY_PATH), `${next.map((value) => JSON.stringify(value)).join("\n")}\n`, "utf8");
  return entry;
}

export async function readPlanHistory(root: string, options: { id?: string; limit?: number } = {}): Promise<PlanHistoryEntry[]> {
  const entries = await readEntries(root);
  const filtered = options.id ? entries.filter((entry) => entry.id === options.id) : entries;
  return filtered.slice(-(options.limit ?? 20)).reverse();
}

export const PLAN_HISTORY_RELATIVE_PATH = HISTORY_PATH;
