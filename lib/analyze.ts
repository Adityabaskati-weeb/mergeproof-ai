import { extractAcceptanceCriteria } from "./criteria";
import { fetchPullRequest, parsePullRequestUrl } from "./github";
import { createModelProvider } from "./models";
import { validateAnalysis } from "./validator";
import type { Analysis } from "./types";

export async function analyzePullRequest(prUrl: string, model?: string): Promise<Analysis> {
  const started = Date.now();
  const ref = parsePullRequestUrl(prUrl);
  const context = await fetchPullRequest(ref);
  const { criteria } = extractAcceptanceCriteria(context.body);
  const selectedModel = model || process.env.OPENAI_MODEL || "gpt-5.6";
  if (!criteria.length) {
    return {
      decision: "needs-owner",
      contract: { promise: context.title, code: "Not specified", tests: "Not specified", release: "Not specified" },
      rows: [],
      trace: { fetchedSources: context.sources.size, citedSources: 0, unsupportedClaims: 0, model: selectedModel, elapsedMs: Date.now() - started },
    };
  }
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  const provider = createModelProvider(model);
  const result = await provider.analyze(context, criteria, AbortSignal.timeout(45_000));
  return validateAnalysis(result, context, criteria, provider.name, Date.now() - started);
}
