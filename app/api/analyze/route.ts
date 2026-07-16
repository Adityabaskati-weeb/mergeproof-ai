import { NextResponse } from "next/server";
import { z } from "zod";
import { extractAcceptanceCriteria } from "@/lib/criteria";
import { fetchPullRequest, parsePullRequestUrl } from "@/lib/github";
import { createModelProvider } from "@/lib/models";
import { validateAnalysis } from "@/lib/validator";

const requestSchema = z.object({ prUrl: z.string().url() });

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const input = requestSchema.parse(await request.json());
    const ref = parsePullRequestUrl(input.prUrl);
    const context = await fetchPullRequest(ref);
    const { criteria } = extractAcceptanceCriteria(context.body);
    if (!criteria.length) return NextResponse.json({ error: "This pull request has no Acceptance Criteria, Requirements, or What changed section.", code: "MISSING_CRITERIA", decision: "needs-owner" }, { status: 422 });
    if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OPENAI_API_KEY is not configured.", code: "MODEL_NOT_CONFIGURED" }, { status: 503 });
    const provider = createModelProvider();
    const result = await provider.analyze(context, criteria, AbortSignal.timeout(45_000));
    return NextResponse.json({ analysis: validateAnalysis(result, context, criteria, provider.name, Date.now() - started) });
  } catch (error) {
    const message = error instanceof z.ZodError ? "Enter a valid GitHub pull request URL." : error instanceof Error ? error.message : "Analysis failed.";
    const status = message.includes("Expected a GitHub") || message.includes("Invalid") ? 400 : 502;
    return NextResponse.json({ error: message, code: "ANALYSIS_FAILED" }, { status });
  }
}
