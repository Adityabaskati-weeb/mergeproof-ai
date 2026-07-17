import { readAuditEvents, type AuditEvent } from "./audit";
import { readFindings, type StoredFinding } from "./findings";
import { readOutcomes, summarizeOutcomes, type ReviewOutcome } from "./outcomes";

export type ReviewStats = {
  generatedAt: string;
  reviews: { total: number; actions: Record<string, number>; decisions: Record<string, number>; models: Record<string, number>; attested: number; averageElapsedMs?: number };
  findings: { total: number; open: number; ignored: number; bySeverity: Record<string, number> };
  outcomes: ReturnType<typeof summarizeOutcomes>;
};

function count(values: string[]): Record<string, number> { return values.reduce<Record<string, number>>((result, value) => { result[value] = (result[value] ?? 0) + 1; return result; }, {}); }

export function buildReviewStats(events: AuditEvent[], findings: StoredFinding[], outcomes: ReviewOutcome[]): ReviewStats {
  const elapsed = events.map((event) => event.elapsedMs).filter((value): value is number => typeof value === "number" && value >= 0);
  return {
    generatedAt: new Date().toISOString(),
    reviews: { total: events.length, actions: count(events.map((event) => event.action)), decisions: count(events.map((event) => event.decision ?? "unknown")), models: count(events.map((event) => event.model ?? "unknown")), attested: events.filter((event) => Boolean(event.attestation)).length, ...(elapsed.length ? { averageElapsedMs: Math.round(elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length) } : {}) },
    findings: { total: findings.length, open: findings.filter((finding) => finding.disposition !== "ignored").length, ignored: findings.filter((finding) => finding.disposition === "ignored").length, bySeverity: count(findings.map((finding) => finding.severity)) },
    outcomes: summarizeOutcomes(outcomes),
  };
}

export async function readReviewStats(root: string): Promise<ReviewStats> {
  return buildReviewStats(await readAuditEvents(root, 500), await readFindings(root, { limit: 200, includeIgnored: true }), await readOutcomes(root, undefined, 2_000));
}
