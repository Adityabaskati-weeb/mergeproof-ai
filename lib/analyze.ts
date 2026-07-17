import { extractAcceptanceCriteria } from "./criteria";
import { fetchChangeRequest, parseChangeRequestUrl } from "./change-request";
import { fetchLinkedIssues } from "./issues";
import { createModelProvider } from "./models";
import { loadPolicy } from "./policy";
import { retrieveRepositoryEvidence } from "./retrieval";
import { retrieveLocalEvidence } from "./retrieval";
import { readReviewMemory, recordReviewMemory } from "./memory";
import { scanPullRequestSecurity } from "./security";
import { scanPullRequestPrivacy } from "./privacy";
import { scanSlopSignals } from "./slop";
import { scanExternalSecurity } from "./external-security";
import { validateAnalysis } from "./validator";
import { attestAnalysis } from "./attestation";
import { fetchMcpContext } from "./mcp";
import { searchWebContext } from "./web-context";
import { readKnowledge } from "./knowledge";
import { normalizeReviewEffort, retrievalTopKForEffort } from "./effort";
import { normalizeReviewProfile } from "./profile";
import { combineInstructions, loadAgentProfile } from "./agents";
import { runHooks, type HookReport } from "./hooks";
import { suggestReviewers } from "./reviewers";
import { recordAuditEvent } from "./audit";
import { buildWalkthrough } from "./walkthrough";
import type { Analysis } from "./types";

export type AnalyzeOptions = { provider?: string; repoPath?: string; relatedRepos?: string[]; retrievalTopK?: number; effort?: string; profile?: string; agent?: string; remember?: boolean; memoryRoot?: string; memoryLimit?: number; knowledgeLimit?: number; externalSecurity?: boolean; codeqlDatabase?: string; codeqlCreate?: boolean; codeqlLanguages?: string; codeqlQuery?: string; mcp?: boolean; webSearch?: boolean; hooks?: boolean };

export async function analyzePullRequest(prUrl: string, model?: string, options: AnalyzeOptions = {}): Promise<Analysis> {
  const started = Date.now();
  const target = parseChangeRequestUrl(prUrl);
  const ref = target.ref;
  const policyRoot = options.repoPath || process.cwd();
  const hooksBefore = await runHooks(policyRoot, "beforeReview", options.hooks);
  const policy = await loadPolicy(policyRoot);
  const agentProfile = await loadAgentProfile(policyRoot, options.agent);
  const effort = normalizeReviewEffort(options.effort || policy.effort || process.env.MERGEPROOF_REVIEW_EFFORT);
  const profile = normalizeReviewProfile(options.profile || policy.profile || process.env.MERGEPROOF_REVIEW_PROFILE);
  const fetchedContext = await fetchChangeRequest(target);
  const issues = await fetchLinkedIssues(fetchedContext.body);
  const retrieval = options.repoPath && target.provider === "github" ? await retrieveRepositoryEvidence(options.repoPath, ref, fetchedContext.headSha, `${fetchedContext.title} ${fetchedContext.body}`, options.retrievalTopK ?? policy.retrievalTopK ?? retrievalTopKForEffort(effort)) : { chunks: [], indexedChunks: 0 };
  const relatedResults = await Promise.all([...new Set((options.relatedRepos ?? []).map((path) => path.trim()).filter(Boolean))].map((path) => retrieveLocalEvidence(path, `related:${path}`, `${fetchedContext.title} ${fetchedContext.body}`, options.retrievalTopK ?? policy.retrievalTopK ?? retrievalTopKForEffort(effort))));
  const relatedEvidence = relatedResults.flatMap((result) => result.chunks.map((chunk) => ({ ...chunk, commitSha: result.indexCommitSha ?? chunk.commitSha })));
  const sourceCommits = new Set(relatedResults.map((result) => result.indexCommitSha).filter((sha): sha is string => Boolean(sha)));
  const memoryRoot = options.memoryRoot || options.repoPath || (options.remember ? process.cwd() : undefined);
  const reviewMemory = memoryRoot ? await readReviewMemory(memoryRoot, ref, `${fetchedContext.title} ${fetchedContext.body}`, options.memoryLimit ?? 5) : [];
  const knowledgeRoot = options.repoPath || options.memoryRoot || process.cwd();
  const knowledge = await readKnowledge(knowledgeRoot, ref, fetchedContext.files.map((file) => file.path), `${fetchedContext.title} ${fetchedContext.body}`, options.knowledgeLimit ?? 12);
  const baseSecurityFindings = scanPullRequestSecurity(fetchedContext);
  const privacyFindings = scanPullRequestPrivacy(fetchedContext);
  const qualitySignals = scanSlopSignals(fetchedContext);
  const suggestedReviewers = await suggestReviewers(options.repoPath, fetchedContext.files.map((file) => file.path));
  const externalSecurity = options.repoPath && (options.externalSecurity || options.codeqlDatabase) ? await scanExternalSecurity({ repoPath: options.repoPath, commitSha: fetchedContext.headSha, npmAudit: options.externalSecurity, semgrep: options.externalSecurity, codeqlDatabase: options.codeqlDatabase, codeqlCreate: options.codeqlCreate, codeqlLanguages: options.codeqlLanguages, codeqlQuery: options.codeqlQuery }) : { findings: [], tools: [], unavailable: [] };
  const securityFindings = [...baseSecurityFindings, ...privacyFindings, ...externalSecurity.findings];
  const context = { ...fetchedContext, issues, repositoryEvidence: [...retrieval.chunks, ...relatedEvidence], sourceCommits, customInstructions: combineInstructions(policy.instructions, agentProfile), reviewMemory, knowledge, reviewEffort: effort, reviewProfile: profile, securityFindings, qualitySignals, suggestedReviewers };
  issues.forEach((issue) => context.sources.add(issue.url));
  retrieval.chunks.forEach((chunk) => context.sources.add(chunk.url));
  relatedEvidence.forEach((chunk) => context.sources.add(chunk.url));
  const bodyCriteria = extractAcceptanceCriteria(context.body).criteria;
  const issueCriteria = issues.flatMap((issue) => issue.acceptanceCriteria);
  const criteria = [...bodyCriteria, ...issueCriteria].filter((criterion, index, values) => values.findIndex((candidate) => candidate.toLowerCase() === criterion.toLowerCase()) === index);
  const mcp = await fetchMcpContext(options.repoPath || process.cwd(), context, criteria, options.mcp);
  context.discussion = [...(context.discussion ?? []), ...mcp.discussion];
  mcp.sources.forEach((source) => context.sources.add(source));
  const webSearch = await searchWebContext(context, criteria, options.webSearch);
  context.discussion = [...(context.discussion ?? []), ...webSearch.discussion];
  webSearch.sources.forEach((source) => context.sources.add(source));
  const provider = (options.provider || policy.provider || process.env.MERGEPROOF_PROVIDER || "openai").toLowerCase();
  const selectedModel = model || policy.model || (provider === "anthropic" ? process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514" : process.env.OPENAI_MODEL || "gpt-5.6");
  const retrievalTrace = { enabled: Boolean(options.repoPath || relatedResults.length), indexedChunks: retrieval.indexedChunks + relatedResults.reduce((total, result) => total + result.indexedChunks, 0), selectedChunks: retrieval.chunks.length + relatedEvidence.length, relatedRepositories: relatedResults.length, ...(retrieval.indexCommitSha ? { indexCommitSha: retrieval.indexCommitSha } : {}) };
  const memoryTrace = { enabled: Boolean(memoryRoot), matchedEntries: reviewMemory.length, stored: false };
  const persist = async (analysis: Analysis): Promise<Analysis> => {
    const attestation = attestAnalysis(analysis);
    const withAttestation = { ...analysis, trace: { ...analysis.trace, scope: analysis.trace.scope ?? "pull-request", memory: memoryTrace, attestation } };
    const auditRoot = options.repoPath || options.memoryRoot;
    if (auditRoot) {
      try {
        await recordAuditEvent(auditRoot, { action: "analyze", target: prUrl, decision: withAttestation.decision, model: withAttestation.trace.model, headSha: withAttestation.trace.headSha, attestation: withAttestation.trace.attestation?.digest });
      } catch {
        // Audit persistence must not turn a completed review into a runtime failure.
      }
    }
    if (!options.remember || !memoryRoot) return withAttestation;
    await recordReviewMemory(memoryRoot, ref, prUrl, fetchedContext.title, criteria, withAttestation);
    return { ...withAttestation, trace: { ...withAttestation.trace, memory: { ...memoryTrace, stored: true } } };
  };
  if (!criteria.length) {
    return persist({
      decision: securityFindings.some((finding) => finding.severity !== "low") ? "needs-evidence" : "needs-owner",
      contract: { promise: context.title, code: "Not specified", tests: "Not specified", release: "Not specified" },
      rows: [],
      walkthrough: buildWalkthrough(context),
      suggestedReviewers,
      securityFindings,
      trace: { fetchedSources: context.sources.size, citedSources: 0, unsupportedClaims: 0, model: `${provider}:${selectedModel}`, elapsedMs: Date.now() - started, headSha: context.headSha, retrieval: retrievalTrace, relatedRepositories: relatedResults.length, linkedIssues: issues.length, securityFindings: securityFindings.length, suggestedReviewers: suggestedReviewers.length, externalSecurity: { tools: externalSecurity.tools, unavailable: externalSecurity.unavailable }, mcp: { successful: mcp.successful, failed: mcp.failed }, webSearch: { provider: webSearch.provider, resultCount: webSearch.resultCount, unavailable: webSearch.unavailable }, knowledge: { enabled: true, matchedFacts: knowledge.length }, reviewEffort: effort, reviewProfile: profile, agent: agentProfile?.name, scope: "pull-request", unresolvedReviewThreads: context.reviewThreads?.filter((thread) => !thread.isResolved && !thread.isOutdated).length ?? 0, ...(context.reviewThreadsUnavailable ? { reviewThreadsUnavailable: context.reviewThreadsUnavailable } : {}), hooks: hooksBefore },
    });
  }
  const modelProvider = createModelProvider(selectedModel, provider as Parameters<typeof createModelProvider>[1]);
  const result = await modelProvider.analyze(context, criteria, AbortSignal.timeout(45_000));
  const analysis = validateAnalysis(result, context, criteria, modelProvider.name, Date.now() - started, retrievalTrace, policy.minCitationsPerCriterion ?? 1, securityFindings, qualitySignals);
  const walkthrough = buildWalkthrough(context, analysis);
  const hooksAfter = await runHooks(policyRoot, "afterReview", options.hooks);
  const hooks: HookReport = { enabled: hooksBefore.enabled || hooksAfter.enabled, before: hooksBefore.before, after: hooksAfter.after, failed: [...hooksBefore.failed, ...hooksAfter.failed] };
  const gatedAnalysis = hooks.failed.length ? { ...analysis, decision: analysis.decision === "ready" ? "needs-evidence" as const : analysis.decision } : analysis;
  return persist({ ...gatedAnalysis, walkthrough, suggestedReviewers, trace: { ...gatedAnalysis.trace, externalSecurity: { tools: externalSecurity.tools, unavailable: externalSecurity.unavailable }, mcp: { successful: mcp.successful, failed: mcp.failed }, webSearch: { provider: webSearch.provider, resultCount: webSearch.resultCount, unavailable: webSearch.unavailable }, knowledge: { enabled: true, matchedFacts: knowledge.length }, reviewEffort: effort, reviewProfile: profile, suggestedReviewers: suggestedReviewers.length, agent: agentProfile?.name, relatedRepositories: relatedResults.length, unresolvedReviewThreads: context.reviewThreads?.filter((thread) => !thread.isResolved && !thread.isOutdated).length ?? 0, ...(context.reviewThreadsUnavailable ? { reviewThreadsUnavailable: context.reviewThreadsUnavailable } : {}), hooks } });
}
