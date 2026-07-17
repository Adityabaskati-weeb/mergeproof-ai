import { createHash } from "node:crypto";
import type { Analysis } from "./types";

export type AnalysisAttestation = { algorithm: "sha256"; digest: string };

export function attestAnalysis(analysis: Analysis): AnalysisAttestation {
  const payload = JSON.stringify({
    decision: analysis.decision,
    contract: analysis.contract,
    rows: analysis.rows,
    walkthrough: analysis.walkthrough ?? null,
    securityFindings: analysis.securityFindings ?? [],
    qualitySignals: analysis.qualitySignals ?? [],
    suggestedReviewers: analysis.suggestedReviewers ?? [],
    headSha: analysis.trace.headSha ?? "unknown",
    scope: analysis.trace.scope ?? "pull-request",
    workingTreeDigest: analysis.trace.workingTreeDigest ?? null,
    externalSecurity: analysis.trace.externalSecurity ?? null,
    mcp: analysis.trace.mcp ?? null,
    webSearch: analysis.trace.webSearch ?? null,
    knowledge: analysis.trace.knowledge ?? null,
    reviewEffort: analysis.trace.reviewEffort ?? null,
    reviewProfile: analysis.trace.reviewProfile ?? null,
    agent: analysis.trace.agent ?? null,
    reviewPaths: analysis.trace.reviewPaths ?? null,
    retrieval: analysis.trace.retrieval ?? null,
    relatedRepositories: analysis.trace.relatedRepositories ?? null,
  });
  return { algorithm: "sha256", digest: createHash("sha256").update(payload).digest("hex") };
}
