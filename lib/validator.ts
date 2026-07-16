import type { PullRequestContext } from "./github";
import type { ModelAnalysis } from "./models";
import type { Analysis } from "./types";

function canonicalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value;
  }
}

export function validateAnalysis(result: ModelAnalysis, context: PullRequestContext, criteria: string[], model: string, elapsedMs: number, retrieval?: Analysis["trace"]["retrieval"], minCitationsPerCriterion = 0): Analysis {
  const validRows = result.rows.filter((row) => criteria.some((criterion) => criterion.toLowerCase() === row.criterion.toLowerCase()));
  const unsupportedClaims = result.rows.length - validRows.length;
  const fetchedSources = new Set([...context.sources].map(canonicalizeUrl));
  const rows = criteria.map((criterion) => {
    const row = validRows.find((candidate) => candidate.criterion.toLowerCase() === criterion.toLowerCase());
    if (!row) return { criterion, evidence: "No model-supported evidence was returned.", state: "fail" as const, citations: [] };
    const citations = row.citations.filter((citation) => citation.commitSha === context.headSha && fetchedSources.has(canonicalizeUrl(citation.url)));
    return { ...row, citations, state: citations.length === row.citations.length ? row.state : "warn" as const };
  });
  const citedSources = rows.reduce((count, row) => count + row.citations.length, 0);
  const decision = unsupportedClaims || rows.some((row) => row.state === "fail" || row.citations.length < minCitationsPerCriterion) ? "needs-evidence" : rows.some((row) => row.state === "warn") ? "needs-evidence" : "ready";
  return { decision, contract: result.contract, rows, trace: { fetchedSources: context.sources.size, citedSources, unsupportedClaims, model, elapsedMs, headSha: context.headSha, retrieval, linkedIssues: context.issues?.length ?? 0 } };
}
