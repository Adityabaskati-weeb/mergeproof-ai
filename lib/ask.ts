import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { retrieveLocalEvidence } from "./retrieval";
import { loadPolicy } from "./policy";
import { loadAgentProfile, combineInstructions } from "./agents";
import { createModelProvider } from "./models";

export type AskOptions = { repoPath?: string; provider?: string; agent?: string; retrievalTopK?: number };
export type AskResult = { answer: string; trace: { model: string; headSha: string; evidenceSources: number; indexedChunks: number; elapsedMs: number; readOnly: true } };

function git(root: string, args: string[]): string {
  try { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return "unavailable"; }
}

export async function askRepository(prompt: string, model?: string, options: AskOptions = {}): Promise<AskResult> {
  const question = prompt.trim();
  if (!question) throw new Error("Ask requires a non-empty question.");
  const repositoryRoot = resolve(options.repoPath || process.cwd());
  const started = Date.now();
  const headSha = git(repositoryRoot, ["rev-parse", "HEAD"]);
  const status = git(repositoryRoot, ["status", "--short"]).slice(0, 12_000);
  const retrieval = await retrieveLocalEvidence(repositoryRoot, headSha, question, Math.min(32, Math.max(1, options.retrievalTopK ?? 8)));
  const policy = await loadPolicy(repositoryRoot);
  const profile = await loadAgentProfile(repositoryRoot, options.agent);
  const providerName = (options.provider || policy.provider || process.env.MERGEPROOF_PROVIDER || "openai").toLowerCase();
  const selectedModel = model || policy.model || (providerName === "anthropic" ? process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514" : process.env.OPENAI_MODEL || "gpt-5.6");
  const provider = createModelProvider(selectedModel, providerName as Parameters<typeof createModelProvider>[1]);
  const result = await provider.answer({ prompt: question, repository: repositoryRoot, headSha, status, repositoryEvidence: retrieval.chunks, customInstructions: combineInstructions(policy.instructions, profile) }, AbortSignal.timeout(60_000));
  return { answer: result.answer, trace: { model: provider.name, headSha, evidenceSources: retrieval.chunks.length, indexedChunks: retrieval.indexedChunks, elapsedMs: Date.now() - started, readOnly: true } };
}
