import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Analysis } from "./types";

export type PreMergeOverride = {
  id: string;
  target: string;
  headSha: string;
  check: string;
  by: string;
  reason: string;
  recordedAt: string;
};

const MAX_OVERRIDES = 500;

function overridePath(root: string): string {
  return join(resolve(root), ".mergeproof", "overrides.jsonl");
}

function normalizeTarget(target: string): string {
  return target.trim().replace(/\/$/, "");
}

function clean(value: string, field: string, max: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  if (normalized.length > max) throw new Error(`${field} must be ${max} characters or fewer.`);
  return normalized;
}

export async function recordPreMergeOverride(root: string, input: Omit<PreMergeOverride, "id" | "recordedAt">): Promise<PreMergeOverride> {
  const value: PreMergeOverride = {
    id: `override-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    target: normalizeTarget(clean(input.target, "target", 500)),
    headSha: clean(input.headSha, "head SHA", 200),
    check: clean(input.check, "check", 200),
    by: clean(input.by, "identity", 200),
    reason: clean(input.reason, "reason", 2_000),
    recordedAt: new Date().toISOString(),
  };
  await mkdir(resolve(root, ".mergeproof"), { recursive: true });
  await appendFile(overridePath(root), `${JSON.stringify(value)}\n`, "utf8");
  return value;
}

export async function readPreMergeOverrides(root: string, target: string, headSha: string): Promise<PreMergeOverride[]> {
  try {
    const lines = (await readFile(overridePath(root), "utf8")).split(/\r?\n/).filter(Boolean).slice(-MAX_OVERRIDES);
    const latest = new Map<string, PreMergeOverride>();
    for (const line of lines) {
      try {
        const value = JSON.parse(line) as PreMergeOverride;
        if (typeof value.id !== "string" || typeof value.target !== "string" || typeof value.headSha !== "string" || typeof value.check !== "string" || typeof value.by !== "string" || typeof value.reason !== "string") continue;
        if (normalizeTarget(value.target) !== normalizeTarget(target) || value.headSha !== headSha) continue;
        latest.set(value.check.toLowerCase(), value);
      } catch {
        // Ignore malformed local records without hiding valid overrides.
      }
    }
    return [...latest.values()];
  } catch {
    return [];
  }
}

export function applyPreMergeOverrides(analysis: Analysis, overrides: PreMergeOverride[], configuredChecks: string[]): Analysis {
  const configured = new Set(configuredChecks.map((check) => check.trim().toLowerCase()).filter(Boolean));
  const applied = [...new Map(overrides
    .filter((override) => configured.has(override.check.toLowerCase()))
    .map((override) => [override.check.toLowerCase(), override])).values()];
  const names = applied.map((override) => override.check);
  const overrideSet = new Set(names.map((name) => name.toLowerCase()));
  const overriddenRows = analysis.rows.filter((row) => overrideSet.has(row.criterion.toLowerCase()) && row.state !== "pass");
  const remainingRows = analysis.rows.filter((row) => row.state !== "pass" && !overrideSet.has(row.criterion.toLowerCase()));
  const blockingFailures = Math.max(0, (analysis.trace.blockingFailures ?? 0) - overriddenRows.length);
  const customCheckWarnings = Math.max(0, (analysis.trace.customCheckWarnings ?? 0) - overriddenRows.length);
  const securityBlocked = [...(analysis.securityFindings ?? []), ...(analysis.qualitySignals ?? [])].some((finding) => finding.severity === "high" || finding.severity === "medium");
  const canProceed = analysis.trace.unsupportedClaims === 0 && !securityBlocked && blockingFailures === 0 && remainingRows.length === 0;
  return {
    ...analysis,
    decision: canProceed && (analysis.decision === "needs-evidence" || analysis.decision === "ready") ? "ready" : analysis.decision,
    trace: { ...analysis.trace, overrides: names, blockingFailures, customCheckWarnings },
  };
}
