import { execFileSync } from "node:child_process";
import { extractAcceptanceCriteria } from "./criteria";
import { fetchChangeRequest, parseChangeRequestUrl } from "./change-request";
import { fetchLinkedIssues } from "./issues";
import { createModelProvider, type ModelFix } from "./models";
import { loadPolicy } from "./policy";
import { retrieveRepositoryEvidence } from "./retrieval";
import { combineInstructions, loadAgentProfile } from "./agents";

export type FixOptions = { provider?: string; repoPath?: string; apply?: boolean; agent?: string; threadIds?: string[] };
export type FixSuggestion = ModelFix & { trace: { model: string; headSha: string; changedPaths: string[]; applied: boolean } };

export function extractPatchPaths(patch: string): string[] {
  return [...patch.matchAll(/^(?:---|\+\+\+) (?:[ab]\/)?([^\s]+)$/gm)].map((match) => match[1]).filter((path) => path !== "/dev/null");
}

export function validatePatchPaths(patch: string): string[] {
  const paths = extractPatchPaths(patch);
  if (!paths.length) throw new Error("The model returned no applicable patch paths.");
  if (paths.some((path) => path.startsWith("/") || path.includes("..") || path.includes("\\"))) throw new Error("The proposed patch contains an unsafe path.");
  return paths;
}

function applyPatch(repoPath: string, patch: string): void {
  validatePatchPaths(patch);
  execFileSync("git", ["apply", "--check", "--whitespace=error"], { cwd: repoPath, input: patch, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  execFileSync("git", ["apply", "--whitespace=error"], { cwd: repoPath, input: patch, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

export async function fixPullRequest(prUrl: string, model?: string, options: FixOptions = {}): Promise<FixSuggestion> {
  const target = parseChangeRequestUrl(prUrl);
  const ref = target.ref;
  const policy = await loadPolicy(options.repoPath || process.cwd());
  const agentProfile = await loadAgentProfile(options.repoPath || process.cwd(), options.agent);
  const fetchedContext = await fetchChangeRequest(target);
  const context = options.threadIds?.length && fetchedContext.reviewThreads ? { ...fetchedContext, reviewThreads: fetchedContext.reviewThreads.filter((thread) => options.threadIds!.includes(thread.id)) } : fetchedContext;
  const issues = await fetchLinkedIssues(context.body);
  const criteria = [...extractAcceptanceCriteria(context.body).criteria, ...issues.flatMap((issue) => issue.acceptanceCriteria)].filter((criterion, index, values) => values.findIndex((candidate) => candidate.toLowerCase() === criterion.toLowerCase()) === index);
  if (!criteria.length) throw new Error("Cannot suggest a fix because no acceptance criteria were found.");
  const retrieval = options.repoPath && target.provider === "github" ? await retrieveRepositoryEvidence(options.repoPath, ref, context.headSha, `${context.title} ${context.body}`, policy.retrievalTopK ?? 8) : { chunks: [], indexedChunks: 0 };
  const provider = (options.provider || policy.provider || process.env.MERGEPROOF_PROVIDER || "openai").toLowerCase();
  const selectedModel = model || policy.model || (provider === "anthropic" ? process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514" : process.env.OPENAI_MODEL || "gpt-5.6");
  const modelProvider = createModelProvider(selectedModel, provider as Parameters<typeof createModelProvider>[1]);
  const result = await modelProvider.fix({ ...context, issues, repositoryEvidence: retrieval.chunks, customInstructions: combineInstructions(policy.instructions, agentProfile) }, criteria, AbortSignal.timeout(45_000));
  const patch = result.patch.replace(/^```(?:diff|patch)?\s*/i, "").replace(/\s*```$/, "").trim();
  const changedPaths = patch ? extractPatchPaths(patch) : [];
  let applied = false;
  if (options.apply) {
    if (!options.repoPath) throw new Error("--apply requires --repo so the target checkout is explicit.");
    applyPatch(options.repoPath, patch);
    applied = true;
  }
  return { summary: result.summary, patch, trace: { model: modelProvider.name, headSha: context.headSha, changedPaths, applied } };
}
