import type { Analysis, SecurityFinding } from "./types";

export type AgentReviewEvent =
  | { type: "review_context"; decision: Analysis["decision"]; model: string; headSha?: string; scope?: string; fetchedSources: number; citedSources: number; unsupportedClaims: number; attestation?: string }
  | { type: "status"; status: "review_started" | "review_completed"; message: string }
  | { type: "finding"; severity: "critical" | "major" | "minor" | "trivial" | "info"; fileName: string; line?: number; criterion: string; comment: string; codegenInstructions: string; suggestions: string[]; citations: Array<{ path: string; commitSha: string; url: string }>; source: "criterion" | "security" | "quality" }
  | { type: "complete"; status: "ready" | "needs-evidence" | "needs-owner"; findings: number; unsupportedClaims: number; attestation?: string; message: string }
  | { type: "error"; message: string };

type AgentSeverity = "critical" | "major" | "minor" | "trivial" | "info";

function severityForState(state: "pass" | "warn" | "fail"): AgentSeverity {
  return state === "fail" ? "major" : state === "warn" ? "minor" : "info";
}

function severityForFinding(finding: SecurityFinding): AgentSeverity {
  if (finding.severity === "high") return "critical";
  if (finding.severity === "medium") return "major";
  return "minor";
}

function criterionEvent(row: Analysis["rows"][number]): AgentReviewEvent | undefined {
  if (row.state === "pass") return undefined;
  const citation = row.citations[0];
  return {
    type: "finding",
    severity: severityForState(row.state),
    fileName: citation?.path ?? "(review contract)",
    criterion: row.criterion,
    comment: row.evidence,
    codegenInstructions: row.state === "fail" ? `Resolve the failing acceptance criterion: ${row.criterion}` : `Collect stronger evidence for: ${row.criterion}`,
    suggestions: citation ? [citation.url] : [],
    citations: row.citations,
    source: "criterion",
  };
}

function securityEvent(finding: SecurityFinding): AgentReviewEvent {
  return {
    type: "finding",
    severity: severityForFinding(finding),
    fileName: finding.path,
    line: finding.line,
    criterion: finding.title,
    comment: finding.detail,
    codegenInstructions: `Review and remediate ${finding.title.toLowerCase()} at ${finding.path}:${finding.line}.`,
    suggestions: [finding.citation.url],
    citations: [finding.citation],
    source: finding.category === "quality" ? "quality" : "security",
  };
}

export function toAgentReviewEvents(analysis: Analysis): AgentReviewEvent[] {
  const events: AgentReviewEvent[] = [
    { type: "status", status: "review_started", message: "MergeProof evidence review started." },
    { type: "review_context", decision: analysis.decision, model: analysis.trace.model, ...(analysis.trace.headSha ? { headSha: analysis.trace.headSha } : {}), ...(analysis.trace.scope ? { scope: analysis.trace.scope } : {}), fetchedSources: analysis.trace.fetchedSources, citedSources: analysis.trace.citedSources, unsupportedClaims: analysis.trace.unsupportedClaims, ...(analysis.trace.attestation?.digest ? { attestation: `${analysis.trace.attestation.algorithm}:${analysis.trace.attestation.digest}` } : {}) },
  ];
  for (const row of analysis.rows) {
    const event = criterionEvent(row);
    if (event) events.push(event);
  }
  for (const finding of [...(analysis.securityFindings ?? []), ...(analysis.qualitySignals ?? [])]) events.push(securityEvent(finding));
  events.push({ type: "status", status: "review_completed", message: `MergeProof review completed with decision ${analysis.decision}.` });
  events.push({ type: "complete", status: analysis.decision, findings: events.filter((event) => event.type === "finding").length, unsupportedClaims: analysis.trace.unsupportedClaims, ...(analysis.trace.attestation?.digest ? { attestation: `${analysis.trace.attestation.algorithm}:${analysis.trace.attestation.digest}` } : {}), message: analysis.decision === "ready" ? "No blocking evidence gaps remain." : "Review requires evidence or owner action before merge." });
  return events;
}

export function renderAgentReviewEvents(analysis: Analysis): string {
  return `${toAgentReviewEvents(analysis).map((event) => JSON.stringify(event)).join("\n")}\n`;
}
