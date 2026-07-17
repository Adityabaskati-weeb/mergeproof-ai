import OpenAI from "openai";
import { z } from "zod";
import type { PullRequestContext } from "./github";
import type { EvidenceChunk } from "./types";
import { reviewEffortGuidance } from "./effort";
import { reviewProfileGuidance } from "./profile";

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
export type ModelQuestionContext = { prompt: string; repository: string; headSha: string; status: string; repositoryEvidence: EvidenceChunk[]; customInstructions?: string };
export type ModelAnswer = { answer: string };
export type ModelProvider = { name: string; analyze: (context: PullRequestContext, criteria: string[], signal?: AbortSignal) => Promise<ModelAnalysis>; plan: (context: PullRequestContext, criteria: string[], signal?: AbortSignal) => Promise<ModelPlan>; fix: (context: PullRequestContext, criteria: string[], signal?: AbortSignal) => Promise<ModelFix>; task: (context: PullRequestContext, criteria: string[], signal?: AbortSignal) => Promise<ModelFix>; recipe: (context: PullRequestContext, criteria: string[], signal?: AbortSignal) => Promise<ModelFix>; simplify: (context: PullRequestContext, criteria: string[], signal?: AbortSignal) => Promise<ModelFix>; resolve: (context: PullRequestContext, criteria: string[], signal?: AbortSignal) => Promise<ModelFix>; tests: (context: PullRequestContext, criteria: string[], signal?: AbortSignal) => Promise<ModelFix>; docs: (context: PullRequestContext, criteria: string[], signal?: AbortSignal) => Promise<ModelFix>; answer: (context: ModelQuestionContext, signal?: AbortSignal) => Promise<ModelAnswer> };
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

function openAiClient(compatible: boolean): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY || (compatible && process.env.OPENAI_BASE_URL ? "local-compatible-endpoint" : undefined);
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  return new OpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL || undefined });
}

function analysisPrompt(context: PullRequestContext, criteria: string[]): string {
  const effort = context.reviewEffort ?? "medium";
  const profile = context.reviewProfile ?? "chill";
  return JSON.stringify({ title: context.title, criteria, reviewEffort: effort, reviewGuidance: reviewEffortGuidance(effort), reviewProfile: profile, reviewProfileGuidance: reviewProfileGuidance(profile), suggestedReviewers: context.suggestedReviewers ?? [], files: context.files, checks: context.checks, commits: context.commits ?? [], discussion: context.discussion ?? [], reviewThreads: context.reviewThreads ?? [], issues: context.issues ?? [], repositoryEvidence: context.repositoryEvidence ?? [], securityFindings: context.securityFindings ?? [], qualitySignals: context.qualitySignals ?? [], reviewMemory: context.reviewMemory ?? [], knowledge: context.knowledge ?? [], customInstructions: context.customInstructions ?? "", headSha: context.headSha });
}

function planPrompt(context: PullRequestContext, criteria: string[]): string {
  return JSON.stringify({ task: "Create an implementation plan for this pull request and its requirements.", title: context.title, criteria, files: context.files, checks: context.checks, commits: context.commits ?? [], discussion: context.discussion ?? [], reviewThreads: context.reviewThreads ?? [], issues: context.issues ?? [], repositoryEvidence: context.repositoryEvidence ?? [], securityFindings: context.securityFindings ?? [], qualitySignals: context.qualitySignals ?? [], reviewMemory: context.reviewMemory ?? [], knowledge: context.knowledge ?? [], customInstructions: context.customInstructions ?? "", headSha: context.headSha });
}

function fixPrompt(context: PullRequestContext, criteria: string[]): string {
  return JSON.stringify({ task: "Propose a minimal unified diff that fixes the highest-confidence unmet criterion or the highest-priority unresolved review thread. Do not modify files outside the supplied change set. If a safe fix cannot be proven, return an empty patch.", title: context.title, criteria, files: context.files, checks: context.checks, commits: context.commits ?? [], discussion: context.discussion ?? [], reviewThreads: (context.reviewThreads ?? []).filter((thread) => !thread.isResolved && !thread.isOutdated), issues: context.issues ?? [], repositoryEvidence: context.repositoryEvidence ?? [], securityFindings: context.securityFindings ?? [], qualitySignals: context.qualitySignals ?? [], reviewMemory: context.reviewMemory ?? [], knowledge: context.knowledge ?? [], customInstructions: context.customInstructions ?? "", headSha: context.headSha });
}

function taskPrompt(context: PullRequestContext, criteria: string[]): string {
  return JSON.stringify({ task: "Implement the supplied GitHub issue in a clean repository checkout. Return a minimal unified diff that addresses the issue and its acceptance criteria. Use only the supplied repository evidence and instructions. You may modify existing files shown in evidence and add focused new source or test files when required. Do not modify secrets, dependency lockfiles, CI credentials, or unrelated files. Include tests when the repository conventions and evidence make the change safe. If the issue is ambiguous or a safe implementation cannot be proven, return an empty patch.", issue: context.issues ?? [], criteria, repositoryEvidence: context.repositoryEvidence ?? [], customInstructions: context.customInstructions ?? "", headSha: context.headSha });
}

function recipePrompt(context: PullRequestContext, criteria: string[]): string {
  return JSON.stringify({ task: "Execute the named repository finishing-touch recipe as a minimal unified diff. Follow the recipe instructions exactly, use only supplied PR and repository evidence, preserve behavior unless the recipe explicitly requires a behavior change, and do not modify secrets, lockfiles, CI credentials, or unrelated files. If the recipe is ambiguous or the requested change cannot be safely grounded in the evidence, return an empty patch.", recipe: criteria, title: context.title, files: context.files, checks: context.checks, commits: context.commits ?? [], discussion: context.discussion ?? [], reviewThreads: context.reviewThreads ?? [], repositoryEvidence: context.repositoryEvidence ?? [], customInstructions: context.customInstructions ?? "", headSha: context.headSha });
}

function answerPrompt(context: ModelQuestionContext): string {
  return JSON.stringify({ task: "Answer a developer's repository question using only the supplied repository evidence and instructions. Clearly distinguish observed facts from inference. Do not claim to have executed commands or inspected files outside the supplied evidence. Do not propose or apply edits unless the user explicitly asks for a plan; this operation is read-only.", question: context.prompt, repository: context.repository, headSha: context.headSha, gitStatus: context.status, repositoryEvidence: context.repositoryEvidence, customInstructions: context.customInstructions ?? "" });
}

function simplifyPrompt(context: PullRequestContext, criteria: string[]): string {
  return JSON.stringify({ task: "Suggest a minimal behavior-preserving refactor for the changed code: simplify conditionals, remove redundant code, improve naming, and extract reusable logic only when the supplied evidence supports it. Do not change the public behavior, API contract, tests, or files outside the supplied change set. Return an empty patch when equivalence cannot be proven.", title: context.title, criteria, files: context.files, checks: context.checks, commits: context.commits ?? [], discussion: context.discussion ?? [], reviewThreads: context.reviewThreads ?? [], issues: context.issues ?? [], repositoryEvidence: context.repositoryEvidence ?? [], securityFindings: context.securityFindings ?? [], qualitySignals: context.qualitySignals ?? [], reviewMemory: context.reviewMemory ?? [], knowledge: context.knowledge ?? [], customInstructions: context.customInstructions ?? "", headSha: context.headSha });
}

function conflictPrompt(context: PullRequestContext, criteria: string[]): string {
  return JSON.stringify({ task: "Resolve the supplied Git merge-conflict files. Return a minimal unified diff that removes every conflict marker and preserves the intended behavior from both sides. Do not invent APIs or modify files that contain no supplied conflict. If a safe resolution cannot be proven, return an empty patch.", criteria, files: context.files, repositoryEvidence: context.repositoryEvidence ?? [], customInstructions: context.customInstructions ?? "", headSha: context.headSha });
}

function testPrompt(context: PullRequestContext, criteria: string[]): string {
  return JSON.stringify({ task: "Propose a minimal unified diff adding focused automated tests for the highest-risk unmet criterion. Modify only existing test files or a new test file adjacent to the changed code. Do not modify production code. If a safe test cannot be proven from the supplied context, return an empty patch.", title: context.title, criteria, files: context.files, checks: context.checks, commits: context.commits ?? [], discussion: context.discussion ?? [], reviewThreads: context.reviewThreads ?? [], issues: context.issues ?? [], repositoryEvidence: context.repositoryEvidence ?? [], securityFindings: context.securityFindings ?? [], qualitySignals: context.qualitySignals ?? [], reviewMemory: context.reviewMemory ?? [], knowledge: context.knowledge ?? [], customInstructions: context.customInstructions ?? "", headSha: context.headSha });
}

function docstringPrompt(context: PullRequestContext, criteria: string[]): string {
  return JSON.stringify({ task: "Add accurate docstrings or documentation comments to changed public functions, classes, and exported types. Preserve behavior and formatting conventions. Modify only files already present in the supplied change set; do not change tests, configuration, dependencies, or executable statements. If the supplied evidence does not identify a safe documentation-only change, return an empty patch.", criteria, files: context.files, repositoryEvidence: context.repositoryEvidence ?? [], customInstructions: context.customInstructions ?? "", headSha: context.headSha });
}

function systemPrompt(): string {
  return "You are MergeProof, an evidence auditor. Use only supplied PR, issue, check, repository evidence, deterministic security/privacy/quality signals, and team instructions. Do not invent citations. Every criterion must have evidence and citations or be marked warn/fail. Return only the requested JSON.";
}

function parseJson(text: string): ModelAnalysis {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] ?? text;
  const object = fenced.match(/\{[\s\S]*\}/)?.[0] ?? fenced;
  return modelAnalysisSchema.parse(JSON.parse(object));
}

async function analyzeWithOpenAI(model: string, context: PullRequestContext, criteria: string[], compatible: boolean, signal?: AbortSignal): Promise<ModelAnalysis> {
  const client = openAiClient(compatible);
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
  const client = openAiClient(compatible);
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
  const client = openAiClient(compatible);
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

async function answerWithOpenAI(model: string, context: ModelQuestionContext, compatible: boolean, signal?: AbortSignal): Promise<ModelAnswer> {
  const client = openAiClient(compatible);
  const system = "You are MergeProof Ask, a read-only repository explainer. Use only the supplied evidence. Cite paths and line ranges in plain text when useful. State uncertainty instead of inventing facts.";
  if (compatible) {
    const response = await client.chat.completions.create({ model, messages: [{ role: "system", content: system }, { role: "user", content: answerPrompt(context) }] }, { signal });
    return { answer: response.choices[0]?.message.content?.trim() || "The model returned no answer." };
  }
  const response = await client.responses.create({ model, input: [{ role: "system", content: system }, { role: "user", content: answerPrompt(context) }] }, { signal });
  return { answer: response.output_text.trim() || "The model returned no answer." };
}

async function answerWithAnthropic(model: string, context: ModelQuestionContext, signal?: AbortSignal): Promise<ModelAnswer> {
  const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal, headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model, max_tokens: 6000, system: "You are MergeProof Ask, a read-only repository explainer. Use only the supplied evidence and state uncertainty instead of inventing facts.", messages: [{ role: "user", content: answerPrompt(context) }] }) });
  if (!response.ok) throw new Error(`Anthropic request failed with HTTP ${response.status}.`);
  const payload = await response.json() as { content?: Array<{ type?: string; text?: string }> };
  return { answer: payload.content?.find((item) => item.type === "text")?.text?.trim() || "The model returned no answer." };
}

export function createModelProvider(model = process.env.OPENAI_MODEL || "gpt-5.6", provider = (process.env.MERGEPROOF_PROVIDER || "openai") as ModelProviderKind): ModelProvider {
  const normalizedProvider = provider.toLowerCase() as ModelProviderKind;
  if (normalizedProvider === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured.");
    return { name: `anthropic:${model}`, analyze: (context, criteria, signal) => analyzeWithAnthropic(model, context, criteria, signal), plan: (context, criteria, signal) => planWithAnthropic(model, context, criteria, signal), fix: (context, criteria, signal) => fixWithAnthropic(model, context, criteria, signal), task: (context, criteria, signal) => fixWithAnthropic(model, context, criteria, signal, taskPrompt), recipe: (context, criteria, signal) => fixWithAnthropic(model, context, criteria, signal, recipePrompt), simplify: (context, criteria, signal) => fixWithAnthropic(model, context, criteria, signal, simplifyPrompt), resolve: (context, criteria, signal) => fixWithAnthropic(model, context, criteria, signal, conflictPrompt), tests: (context, criteria, signal) => fixWithAnthropic(model, context, criteria, signal, testPrompt), docs: (context, criteria, signal) => fixWithAnthropic(model, context, criteria, signal, docstringPrompt), answer: (context, signal) => answerWithAnthropic(model, context, signal) };
  }
  if (normalizedProvider !== "openai" && normalizedProvider !== "openai-compatible") throw new Error(`Unsupported model provider: ${provider}`);
  if (!process.env.OPENAI_API_KEY && !(normalizedProvider === "openai-compatible" && process.env.OPENAI_BASE_URL)) throw new Error("OPENAI_API_KEY is not configured. For a local OpenAI-compatible endpoint, set OPENAI_BASE_URL.");
  return { name: `${normalizedProvider}:${model}`, analyze: (context, criteria, signal) => analyzeWithOpenAI(model, context, criteria, normalizedProvider === "openai-compatible", signal), plan: (context, criteria, signal) => planWithOpenAI(model, context, criteria, normalizedProvider === "openai-compatible", signal), fix: (context, criteria, signal) => fixWithOpenAI(model, context, criteria, normalizedProvider === "openai-compatible", signal), task: (context, criteria, signal) => fixWithOpenAI(model, context, criteria, normalizedProvider === "openai-compatible", signal, taskPrompt), recipe: (context, criteria, signal) => fixWithOpenAI(model, context, criteria, normalizedProvider === "openai-compatible", signal, recipePrompt), simplify: (context, criteria, signal) => fixWithOpenAI(model, context, criteria, normalizedProvider === "openai-compatible", signal, simplifyPrompt), resolve: (context, criteria, signal) => fixWithOpenAI(model, context, criteria, normalizedProvider === "openai-compatible", signal, conflictPrompt), tests: (context, criteria, signal) => fixWithOpenAI(model, context, criteria, normalizedProvider === "openai-compatible", signal, testPrompt), docs: (context, criteria, signal) => fixWithOpenAI(model, context, criteria, normalizedProvider === "openai-compatible", signal, docstringPrompt), answer: (context, signal) => answerWithOpenAI(model, context, normalizedProvider === "openai-compatible", signal) };
}
