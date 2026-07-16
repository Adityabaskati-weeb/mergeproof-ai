import { extractAcceptanceCriteria } from "./criteria";
import { fetchPullRequest, parsePullRequestUrl } from "./github";
import { createModelProvider } from "./models";
import { validateAnalysis } from "./validator";
import type { Analysis } from "./types";

export async function analyzePullRequest(prUrl: string, model?: string): Promise<Analysis> {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  const started = Date.now();
  const ref = parsePullRequestUrl(prUrl);
  const context = await fetchPullRequest(ref);
  const { criteria } = extractAcceptanceCriteria(context.body);
  if (!criteria.length) throw new Error("This pull request has no Acceptance Criteria, Requirements, or What changed section.");
  const provider = createModelProvider(model);
  const result = await provider.analyze(context, criteria, AbortSignal.timeout(45_000));
  return validateAnalysis(result, context, criteria, provider.name, Date.now() - started);
}
