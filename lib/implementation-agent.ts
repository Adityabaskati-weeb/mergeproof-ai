import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { combineInstructions, loadAgentProfile } from "./agents";
import { createModelProvider } from "./models";
import { loadPolicy } from "./policy";
import { retrieveLocalEvidence } from "./retrieval";
import { reviewWorkingTree } from "./local-review";
import { runVerificationCommand, type VerificationCommand } from "./local-agent";
import { validatePatchPaths } from "./fix";
import type { PullRequestContext } from "./github";
import type { Analysis } from "./types";

export type ImplementationAgentOptions = {
  repoPath: string;
  provider?: string;
  agent?: string;
  retrievalTopK?: number;
  verify?: VerificationCommand;
  reReview?: boolean;
  apply?: boolean;
};

export type ImplementationAgentRun = {
  summary: string;
  patch: string;
  trace: {
    model: string;
    request: string;
    headSha: string;
    changedPaths: string[];
    evidenceSources: number;
    indexedChunks: number;
    sandboxed: true;
    appliedToSandbox: boolean;
    appliedToCheckout: boolean;
    verified: boolean;
    verificationCommand?: VerificationCommand;
    verificationOutput?: string;
    reReviewDecision?: Analysis["decision"];
    reReviewPassed?: boolean;
    reReviewUnsupportedClaims?: number;
    reReviewError?: string;
  };
};

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

function git(root: string, args: string[], input?: string): string {
  return execFileSync("git", args, { cwd: root, input, encoding: "utf8", maxBuffer: MAX_OUTPUT_BYTES, stdio: input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"] }).toString().trim();
}

function normalizePatch(value: string): string {
  return value.replace(/^```(?:diff|patch)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function repositoryContext(root: string, request: string, headSha: string, evidence: Awaited<ReturnType<typeof retrieveLocalEvidence>>, instructions?: string): PullRequestContext {
  const rootUrl = pathToFileURL(root).toString();
  return {
    ref: { owner: "local", repo: basename(root), number: 0, url: rootUrl },
    title: request,
    body: request,
    headSha,
    baseSha: headSha,
    baseBranch: "local",
    files: [],
    checks: [],
    commits: [],
    discussion: [],
    sources: new Set([rootUrl, ...evidence.chunks.map((chunk) => chunk.url)]),
    repositoryEvidence: evidence.chunks,
    issues: [],
    ...(instructions ? { customInstructions: instructions } : {}),
  };
}

export async function runImplementationAgent(request: string, model?: string, options: ImplementationAgentOptions = { repoPath: process.cwd() }): Promise<ImplementationAgentRun> {
  const normalizedRequest = request.trim();
  if (!normalizedRequest) throw new Error("Implementation request must not be empty.");
  if (normalizedRequest.length > 12_000) throw new Error("Implementation request exceeds the 12,000 character limit.");
  if (options.apply && !options.verify) throw new Error("--apply requires --verify so the checkout is only mutated after explicit verification.");

  const repositoryRoot = resolve(options.repoPath);
  if (git(repositoryRoot, ["status", "--porcelain"])) throw new Error("Implementation agent requires a clean checkout so the sandbox base is unambiguous.");
  const headSha = git(repositoryRoot, ["rev-parse", "HEAD"]);
  const policy = await loadPolicy(repositoryRoot);
  const agentProfile = await loadAgentProfile(repositoryRoot, options.agent);
  const retrieval = await retrieveLocalEvidence(repositoryRoot, headSha, normalizedRequest, options.retrievalTopK ?? policy.retrievalTopK ?? 10);
  const context = repositoryContext(repositoryRoot, normalizedRequest, headSha, retrieval, combineInstructions(policy.instructions, agentProfile));
  const providerName = (options.provider || policy.provider || process.env.MERGEPROOF_PROVIDER || "openai").toLowerCase();
  const selectedModel = model || policy.model || (providerName === "anthropic" ? process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514" : process.env.OPENAI_MODEL || "gpt-5.6");
  const provider = createModelProvider(selectedModel, providerName as Parameters<typeof createModelProvider>[1]);
  const result = await provider.implement(context, [normalizedRequest], AbortSignal.timeout(60_000));
  const patch = normalizePatch(result.patch);
  const changedPaths = patch ? validatePatchPaths(patch) : [];
  const baseTrace = { model: provider.name, request: normalizedRequest, headSha, changedPaths, evidenceSources: retrieval.chunks.length + 1, indexedChunks: retrieval.indexedChunks, sandboxed: true as const };
  if (!patch) return { summary: result.summary, patch: "", trace: { ...baseTrace, appliedToSandbox: false, appliedToCheckout: false, verified: false } };

  const sandbox = await mkdtemp(join(tmpdir(), "mergeproof-implementation-"));
  let verified = false;
  let verificationOutput = "";
  let reReviewDecision: Analysis["decision"] | undefined;
  let reReviewPassed: boolean | undefined;
  let reReviewUnsupportedClaims: number | undefined;
  let reReviewError: string | undefined;
  let appliedToCheckout = false;
  try {
    git(repositoryRoot, ["worktree", "add", "--detach", sandbox, headSha]);
    git(sandbox, ["apply", "--check", "--whitespace=error"], patch);
    git(sandbox, ["apply", "--whitespace=error"], patch);
    if (options.verify) {
      try {
        verificationOutput = runVerificationCommand(sandbox, options.verify);
        verified = true;
      } catch (error) {
        verificationOutput = error instanceof Error ? error.message : "Verification failed.";
      }
    }
    if (options.reReview) {
      if (options.verify && !verified) {
        reReviewPassed = false;
        reReviewError = "Skipped re-review because the requested verification command failed.";
      } else {
        try {
          const review = await reviewWorkingTree(model, { repoPath: sandbox, provider: options.provider, criteria: [normalizedRequest], retrievalTopK: options.retrievalTopK, agent: options.agent });
          reReviewDecision = review.decision;
          reReviewPassed = review.decision === "ready";
          reReviewUnsupportedClaims = review.trace.unsupportedClaims;
        } catch (error) {
          reReviewPassed = false;
          reReviewError = error instanceof Error ? error.message : "Re-review failed.";
        }
      }
    }
    if (options.apply) {
      if (!verified) throw new Error("Refusing to apply because verification did not pass.");
      if (options.reReview && !reReviewPassed) throw new Error("Refusing to apply because the evidence re-review did not pass.");
      if (git(repositoryRoot, ["status", "--porcelain"]) || git(repositoryRoot, ["rev-parse", "HEAD"]) !== headSha) throw new Error("Checkout changed while the sandbox was running; refusing to apply a stale patch.");
      git(repositoryRoot, ["apply", "--check", "--whitespace=error"], patch);
      git(repositoryRoot, ["apply", "--whitespace=error"], patch);
      appliedToCheckout = true;
    }
  } finally {
    try { git(repositoryRoot, ["worktree", "remove", "--force", sandbox]); } catch { /* cleanup is best effort */ }
    await rm(sandbox, { recursive: true, force: true });
  }
  return { summary: result.summary, patch, trace: { ...baseTrace, appliedToSandbox: true, appliedToCheckout, verified, ...(options.verify ? { verificationCommand: options.verify, verificationOutput } : {}), ...(options.reReview ? { reReviewDecision, reReviewPassed, reReviewUnsupportedClaims, reReviewError } : {}) } };
}
