import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { toAgentReviewEvents } from "./agent-review";
import type { Analysis } from "./types";

const MAX_FINDINGS = 500;
const FINDINGS_FILE = "findings.jsonl";

export type StoredFinding = {
  id: string;
  recordedAt: string;
  decision: Analysis["decision"];
  headSha?: string;
  severity: "critical" | "major" | "minor" | "trivial" | "info";
  fileName: string;
  line?: number;
  criterion: string;
  comment: string;
  codegenInstructions: string;
  suggestions: string[];
  citations: Array<{ path: string; commitSha: string; url: string }>;
  source: "criterion" | "security" | "quality";
};

function findingsPath(root: string): string { return join(resolve(root), ".mergeproof", FINDINGS_FILE); }

async function readAll(root: string): Promise<StoredFinding[]> {
  try {
    return (await readFile(findingsPath(root), "utf8")).split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        const value = JSON.parse(line) as StoredFinding;
        return typeof value.id === "string" && typeof value.fileName === "string" && typeof value.comment === "string" ? [value] : [];
      } catch { return []; }
    }).slice(-MAX_FINDINGS);
  } catch { return []; }
}

export async function recordAgentFindings(root: string, analysis: Analysis): Promise<StoredFinding[]> {
  const now = new Date().toISOString();
  const additions = toAgentReviewEvents(analysis).flatMap((event, index): StoredFinding[] => event.type === "finding" ? [{ ...event, id: `finding-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`, recordedAt: now, decision: analysis.decision, ...(analysis.trace.headSha ? { headSha: analysis.trace.headSha } : {}) }] : []);
  if (!additions.length) return [];
  const values = [...(await readAll(root)), ...additions].slice(-MAX_FINDINGS);
  await mkdir(join(resolve(root), ".mergeproof"), { recursive: true });
  await writeFile(findingsPath(root), `${values.map((value) => JSON.stringify(value)).join("\n")}\n`, "utf8");
  return additions;
}

export async function readFindings(root: string, options: { limit?: number; headSha?: string; path?: string; severity?: string } = {}): Promise<StoredFinding[]> {
  const path = options.path?.trim().toLowerCase();
  const severity = options.severity?.trim().toLowerCase();
  return (await readAll(root)).filter((finding) => (!options.headSha || finding.headSha === options.headSha) && (!path || finding.fileName.toLowerCase() === path || finding.fileName.toLowerCase().startsWith(`${path}/`)) && (!severity || finding.severity === severity)).slice(-Math.max(1, Math.min(200, options.limit ?? 50))).reverse();
}

export async function clearFindings(root: string): Promise<void> {
  await writeFile(findingsPath(root), "", "utf8").catch(() => undefined);
}
