import type { Analysis } from "./types";

export type EvaluationReport = {
  decision: Analysis["decision"];
  criteria: number;
  criteriaWithEvidence: number;
  citationCount: number;
  citationCoverage: number;
  unsupportedClaims: number;
  abstained: boolean;
  retrievalChunks: number;
  securityFindings: number;
  securityBlocking: boolean;
};

export function evaluateAnalysis(analysis: Analysis): EvaluationReport {
  const criteria = analysis.rows.length;
  const criteriaWithEvidence = analysis.rows.filter((row) => row.citations.length > 0).length;
  return {
    decision: analysis.decision,
    criteria,
    criteriaWithEvidence,
    citationCount: analysis.trace.citedSources,
    citationCoverage: criteria === 0 ? 0 : Number((criteriaWithEvidence / criteria).toFixed(4)),
    unsupportedClaims: analysis.trace.unsupportedClaims,
    abstained: analysis.decision !== "ready",
    retrievalChunks: analysis.trace.retrieval?.selectedChunks ?? 0,
    securityFindings: analysis.securityFindings?.length ?? 0,
    securityBlocking: (analysis.securityFindings ?? []).some((finding) => finding.severity === "high" || finding.severity === "medium"),
  };
}
