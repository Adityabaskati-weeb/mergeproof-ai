import { appendFile, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { toAgentReviewEvents } from "./agent-review";
import type { Analysis } from "./types";

const MAX_FINDINGS = 500;
const FINDINGS_FILE = "findings.jsonl";
const DISPOSITIONS_FILE = "finding-dispositions.jsonl";

export type FindingDisposition = "open" | "ignored";
export type FindingDispositionRecord = { findingId: string; disposition: FindingDisposition; changedAt: string; reason?: string };

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
  disposition: FindingDisposition;
};

function findingsPath(root: string): string { return join(resolve(root), ".mergeproof", FINDINGS_FILE); }
function dispositionsPath(root: string): string { return join(resolve(root), ".mergeproof", DISPOSITIONS_FILE); }

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

async function readDispositions(root: string): Promise<Map<string, FindingDisposition>> {
  try {
    const records = (await readFile(dispositionsPath(root), "utf8")).split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        const value = JSON.parse(line) as FindingDispositionRecord;
        return typeof value.findingId === "string" && (value.disposition === "open" || value.disposition === "ignored") ? [value] : [];
      } catch { return []; }
    }).slice(-MAX_FINDINGS * 2);
    return new Map(records.map((record) => [record.findingId, record.disposition]));
  } catch { return new Map(); }
}

export async function recordAgentFindings(root: string, analysis: Analysis): Promise<StoredFinding[]> {
  const now = new Date().toISOString();
  const additions = toAgentReviewEvents(analysis).flatMap((event, index): StoredFinding[] => event.type === "finding" ? [{ ...event, id: `finding-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`, recordedAt: now, decision: analysis.decision, disposition: "open", ...(analysis.trace.headSha ? { headSha: analysis.trace.headSha } : {}) }] : []);
  if (!additions.length) return [];
  const values = [...(await readAll(root)), ...additions].slice(-MAX_FINDINGS);
  await mkdir(join(resolve(root), ".mergeproof"), { recursive: true });
  await writeFile(findingsPath(root), `${values.map((value) => JSON.stringify(value)).join("\n")}\n`, "utf8");
  return additions;
}

export async function readFindings(root: string, options: { limit?: number; headSha?: string; path?: string; severity?: string; disposition?: FindingDisposition; includeIgnored?: boolean } = {}): Promise<StoredFinding[]> {
  const path = options.path?.trim().toLowerCase();
  const severity = options.severity?.trim().toLowerCase();
  const dispositions = await readDispositions(root);
  return (await readAll(root)).map((finding) => ({ ...finding, disposition: dispositions.get(finding.id) ?? finding.disposition ?? "open" })).filter((finding) => (!options.headSha || finding.headSha === options.headSha) && (!path || finding.fileName.toLowerCase() === path || finding.fileName.toLowerCase().startsWith(`${path}/`)) && (!severity || finding.severity === severity) && (!options.disposition || finding.disposition === options.disposition) && (options.includeIgnored || finding.disposition !== "ignored")).slice(-Math.max(1, Math.min(200, options.limit ?? 50))).reverse();
}

export async function setFindingDisposition(root: string, id: string, disposition: FindingDisposition, reason?: string): Promise<StoredFinding> {
  const finding = (await readAll(root)).find((value) => value.id === id);
  if (!finding) throw new Error(`Finding not found: ${id}`);
  await mkdir(join(resolve(root), ".mergeproof"), { recursive: true });
  const record: FindingDispositionRecord = { findingId: id, disposition, changedAt: new Date().toISOString(), ...(reason ? { reason: reason.slice(0, 500) } : {}) };
  await appendFile(dispositionsPath(root), `${JSON.stringify(record)}\n`, "utf8");
  return { ...finding, disposition };
}

export async function clearFindings(root: string): Promise<void> {
  await writeFile(findingsPath(root), "", "utf8").catch(() => undefined);
  await writeFile(dispositionsPath(root), "", "utf8").catch(() => undefined);
}
