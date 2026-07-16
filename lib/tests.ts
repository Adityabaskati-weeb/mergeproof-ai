import { extractAcceptanceCriteria } from "./criteria";
import { fetchChangeRequest, parseChangeRequestUrl } from "./change-request";
import { fetchLinkedIssues } from "./issues";
import { createModelProvider } from "./models";
import { loadPolicy } from "./policy";
import { retrieveRepositoryEvidence } from "./retrieval";
import { scanPullRequestSecurity } from "./security";
import { extractPatchPaths } from "./fix";

export type TestSuggestion = { summary: string; patch: string; trace: { model: string; headSha: string; changedPaths: string[] } };

export function isTestPath(path: string): boolean {
  return /(^|\/)(__tests__|test|tests)(\/|$)|\.(?:test|spec)\.[^/]+$|(?:^|\/)[^/]+_test\.[^/]+$/i.test(path.replace(/\\/g, "/"));
}

export async function generateTestsPullRequest(prUrl: string, model?: string, options: { provider?: string; repoPath?: string } = {}): Promise<TestSuggestion> {
  const target = parseChangeRequestUrl(prUrl);
  const ref = target.ref;
  const policy = await loadPolicy(options.repoPath || process.cwd());
  const context = await fetchChangeRequest(target);
  const issues = await fetchLinkedIssues(context.body);
  const criteria = [...extractAcceptanceCriteria(context.body).criteria, ...issues.flatMap((issue) => issue.acceptanceCriteria)].filter((criterion, index, values) => values.findIndex((candidate) => candidate.toLowerCase() === criterion.toLowerCase()) === index);
  if (!criteria.length) throw new Error("Cannot generate tests because no acceptance criteria were found.");
  const retrieval = options.repoPath && target.provider === "github" ? await retrieveRepositoryEvidence(options.repoPath, ref, context.headSha, `${context.title} ${context.body}`, policy.retrievalTopK ?? 8) : { chunks: [], indexedChunks: 0 };
  const providerName = (options.provider || policy.provider || process.env.MERGEPROOF_PROVIDER || "openai").toLowerCase();
  const selectedModel = model || policy.model || (providerName === "anthropic" ? process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514" : process.env.OPENAI_MODEL || "gpt-5.6");
  const provider = createModelProvider(selectedModel, providerName as Parameters<typeof createModelProvider>[1]);
  const result = await provider.tests({ ...context, issues, repositoryEvidence: retrieval.chunks, securityFindings: scanPullRequestSecurity(context), customInstructions: policy.instructions }, criteria, AbortSignal.timeout(45_000));
  const patch = result.patch.replace(/^```(?:diff|patch)?\s*/i, "").replace(/\s*```$/, "").trim();
  const changedPaths = extractPatchPaths(patch);
  if (changedPaths.some((path) => !isTestPath(path))) throw new Error("The proposed test patch changes a non-test file.");
  return { summary: result.summary, patch, trace: { model: provider.name, headSha: context.headSha, changedPaths } };
}
