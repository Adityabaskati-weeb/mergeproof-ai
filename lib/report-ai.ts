import { createHash } from "node:crypto";
import { combineInstructions, loadAgentProfile } from "./agents";
import { createModelProvider } from "./models";
import { loadPolicy } from "./policy";
import type { ReviewReport } from "./report";

export type CustomReportOptions = { repoPath?: string; model?: string; provider?: string; agent?: string };
export type CustomReportResult = { report: string; trace: { model: string; sourceDigest: string; elapsedMs: number; readOnly: true } };

export async function generateCustomReport(prompt: string, sourceReport: ReviewReport, options: CustomReportOptions = {}): Promise<CustomReportResult> {
  const request = prompt.trim();
  if (!request) throw new Error("Custom report prompts must not be empty.");
  if (request.length > 4_000) throw new Error("Custom report prompts must be 4,000 characters or fewer.");
  const started = Date.now();
  const serialized = JSON.stringify(sourceReport);
  const sourceDigest = createHash("sha256").update(serialized).digest("hex");
  const headSha = `report:${sourceDigest}`;
  const repositoryRoot = options.repoPath || process.cwd();
  const policy = await loadPolicy(repositoryRoot);
  const profile = await loadAgentProfile(repositoryRoot, options.agent);
  const providerName = (options.provider || policy.provider || process.env.MERGEPROOF_PROVIDER || "openai").toLowerCase();
  const selectedModel = options.model || policy.model || (providerName === "anthropic" ? process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514" : process.env.OPENAI_MODEL || "gpt-5.6");
  const provider = createModelProvider(selectedModel, providerName as Parameters<typeof createModelProvider>[1]);
  const sourceUrl = `mergeproof://report/${sourceDigest}`;
  const result = await provider.answer({
    prompt: `Create a concise Markdown engineering report for this request: ${request}\nUse only the supplied report data. State when the data is insufficient and do not invent repositories, users, dates, or outcomes.\nSource digest: ${sourceDigest}`,
    repository: repositoryRoot,
    headSha,
    status: "read-only report data",
    repositoryEvidence: [{ path: ".mergeproof/report.json", startLine: 1, endLine: serialized.split(/\r?\n/).length, content: serialized.slice(0, 60_000), commitSha: headSha, url: sourceUrl }],
    customInstructions: combineInstructions(policy.instructions, profile),
  }, AbortSignal.timeout(60_000));
  return { report: result.answer, trace: { model: provider.name, sourceDigest, elapsedMs: Date.now() - started, readOnly: true } };
}
