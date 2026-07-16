import { extractAcceptanceCriteria } from "./criteria";
import { fetchPullRequest, parsePullRequestUrl } from "./github";
import { fetchLinkedIssues } from "./issues";
import { createModelProvider } from "./models";
import { loadPolicy } from "./policy";
import { retrieveRepositoryEvidence } from "./retrieval";
import { validateAnalysis } from "./validator";
import type { Analysis } from "./types";

export type AnalyzeOptions = { provider?: string; repoPath?: string; retrievalTopK?: number };

export async function analyzePullRequest(prUrl: string, model?: string, options: AnalyzeOptions = {}): Promise<Analysis> {
  const started = Date.now();
  const ref = parsePullRequestUrl(prUrl);
  const policy = await loadPolicy(options.repoPath || process.cwd());
  const fetchedContext = await fetchPullRequest(ref);
  const issues = await fetchLinkedIssues(fetchedContext.body);
  const retrieval = options.repoPath ? await retrieveRepositoryEvidence(options.repoPath, ref, fetchedContext.headSha, `${fetchedContext.title} ${fetchedContext.body}`, options.retrievalTopK ?? policy.retrievalTopK ?? 8) : { chunks: [], indexedChunks: 0 };
  const context = { ...fetchedContext, issues, repositoryEvidence: retrieval.chunks, customInstructions: policy.instructions };
  issues.forEach((issue) => context.sources.add(issue.url));
  retrieval.chunks.forEach((chunk) => context.sources.add(chunk.url));
  const bodyCriteria = extractAcceptanceCriteria(context.body).criteria;
  const issueCriteria = issues.flatMap((issue) => issue.acceptanceCriteria);
  const criteria = [...bodyCriteria, ...issueCriteria].filter((criterion, index, values) => values.findIndex((candidate) => candidate.toLowerCase() === criterion.toLowerCase()) === index);
  const provider = (options.provider || policy.provider || process.env.MERGEPROOF_PROVIDER || "openai").toLowerCase();
  const selectedModel = model || policy.model || (provider === "anthropic" ? process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514" : process.env.OPENAI_MODEL || "gpt-5.6");
  const retrievalTrace = { enabled: Boolean(options.repoPath), indexedChunks: retrieval.indexedChunks, selectedChunks: retrieval.chunks.length, ...(retrieval.indexCommitSha ? { indexCommitSha: retrieval.indexCommitSha } : {}) };
  if (!criteria.length) {
    return {
      decision: "needs-owner",
      contract: { promise: context.title, code: "Not specified", tests: "Not specified", release: "Not specified" },
      rows: [],
      trace: { fetchedSources: context.sources.size, citedSources: 0, unsupportedClaims: 0, model: `${provider}:${selectedModel}`, elapsedMs: Date.now() - started, headSha: context.headSha, retrieval: retrievalTrace, linkedIssues: issues.length },
    };
  }
  const modelProvider = createModelProvider(selectedModel, provider as Parameters<typeof createModelProvider>[1]);
  const result = await modelProvider.analyze(context, criteria, AbortSignal.timeout(45_000));
  return validateAnalysis(result, context, criteria, modelProvider.name, Date.now() - started, retrievalTrace, policy.minCitationsPerCriterion ?? 0);
}
