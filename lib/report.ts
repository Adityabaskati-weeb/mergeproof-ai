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

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] ?? character);
}

function reportCard(label: string, value: string, detail: string): string {
  return `<article class="card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`;
}

export function renderReviewReportHtml(report: ReviewReport): string {
  const calibration = report.outcomes.readyCalibration ? `${Math.round(report.outcomes.readyCalibration.rate * 100)}%` : "-";
  const decisions = Object.entries(report.reviews.decisions).sort(([a], [b]) => a.localeCompare(b));
  const decisionRows = decisions.map(([decision, countValue]) => `<div class="bar-row"><span>${escapeHtml(decision)}</span><div class="bar"><i style="width:${report.reviews.total ? Math.round((countValue / report.reviews.total) * 100) : 0}%"></i></div><b>${countValue}</b></div>`).join("") || "<p class=\"muted\">No decisions recorded.</p>";
  const activity = Object.entries(report.activityByDay).sort(([a], [b]) => a.localeCompare(b));
  const maxActivity = Math.max(1, ...activity.map(([, countValue]) => countValue));
  const activityRows = activity.map(([day, countValue]) => `<div class="activity"><span>${escapeHtml(day)}</span><div class="bar"><i style="width:${Math.round((countValue / maxActivity) * 100)}%"></i></div><b>${countValue}</b></div>`).join("") || "<p class=\"muted\">No activity recorded.</p>";
  const models = Object.entries(report.reviews.models).map(([model, countValue]) => `<tr><td>${escapeHtml(model)}</td><td>${countValue}</td></tr>`).join("") || "<tr><td colspan=\"2\">No models recorded.</td></tr>";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MergeProof review dashboard</title><style>
:root{color-scheme:dark;--bg:#101418;--panel:#181e24;--line:#2d3740;--text:#edf2f4;--muted:#9caab3;--accent:#71d6b2;--warn:#e6b86a}*{box-sizing:border-box}body{margin:0;background:linear-gradient(135deg,#101418,#17232a);color:var(--text);font:15px/1.5 ui-sans-serif,system-ui,sans-serif}main{max-width:1120px;margin:0 auto;padding:42px 22px 64px}header{display:flex;justify-content:space-between;gap:20px;align-items:end;border-bottom:1px solid var(--line);padding-bottom:24px;margin-bottom:26px}h1{font-size:32px;letter-spacing:-.04em;margin:0}h2{font-size:18px;margin:30px 0 12px}p{color:var(--muted)}.meta{color:var(--muted);text-align:right}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.card,.panel{background:rgba(24,30,36,.9);border:1px solid var(--line);border-radius:14px;padding:17px}.card{display:flex;flex-direction:column;gap:7px}.card span,.card small{color:var(--muted)}.card strong{font-size:28px;color:var(--accent)}.columns{display:grid;grid-template-columns:1fr 1fr;gap:16px}.bar-row,.activity{display:grid;grid-template-columns:150px 1fr 44px;align-items:center;gap:10px;margin:11px 0}.bar{height:8px;background:#263039;border-radius:99px;overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),#b9f1d9);border-radius:99px}.activity .bar i{background:linear-gradient(90deg,var(--warn),#f4d69d)}table{width:100%;border-collapse:collapse}td{padding:10px 0;border-bottom:1px solid var(--line)}td:last-child{text-align:right}.muted{color:var(--muted)}@media(max-width:760px){header{display:block}.meta{text-align:left;margin-top:10px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.columns{grid-template-columns:1fr}.bar-row,.activity{grid-template-columns:110px 1fr 30px}}
</style></head><body><main><header><div><p class="muted">LOCAL, OFFLINE, ATTESTATION-AWARE</p><h1>MergeProof review dashboard</h1></div><div class="meta">${escapeHtml(report.repository || "All repositories")}<br>${escapeHtml(report.generatedAt)}${report.periodDays ? `<br>Last ${report.periodDays} days` : ""}</div></header><section class="grid">${reportCard("Reviews", String(report.reviews.total), `${report.reviews.targets} distinct target(s)`)}${reportCard("Attested", String(report.reviews.attested), report.reviews.total ? `${Math.round((report.reviews.attested / report.reviews.total) * 100)}% of reviews` : "No reviews")}${reportCard("Ready calibration", calibration, report.outcomes.readyCalibration ? `${report.outcomes.readyCalibration.merged}/${report.outcomes.readyCalibration.total} merged` : "Need judged outcomes")}${reportCard("Outcomes", String(report.outcomes.total), "Recorded lifecycle results")}</section><section class="columns"><div><h2>Decision distribution</h2><div class="panel">${decisionRows}</div></div><div><h2>Review activity</h2><div class="panel">${activityRows}</div></section><section class="columns"><div><h2>Models</h2><div class="panel"><table><thead><tr><th align="left">Model</th><th align="right">Reviews</th></tr></thead><tbody>${models}</tbody></table></div></div><div><h2>Outcome labels</h2><div class="panel">${Object.entries(report.outcomes.labels).map(([label, countValue]) => `<div class="bar-row"><span>${escapeHtml(label)}</span><div class="bar"><i style="width:${report.outcomes.total ? Math.round((countValue / report.outcomes.total) * 100) : 0}%"></i></div><b>${countValue}</b></div>`).join("") || "<p class=\"muted\">No outcomes recorded.</p>"}</div></div></section><p class="muted">Generated locally by MergeProof. This report contains metadata only and does not call a hosted dashboard.</p></main></body></html>`;
}
