import { extractAcceptanceCriteria } from "./criteria";
import { fetchChangeRequest, parseChangeRequestUrl } from "./change-request";
import { fetchLinkedIssues } from "./issues";
import { createModelProvider } from "./models";
import { loadPolicy } from "./policy";
import { retrieveRepositoryEvidence } from "./retrieval";
import { readReviewMemory, recordReviewMemory } from "./memory";
import { scanPullRequestSecurity } from "./security";
import { validateAnalysis } from "./validator";
import { attestAnalysis } from "./attestation";
import type { Analysis } from "./types";

export type AnalyzeOptions = { provider?: string; repoPath?: string; retrievalTopK?: number; remember?: boolean; memoryRoot?: string; memoryLimit?: number };

export async function analyzePullRequest(prUrl: string, model?: string, options: AnalyzeOptions = {}): Promise<Analysis> {
  const started = Date.now();
  const target = parseChangeRequestUrl(prUrl);
  const ref = target.ref;
  const policy = await loadPolicy(options.repoPath || process.cwd());
  const fetchedContext = await fetchChangeRequest(target);
  const issues = await fetchLinkedIssues(fetchedContext.body);
  const retrieval = options.repoPath && target.provider === "github" ? await retrieveRepositoryEvidence(options.repoPath, ref, fetchedContext.headSha, `${fetchedContext.title} ${fetchedContext.body}`, options.retrievalTopK ?? policy.retrievalTopK ?? 8) : { chunks: [], indexedChunks: 0 };
  const memoryRoot = options.memoryRoot || options.repoPath || (options.remember ? process.cwd() : undefined);
  const reviewMemory = memoryRoot ? await readReviewMemory(memoryRoot, ref, `${fetchedContext.title} ${fetchedContext.body}`, options.memoryLimit ?? 5) : [];
  const securityFindings = scanPullRequestSecurity(fetchedContext);
  const context = { ...fetchedContext, issues, repositoryEvidence: retrieval.chunks, customInstructions: policy.instructions, reviewMemory, securityFindings };
  issues.forEach((issue) => context.sources.add(issue.url));
  retrieval.chunks.forEach((chunk) => context.sources.add(chunk.url));
  const bodyCriteria = extractAcceptanceCriteria(context.body).criteria;
  const issueCriteria = issues.flatMap((issue) => issue.acceptanceCriteria);
  const criteria = [...bodyCriteria, ...issueCriteria].filter((criterion, index, values) => values.findIndex((candidate) => candidate.toLowerCase() === criterion.toLowerCase()) === index);
  const provider = (options.provider || policy.provider || process.env.MERGEPROOF_PROVIDER || "openai").toLowerCase();
  const selectedModel = model || policy.model || (provider === "anthropic" ? process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514" : process.env.OPENAI_MODEL || "gpt-5.6");
  const retrievalTrace = { enabled: Boolean(options.repoPath), indexedChunks: retrieval.indexedChunks, selectedChunks: retrieval.chunks.length, ...(retrieval.indexCommitSha ? { indexCommitSha: retrieval.indexCommitSha } : {}) };
  const memoryTrace = { enabled: Boolean(memoryRoot), matchedEntries: reviewMemory.length, stored: false };
  const persist = async (analysis: Analysis): Promise<Analysis> => {
    const attestation = attestAnalysis(analysis);
    const withAttestation = { ...analysis, trace: { ...analysis.trace, scope: analysis.trace.scope ?? "pull-request", memory: memoryTrace, attestation } };
    if (!options.remember || !memoryRoot) return withAttestation;
    await recordReviewMemory(memoryRoot, ref, prUrl, fetchedContext.title, criteria, withAttestation);
    return { ...withAttestation, trace: { ...withAttestation.trace, memory: { ...memoryTrace, stored: true } } };
  };
  if (!criteria.length) {
    return persist({
      decision: securityFindings.some((finding) => finding.severity !== "low") ? "needs-evidence" : "needs-owner",
      contract: { promise: context.title, code: "Not specified", tests: "Not specified", release: "Not specified" },
      rows: [],
      securityFindings,
      trace: { fetchedSources: context.sources.size, citedSources: 0, unsupportedClaims: 0, model: `${provider}:${selectedModel}`, elapsedMs: Date.now() - started, headSha: context.headSha, retrieval: retrievalTrace, linkedIssues: issues.length, securityFindings: securityFindings.length, scope: "pull-request" },
    });
  }
  const modelProvider = createModelProvider(selectedModel, provider as Parameters<typeof createModelProvider>[1]);
  const result = await modelProvider.analyze(context, criteria, AbortSignal.timeout(45_000));
  return persist(validateAnalysis(result, context, criteria, modelProvider.name, Date.now() - started, retrievalTrace, policy.minCitationsPerCriterion ?? 1, securityFindings));
}
