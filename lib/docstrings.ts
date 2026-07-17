import { extractAcceptanceCriteria } from "./criteria";
import { fetchChangeRequest, parseChangeRequestUrl } from "./change-request";
import { createModelProvider } from "./models";
import { loadPolicy } from "./policy";
import { retrieveRepositoryEvidence } from "./retrieval";
import { extractPatchPaths } from "./fix";
import { combineInstructions, loadAgentProfile } from "./agents";
import { fetchLinkedIssues } from "./issues";

export type DocstringSuggestion = { summary: string; patch: string; trace: { model: string; headSha: string; changedPaths: string[] } };

export function isDocumentationSafePath(path: string, changedFiles: Set<string>): boolean {
  return changedFiles.has(path) && !/(?:^|\/)(?:test|tests|__tests__|spec)(?:\/|\.)/i.test(path) && !/\.(?:test|spec)\.[^/]+$/i.test(path) && !/(?:package-lock|pnpm-lock|yarn\.lock)$/.test(path);
}

export async function generateDocstringsPullRequest(prUrl: string, model?: string, options: { provider?: string; repoPath?: string; agent?: string } = {}): Promise<DocstringSuggestion> {
  const target = parseChangeRequestUrl(prUrl);
  const policy = await loadPolicy(options.repoPath || process.cwd());
  const agentProfile = await loadAgentProfile(options.repoPath || process.cwd(), options.agent);
  const context = await fetchChangeRequest(target);
  const issues = await fetchLinkedIssues(context.body);
  const criteria = [...extractAcceptanceCriteria(context.body).criteria, ...issues.flatMap((issue) => issue.acceptanceCriteria)];
  const safeCriteria = criteria.length ? [...new Set(criteria)] : ["Changed public code has accurate documentation without behavior changes."];
  const retrieval = options.repoPath && target.provider === "github" ? await retrieveRepositoryEvidence(options.repoPath, target.ref, context.headSha, `${context.title} ${context.body}`, policy.retrievalTopK ?? 8) : { chunks: [], indexedChunks: 0 };
  const providerName = (options.provider || policy.provider || process.env.MERGEPROOF_PROVIDER || "openai").toLowerCase();
  const selectedModel = model || policy.model || (providerName === "anthropic" ? process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514" : process.env.OPENAI_MODEL || "gpt-5.6");
  const provider = createModelProvider(selectedModel, providerName as Parameters<typeof createModelProvider>[1]);
  const result = await provider.docs({ ...context, issues, repositoryEvidence: retrieval.chunks, customInstructions: combineInstructions(policy.instructions, agentProfile) }, safeCriteria, AbortSignal.timeout(45_000));
  const patch = result.patch.replace(/^```(?:diff|patch)?\s*/i, "").replace(/\s*```$/, "").trim();
  const changedPaths = patch ? extractPatchPaths(patch) : [];
  const changedFiles = new Set(context.files.map((file) => file.path));
  if (changedPaths.some((path) => !isDocumentationSafePath(path, changedFiles))) throw new Error("The proposed documentation patch changes a file outside the fetched pull request, tests, or dependency lockfiles.");
  return { summary: result.summary, patch, trace: { model: provider.name, headSha: context.headSha, changedPaths } };
}
