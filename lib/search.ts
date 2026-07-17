import { readAuditEvents } from "./audit";
import { readFindings } from "./findings";
import { readOutcomes } from "./outcomes";
import { listSessions } from "./sessions";

export type SearchHit = { kind: "session" | "finding" | "audit" | "outcome"; id: string; recordedAt: string; title: string; snippet: string; source: string };

function matches(query: string, values: string[]): boolean {
  const normalized = query.trim().toLowerCase();
  return Boolean(normalized) && values.some((value) => value.toLowerCase().includes(normalized));
}

export async function searchWorkspace(root: string, query: string, limit = 50): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  const sessions = await listSessions(root, 100);
  for (const session of sessions) for (const turn of session.turns) if (matches(query, [session.id, session.name ?? "", turn.action, turn.request, turn.summary])) hits.push({ kind: "session", id: `${session.id}:${turn.createdAt}`, recordedAt: turn.createdAt, title: `${session.name ?? session.id} / ${turn.action}`, snippet: turn.summary || turn.request, source: `.mergeproof/sessions/${session.id}.jsonl` });
  for (const finding of await readFindings(root, { limit: 200, includeIgnored: true })) if (matches(query, [finding.id, finding.fileName, finding.criterion, finding.comment, finding.disposition])) hits.push({ kind: "finding", id: finding.id, recordedAt: finding.recordedAt, title: `${finding.severity} ${finding.disposition}: ${finding.criterion}`, snippet: finding.comment, source: ".mergeproof/findings.jsonl" });
  for (const event of await readAuditEvents(root, 200)) if (matches(query, [event.id, event.action, event.target, event.model ?? "", event.decision ?? ""])) hits.push({ kind: "audit", id: event.id, recordedAt: event.recordedAt, title: `${event.action}: ${event.target}`, snippet: `${event.decision ?? "no decision"}${event.model ? ` via ${event.model}` : ""}`, source: ".mergeproof/audit.jsonl" });
  for (const outcome of await readOutcomes(root, undefined, 200)) if (matches(query, [outcome.id, outcome.target, outcome.label, outcome.reason ?? "", outcome.predictedDecision ?? ""])) hits.push({ kind: "outcome", id: outcome.id, recordedAt: outcome.recordedAt, title: `${outcome.label}: ${outcome.target}`, snippet: outcome.reason ?? outcome.predictedDecision ?? "Outcome recorded.", source: ".mergeproof/outcomes.jsonl" });
  return hits.sort((left, right) => right.recordedAt.localeCompare(left.recordedAt)).slice(0, Math.max(1, Math.min(200, limit)));
}

export function renderSearchResults(query: string, hits: SearchHit[]): string {
  return [`Search: ${query}`, `Matches: ${hits.length}`, ...hits.map((hit) => `[${hit.kind}] ${hit.title}\n  ${hit.snippet}\n  ${hit.source}`)].join("\n");
}
