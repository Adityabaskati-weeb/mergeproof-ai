import OpenAI from "openai";
import { z } from "zod";
import type { PullRequestContext } from "./github";

export const modelAnalysisSchema = z.object({
  contract: z.object({ promise: z.string(), code: z.string(), tests: z.string(), release: z.string() }),
  rows: z.array(z.object({ criterion: z.string(), evidence: z.string(), state: z.enum(["pass", "warn", "fail"]), citations: z.array(z.object({ path: z.string(), commitSha: z.string(), url: z.string().url() })) })),
});
export type ModelAnalysis = z.infer<typeof modelAnalysisSchema>;
export type ModelProvider = { name: string; analyze: (context: PullRequestContext, criteria: string[], signal?: AbortSignal) => Promise<ModelAnalysis> };

export function createModelProvider(model = process.env.OPENAI_MODEL || "gpt-5.6"): ModelProvider {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return {
    name: model,
    async analyze(context, criteria, signal) {
      const response = await client.responses.create({ model, input: [{ role: "system", content: "You are MergeProof, an evidence auditor. Use only supplied PR data. Do not invent citations. Mark missing evidence as warn or fail. Return only the requested JSON." }, { role: "user", content: JSON.stringify({ title: context.title, criteria, files: context.files, checks: context.checks, headSha: context.headSha }) }], text: { format: { type: "json_schema", name: "mergeproof_analysis", strict: true, schema: { type: "object", additionalProperties: false, properties: { contract: { type: "object", additionalProperties: false, properties: { promise: { type: "string" }, code: { type: "string" }, tests: { type: "string" }, release: { type: "string" } }, required: ["promise", "code", "tests", "release"] }, rows: { type: "array", items: { type: "object", additionalProperties: false, properties: { criterion: { type: "string" }, evidence: { type: "string" }, state: { type: "string", enum: ["pass", "warn", "fail"] }, citations: { type: "array", items: { type: "object", additionalProperties: false, properties: { path: { type: "string" }, commitSha: { type: "string" }, url: { type: "string" } }, required: ["path", "commitSha", "url"] } } }, required: ["criterion", "evidence", "state", "citations"] } } }, required: ["contract", "rows"] } } } }, { signal });
      return modelAnalysisSchema.parse(JSON.parse(response.output_text));
    },
  };
}
