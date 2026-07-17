import type { AuditEvent } from "./audit";
import type { ReviewOutcome, OutcomeSummary } from "./outcomes";
import { summarizeOutcomes } from "./outcomes";

export type ReviewReport = {
  generatedAt: string;
  repository?: string;
  periodDays?: number;
  reviews: { total: number; actions: Record<string, number>; decisions: Record<string, number>; models: Record<string, number>; attested: number; targets: number };
  outcomes: OutcomeSummary;
  activityByDay: Record<string, number>;
};

function count(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((result, value) => { result[value] = (result[value] ?? 0) + 1; return result; }, {});
}

export function filterReviewRecords(events: AuditEvent[], outcomes: ReviewOutcome[], options: { repository?: string; periodDays?: number } = {}): { events: AuditEvent[]; outcomes: ReviewOutcome[] } {
  const cutoff = options.periodDays && options.periodDays > 0 ? Date.now() - options.periodDays * 86_400_000 : undefined;
  const repository = options.repository?.toLowerCase();
  const eventMatches = (event: AuditEvent) => (!repository || event.target.toLowerCase().includes(repository)) && (!cutoff || Date.parse(event.recordedAt) >= cutoff);
  const outcomeMatches = (outcome: ReviewOutcome) => (!repository || outcome.repository === repository) && (!cutoff || Date.parse(outcome.recordedAt) >= cutoff);
  return { events: events.filter(eventMatches), outcomes: outcomes.filter(outcomeMatches) };
}

export function buildReviewReport(events: AuditEvent[], outcomes: ReviewOutcome[], options: { repository?: string; periodDays?: number } = {}): ReviewReport {
  const filtered = filterReviewRecords(events, outcomes, options);
  const filteredEvents = filtered.events;
  const filteredOutcomes = filtered.outcomes;
  return {
    generatedAt: new Date().toISOString(),
    ...(options.repository ? { repository: options.repository.toLowerCase() } : {}),
    ...(options.periodDays ? { periodDays: options.periodDays } : {}),
    reviews: {
      total: filteredEvents.length,
      actions: count(filteredEvents.map((event) => event.action)),
      decisions: count(filteredEvents.map((event) => event.decision ?? "unknown")),
      models: count(filteredEvents.map((event) => event.model ?? "unknown")),
      attested: filteredEvents.filter((event) => Boolean(event.attestation)).length,
      targets: new Set(filteredEvents.map((event) => event.target)).size,
    },
    outcomes: summarizeOutcomes(filteredOutcomes),
    activityByDay: count(filteredEvents.map((event) => event.recordedAt.slice(0, 10))),
  };
}

function csv(value: string): string {
  return '"' + value.replace(/"/g, '""') + '"';
}

export function renderReviewReportCsv(events: AuditEvent[], outcomes: ReviewOutcome[]): string {
  const rows = ["kind,id,recordedAt,action,target,decision,model,attestation,label,repository,reason"];
  for (const event of events) rows.push(["review", event.id, event.recordedAt, event.action, event.target, event.decision ?? "", event.model ?? "", event.attestation ?? "", "", "", ""].map(csv).join(","));
  for (const outcome of outcomes) rows.push(["outcome", outcome.id, outcome.recordedAt, "", outcome.target, outcome.predictedDecision ?? "", "", outcome.attestation ?? "", outcome.label, outcome.repository, outcome.reason ?? ""].map(csv).join(","));
  return `${rows.join("\n")}\n`;
}

export function renderReviewReportMarkdown(report: ReviewReport): string {
  const decisions = Object.entries(report.reviews.decisions).map(([key, value]) => `${key}=${value}`).join(", ") || "none";
  const actions = Object.entries(report.reviews.actions).map(([key, value]) => `${key}=${value}`).join(", ") || "none";
  const calibration = report.outcomes.readyCalibration ? `${Math.round(report.outcomes.readyCalibration.rate * 100)}% (${report.outcomes.readyCalibration.merged}/${report.outcomes.readyCalibration.total})` : "not enough judged outcomes";
  return [`# MergeProof report`, ``, `Generated: ${report.generatedAt}`, report.repository ? `Repository: ${report.repository}` : "", report.periodDays ? `Period: last ${report.periodDays} days` : "", ``, `## Review activity`, `- Reviews: ${report.reviews.total}`, `- Targets: ${report.reviews.targets}`, `- Attested: ${report.reviews.attested}`, `- Actions: ${actions}`, `- Decisions: ${decisions}`, `- Models: ${Object.entries(report.reviews.models).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`, ``, `## Outcomes`, `- Total outcomes: ${report.outcomes.total}`, `- Ready calibration: ${calibration}`, `- Labels: ${Object.entries(report.outcomes.labels).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`].filter(Boolean).join("\n");
}
