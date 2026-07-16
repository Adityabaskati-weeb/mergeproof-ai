import OpenAI from "openai";
import { z } from "zod";
import type { PullRequestContext } from "./github";

export const modelAnalysisSchema = z.object({
  contract: z.object({ promise: z.string(), code: z.string(), tests: z.string(), release: z.string() }),
  rows: z.array(z.object({ criterion: z.string(), evidence: z.string(), state: z.enum(["pass", "warn", "fail"]), citations: z.array(z.object({ path: z.string(), commitSha: z.string(), url: z.string().url() })) })),
});
export type ModelAnalysis = z.infer<typeof modelAnalysisSchema>;
const modelPlanSchema = z.object({
  summary: z.string(),
  risks: z.array(z.object({ risk: z.string(), severity: z.enum(["low", "medium", "high"]), citations: z.array(z.object({ path: z.string(), commitSha: z.string(), url: z.string().url() })) })),
  steps: z.array(z.object({ title: z.string(), detail: z.string(), citations: z.array(z.object({ path: z.string(), commitSha: z.string(), url: z.string().url() })) })),
});
export type ModelPlan = z.infer<typeof modelPlanSchema>;
export type ReviewPlan = ModelPlan & { trace: { model: string; headSha: string; fetchedSources: number; citedSources: number } };
const modelFixSchema = z.object({ summary: z.string(), patch: z.string() });
export type ModelFix = z.infer<typeof modelFixSchema>;
export type ModelProvider = { name: string; analyze: (context: PullRequestContext, criteria: string[], signal?: AbortSignal) => Promise<ModelAnalysis>; plan: (context: PullRequestContext, criteria: string[], signal?: AbortSignal) => Promise<ModelPlan>; fix: (context: PullRequestContext, criteria: string[], signal?: AbortSignal) => Promise<ModelFix>; tests: (context: PullRequestContext, criteria: string[], signal?: AbortSignal) => Promise<ModelFix> };
export type ModelProviderKind = "openai" | "openai-compatible" | "anthropic";

const responseSchema = { type: "object", additionalProperties: false, properties: {
  contract: { type: "object", additionalProperties: false, properties: { promise: { type: "string" }, code: { type: "string" }, tests: { type: "string" }, release: { type: "string" } }, required: ["promise", "code", "tests", "release"] },
  rows: { type: "array", items: { type: "object", additionalProperties: false, properties: { criterion: { type: "string" }, evidence: { type: "string" }, state: { type: "string", enum: ["pass", "warn", "fail"] }, citations: { type: "array", items: { type: "object", additionalProperties: false, properties: { path: { type: "string" }, commitSha: { type: "string" }, url: { type: "string" } }, required: ["path", "commitSha", "url"] } } }, required: ["criterion", "evidence", "state", "citations"] } },
}, required: ["contract", "rows"] };
const planResponseSchema = { type: "object", additionalProperties: false, properties: {
  summary: { type: "string" },
  risks: { type: "array", items: { type: "object", additionalProperties: false, properties: { risk: { type: "string" }, severity: { type: "string", enum: ["low", "medium", "high"] }, citations: { type: "array", items: { type: "object", additionalProperties: false, properties: { path: { type: "string" }, commitSha: { type: "string" }, url: { type: "string" } }, required: ["path", "commitSha", "url"] } } }, required: ["risk", "severity", "citations"] } },
  steps: { type: "array", items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, detail: { type: "string" }, citations: { type: "array", items: { type: "object", additionalProperties: false, properties: { path: { type: "string" }, commitSha: { type: "string" }, url: { type: "string" } }, required: ["path", "commitSha", "url"] } } }, required: ["title", "detail", "citations"] } },
}, required: ["summary", "risks", "steps"] };
const fixResponseSchema = { type: "object", additionalProperties: false, properties: { summary: { type: "string" }, patch: { type: "string" } }, required: ["summary", "patch"] };

function analysisPrompt(context: PullRequestContext, criteria: string[]): string {
  return JSON.stringify({ title: context.title, criteria, files: context.files, checks: context.checks, commits: context.commits ?? [], discussion: context.discussion ?? [], issues: context.issues ?? [], repositoryEvidence: context.repositoryEvidence ?? [], securityFindings: context.securityFindings ?? [], reviewMemory: context.reviewMemory ?? [], customInstructions: context.customInstructions ?? "", headSha: context.headSha });
}

function planPrompt(context: PullRequestContext, criteria: string[]): string {
  return JSON.stringify({ task: "Create an implementation plan for this pull request and its requirements.", title: context.title, criteria, files: context.files, checks: context.checks, commits: context.commits ?? [], discussion: context.discussion ?? [], issues: context.issues ?? [], repositoryEvidence: context.repositoryEvidence ?? [], securityFindings: context.securityFindings ?? [], reviewMemory: context.reviewMemory ?? [], customInstructions: context.customInstructions ?? "", headSha: context.headSha });
}

function fixPrompt(context: PullRequestContext, criteria: string[]): string {
  return JSON.stringify({ task: "Propose a minimal unified diff that fixes the highest-confidence unmet criterion. Do not modify files outside the supplied change set. If a safe fix cannot be proven, return an empty patch.", title: context.title, criteria, files: context.files, checks: context.checks, commits: context.commits ?? [], discussion: context.discussion ?? [], issues: context.issues ?? [], repositoryEvidence: context.repositoryEvidence ?? [], securityFindings: context.securityFindings ?? [], reviewMemory: context.reviewMemory ?? [], headSha: context.headSha });
}

function testPrompt(context: PullRequestContext, criteria: string[]): string {
  return JSON.stringify({ task: "Propose a minimal unified diff adding focused automated tests for the highest-risk unmet criterion. Modify only existing test files or a new test file adjacent to the changed code. Do not modify production code. If a safe test cannot be proven from the supplied context, return an empty patch.", title: context.title, criteria, files: context.files, checks: context.checks, commits: context.commits ?? [], discussion: context.discussion ?? [], issues: context.issues ?? [], repositoryEvidence: context.repositoryEvidence ?? [], securityFindings: context.securityFindings ?? [], reviewMemory: context.reviewMemory ?? [], headSha: context.headSha });
}

function systemPrompt(): string {
  return "You are MergeProof, an evidence auditor. Use only supplied PR, issue, check, repository evidence, and team instructions. Do not invent citations. Every criterion must have evidence and citations or be marked warn/fail. Return only the requested JSON.";
}

function parseJson(text: string): ModelAnalysis {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] ?? text;
  const object = fenced.match(/\{[\s\S]*\}/)?.[0] ?? fenced;
  return modelAnalysisSchema.parse(JSON.parse(object));
}

async function analyzeWithOpenAI(model: string, context: PullRequestContext, criteria: string[], compatible: boolean, signal?: AbortSignal): Promise<ModelAnalysis> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL || undefined });
  if (compatible) {
    const response = await client.chat.completions.create({ model, messages: [{ role: "system", content: `${systemPrompt()} Return valid JSON without markdown fences.` }, { role: "user", content: analysisPrompt(context, criteria) }], response_format: { type: "json_object" } }, { signal });
    return parseJson(response.choices[0]?.message.content ?? "");
  }
  const response = await client.responses.create({ model, input: [{ role: "system", content: systemPrompt() }, { role: "user", content: analysisPrompt(context, criteria) }], text: { format: { type: "json_schema", name: "mergeproof_analysis", strict: true, schema: responseSchema } } }, { signal });
  return modelAnalysisSchema.parse(JSON.parse(response.output_text));
}

async function analyzeWithAnthropic(model: string, context: PullRequestContext, criteria: string[], signal?: AbortSignal): Promise<ModelAnalysis> {
  const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal, headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model, max_tokens: 6000, system: `${systemPrompt()} Return valid JSON without markdown fences.`, messages: [{ role: "user", content: analysisPrompt(context, criteria) }] }) });
  if (!response.ok) throw new Error(`Anthropic request failed with HTTP ${response.status}.`);
  const payload = await response.json() as { content?: Array<{ type?: string; text?: string }> };
  return parseJson(payload.content?.find((item) => item.type === "text")?.text ?? "");
}

async function planWithOpenAI(model: string, context: PullRequestContext, criteria: string[], compatible: boolean, signal?: AbortSignal): Promise<ModelPlan> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL || undefined });
  if (compatible) {
    const response = await client.chat.completions.create({ model, messages: [{ role: "system", content: `${systemPrompt()} Return a structured implementation plan as JSON without markdown fences.` }, { role: "user", content: planPrompt(context, criteria) }], response_format: { type: "json_object" } }, { signal });
    return modelPlanSchema.parse(JSON.parse(response.choices[0]?.message.content ?? ""));
  }
  const response = await client.responses.create({ model, input: [{ role: "system", content: `${systemPrompt()} Return a structured implementation plan.` }, { role: "user", content: planPrompt(context, criteria) }], text: { format: { type: "json_schema", name: "mergeproof_plan", strict: true, schema: planResponseSchema } } }, { signal });
  return modelPlanSchema.parse(JSON.parse(response.output_text));
}

async function planWithAnthropic(model: string, context: PullRequestContext, criteria: string[], signal?: AbortSignal): Promise<ModelPlan> {
  const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal, headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model, max_tokens: 6000, system: `${systemPrompt()} Return a valid implementation plan JSON without markdown fences.`, messages: [{ role: "user", content: planPrompt(context, criteria) }] }) });
  if (!response.ok) throw new Error(`Anthropic request failed with HTTP ${response.status}.`);
  const payload = await response.json() as { content?: Array<{ type?: string; text?: string }> };
  return modelPlanSchema.parse(JSON.parse(payload.content?.find((item) => item.type === "text")?.text ?? ""));
}

async function fixWithOpenAI(model: string, context: PullRequestContext, criteria: string[], compatible: boolean, signal?: AbortSignal, prompt = fixPrompt): Promise<ModelFix> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL || undefined });
  if (compatible) {
    const response = await client.chat.completions.create({ model, messages: [{ role: "system", content: `${systemPrompt()} Return a minimal unified diff JSON without markdown fences.` }, { role: "user", content: prompt(context, criteria) }], response_format: { type: "json_object" } }, { signal });
    return modelFixSchema.parse(JSON.parse(response.choices[0]?.message.content ?? ""));
  }
  const response = await client.responses.create({ model, input: [{ role: "system", content: `${systemPrompt()} Return a minimal unified diff as structured JSON.` }, { role: "user", content: prompt(context, criteria) }], text: { format: { type: "json_schema", name: "mergeproof_fix", strict: true, schema: fixResponseSchema } } }, { signal });
  return modelFixSchema.parse(JSON.parse(response.output_text));
}

async function fixWithAnthropic(model: string, context: PullRequestContext, criteria: string[], signal?: AbortSignal, prompt = fixPrompt): Promise<ModelFix> {
  const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal, headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model, max_tokens: 8000, system: `${systemPrompt()} Return valid JSON with summary and unified diff patch. Do not use markdown fences.`, messages: [{ role: "user", content: prompt(context, criteria) }] }) });
  if (!response.ok) throw new Error(`Anthropic request failed with HTTP ${response.status}.`);
  const payload = await response.json() as { content?: Array<{ type?: string; text?: string }> };
  const text = payload.content?.find((item) => item.type === "text")?.text ?? "";
  const object = text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  return modelFixSchema.parse(JSON.parse(object));
}

export function createModelProvider(model = process.env.OPENAI_MODEL || "gpt-5.6", provider = (process.env.MERGEPROOF_PROVIDER || "openai") as ModelProviderKind): ModelProvider {
  const normalizedProvider = provider.toLowerCase() as ModelProviderKind;
  if (normalizedProvider === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured.");
    return { name: `anthropic:${model}`, analyze: (context, criteria, signal) => analyzeWithAnthropic(model, context, criteria, signal), plan: (context, criteria, signal) => planWithAnthropic(model, context, criteria, signal), fix: (context, criteria, signal) => fixWithAnthropic(model, context, criteria, signal), tests: (context, criteria, signal) => fixWithAnthropic(model, context, criteria, signal, testPrompt) };
  }
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  if (normalizedProvider !== "openai" && normalizedProvider !== "openai-compatible") throw new Error(`Unsupported model provider: ${provider}`);
  return { name: `${normalizedProvider}:${model}`, analyze: (context, criteria, signal) => analyzeWithOpenAI(model, context, criteria, normalizedProvider === "openai-compatible", signal), plan: (context, criteria, signal) => planWithOpenAI(model, context, criteria, normalizedProvider === "openai-compatible", signal), fix: (context, criteria, signal) => fixWithOpenAI(model, context, criteria, normalizedProvider === "openai-compatible", signal), tests: (context, criteria, signal) => fixWithOpenAI(model, context, criteria, normalizedProvider === "openai-compatible", signal, testPrompt) };
}
