import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { retrieveLocalEvidence } from "./retrieval";
import { loadPolicy } from "./policy";
import { combineInstructions, loadAgentProfile } from "./agents";
import { createModelProvider, type ReviewPlan } from "./models";
import type { PullRequestContext } from "./github";

export type WorkPlanOptions = { repoPath?: string; provider?: string; agent?: string; retrievalTopK?: number };

function git(root: string, args: string[]): string {
  try { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return "working-tree"; }
}

export async function planWorkItem(request: string, model?: string, options: WorkPlanOptions = {}): Promise<ReviewPlan> {
  const workItem = request.trim();
  if (!workItem) throw new Error("Work planning requires a non-empty request.");
  if (workItem.length > 16_000) throw new Error("Work planning requests must be 16,000 characters or fewer.");
  const repositoryRoot = resolve(options.repoPath || process.cwd());
  const started = Date.now();
  const headSha = git(repositoryRoot, ["rev-parse", "HEAD"]);
  const retrieval = await retrieveLocalEvidence(repositoryRoot, headSha, workItem, Math.min(32, Math.max(1, options.retrievalTopK ?? 12)));
  const policy = await loadPolicy(repositoryRoot);
  const profile = await loadAgentProfile(repositoryRoot, options.agent);
  const providerName = (options.provider || policy.provider || process.env.MERGEPROOF_PROVIDER || "openai").toLowerCase();
  const selectedModel = model || policy.model || (providerName === "anthropic" ? process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514" : process.env.OPENAI_MODEL || "gpt-5.6");
  const provider = createModelProvider(selectedModel, providerName as Parameters<typeof createModelProvider>[1]);
  const sourceUrls = new Set(retrieval.chunks.map((chunk) => chunk.url));
  const context: PullRequestContext = {
    ref: { owner: "local", repo: basename(repositoryRoot), number: 0, url: pathToFileURL(repositoryRoot).toString() },
    title: workItem,
    body: workItem,
    headSha,
    baseSha: headSha,
    files: [],
    checks: [],
    sources: new Set(sourceUrls),
    repositoryEvidence: retrieval.chunks,
    customInstructions: combineInstructions(policy.instructions, profile),
  };
  const result = await provider.plan(context, [workItem], AbortSignal.timeout(60_000));
  const validCitation = (citation: { path: string; commitSha: string; url: string }) => citation.commitSha === headSha && sourceUrls.has(citation.url) && retrieval.chunks.some((chunk) => chunk.path === citation.path);
  const risks = result.risks.map((risk) => ({ ...risk, citations: risk.citations.filter(validCitation) }));
  const steps = result.steps.map((step) => ({ ...step, citations: step.citations.filter(validCitation) }));
  const citedSources = [...risks.flatMap((risk) => risk.citations), ...steps.flatMap((step) => step.citations)].length;
  return { ...result, risks, steps, trace: { model: provider.name, headSha, fetchedSources: sourceUrls.size, citedSources, evidenceCoverage: sourceUrls.size ? citedSources / sourceUrls.size : 0, local: true, elapsedMs: Date.now() - started } };
}
