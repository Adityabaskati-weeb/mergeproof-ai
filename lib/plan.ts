import { extractAcceptanceCriteria } from "./criteria";
import { fetchPullRequest, parsePullRequestUrl } from "./github";
import { fetchLinkedIssues } from "./issues";
import { createModelProvider, type ReviewPlan } from "./models";
import { loadPolicy } from "./policy";

function canonicalize(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value;
  }
}

export async function planPullRequest(prUrl: string, model?: string, providerName?: string): Promise<ReviewPlan> {
  const ref = parsePullRequestUrl(prUrl);
  const context = await fetchPullRequest(ref);
  const issues = await fetchLinkedIssues(context.body);
  const criteria = [...extractAcceptanceCriteria(context.body).criteria, ...issues.flatMap((issue) => issue.acceptanceCriteria)].filter((criterion, index, values) => values.findIndex((candidate) => candidate.toLowerCase() === criterion.toLowerCase()) === index);
  if (!criteria.length) throw new Error("Cannot create a plan because the PR and linked issues contain no acceptance criteria.");
  const policy = await loadPolicy(process.cwd());
  const provider = (providerName || policy.provider || process.env.MERGEPROOF_PROVIDER || "openai").toLowerCase();
  const selectedModel = model || policy.model || (provider === "anthropic" ? process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514" : process.env.OPENAI_MODEL || "gpt-5.6");
  const modelProvider = createModelProvider(selectedModel, provider as Parameters<typeof createModelProvider>[1]);
  const plan = await modelProvider.plan({ ...context, issues, customInstructions: policy.instructions }, criteria, AbortSignal.timeout(45_000));
  const sources = new Set([...context.sources, ...issues.map((issue) => issue.url)].map(canonicalize));
  const citations = [...plan.risks.flatMap((risk) => risk.citations), ...plan.steps.flatMap((step) => step.citations)].filter((citation) => citation.commitSha === context.headSha && sources.has(canonicalize(citation.url)));
  return { ...plan, risks: plan.risks.map((risk) => ({ ...risk, citations: risk.citations.filter((citation) => citation.commitSha === context.headSha && sources.has(canonicalize(citation.url))) })), steps: plan.steps.map((step) => ({ ...step, citations: step.citations.filter((citation) => citation.commitSha === context.headSha && sources.has(canonicalize(citation.url))) })), trace: { model: modelProvider.name, headSha: context.headSha, fetchedSources: context.sources.size, citedSources: citations.length } };
}
