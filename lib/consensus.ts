import { analyzePullRequest, type AnalyzeOptions } from "./analyze";
import type { Analysis, EvidenceState } from "./types";
import { recordAuditEvent } from "./audit";

export type ConsensusRow = Analysis["rows"][number] & { agreement: number };
export type ConsensusResult = {
  decision: Analysis["decision"];
  contract: Analysis["contract"];
  rows: ConsensusRow[];
  suggestedReviewers?: string[];
  disagreements: Array<{ criterion: string; states: EvidenceState[] }>;
  analyses: Array<{ model: string; decision: Analysis["decision"]; unsupportedClaims: number; citedSources: number }>;
  trace: { agents: number; unanimous: boolean; agreement: number; elapsedMs: number; fetchedSources: number; citedSources: number };
};

function majority(values: EvidenceState[]): { value: EvidenceState; votes: number } {
  const counts = new Map<EvidenceState, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0] ? { value: [...counts.entries()].sort((left, right) => right[1] - left[1])[0][0], votes: [...counts.entries()].sort((left, right) => right[1] - left[1])[0][1] } : { value: "warn", votes: 0 };
}

export function summarizeConsensus(analyses: Analysis[], elapsedMs = 0): ConsensusResult {
  if (!analyses.length) throw new Error("Consensus requires at least one analysis.");
  const criteria = analyses[0].rows.map((row) => row.criterion);
  const rows = criteria.map((criterion) => {
    const candidates = analyses.map((analysis) => analysis.rows.find((row) => row.criterion.toLowerCase() === criterion.toLowerCase())).filter((row): row is Analysis["rows"][number] => Boolean(row));
    const vote = majority(candidates.map((row) => row.state));
    const citations = candidates.filter((row) => row.state === vote.value).flatMap((row) => row.citations).filter((citation, index, values) => values.findIndex((candidate) => candidate.path === citation.path && candidate.commitSha === citation.commitSha && candidate.url === citation.url) === index);
    return { ...(candidates.find((row) => row.state === vote.value) ?? { criterion, evidence: "No consensus evidence was returned.", state: vote.value, citations: [] }), citations, agreement: candidates.length ? vote.votes / candidates.length : 0 };
  });
  const disagreements = criteria.flatMap((criterion) => {
    const states = analyses.map((analysis) => analysis.rows.find((row) => row.criterion.toLowerCase() === criterion.toLowerCase())?.state ?? "fail");
    return new Set(states).size > 1 ? [{ criterion, states }] : [];
  });
  const unanimous = analyses.every((analysis) => analysis.decision === "ready") && disagreements.length === 0;
  const decision = unanimous ? "ready" : analyses.some((analysis) => analysis.decision === "needs-owner") ? "needs-owner" : "needs-evidence";
  const agreement = rows.length ? rows.reduce((sum, row) => sum + row.agreement, 0) / rows.length : analyses.every((analysis) => analysis.decision === analyses[0].decision) ? 1 : 0;
  return { decision, contract: analyses[0].contract, rows, suggestedReviewers: [...new Set(analyses.flatMap((analysis) => analysis.suggestedReviewers ?? []))], disagreements, analyses: analyses.map((analysis) => ({ model: analysis.trace.model, decision: analysis.decision, unsupportedClaims: analysis.trace.unsupportedClaims, citedSources: analysis.trace.citedSources })), trace: { agents: analyses.length, unanimous, agreement, elapsedMs, fetchedSources: analyses.reduce((sum, analysis) => sum + analysis.trace.fetchedSources, 0), citedSources: analyses.reduce((sum, analysis) => sum + analysis.trace.citedSources, 0) } };
}

export async function runConsensus(prUrl: string, options: AnalyzeOptions & { models?: string[]; providers?: string[] } = {}): Promise<ConsensusResult> {
  const started = Date.now();
  const models = (options.models?.length ? options.models : (process.env.MERGEPROOF_CONSENSUS_MODELS || process.env.OPENAI_MODEL || "gpt-5.6").split(",")).map((model) => model.trim()).filter(Boolean).slice(0, 5);
  if (models.length < 2) throw new Error("Consensus requires at least two model runs. Pass --model model-a model-b or set MERGEPROOF_CONSENSUS_MODELS.");
  const providers = options.providers?.length ? options.providers : (process.env.MERGEPROOF_CONSENSUS_PROVIDERS || process.env.MERGEPROOF_PROVIDER || "openai").split(",");
  const analyses = await Promise.all(models.map((model, index) => analyzePullRequest(prUrl, model, { ...options, provider: providers[index] || providers[0], remember: false })));
  const result = summarizeConsensus(analyses, Date.now() - started);
  if (options.repoPath) {
    try {
      await recordAuditEvent(options.repoPath, { action: "consensus", target: prUrl, decision: result.decision, model: result.analyses.map((analysis) => analysis.model).join(","), headSha: analyses[0].trace.headSha, attestation: analyses[0].trace.attestation?.digest });
    } catch {
      // Audit persistence is best effort and never changes the consensus decision.
    }
  }
  return result;
}
