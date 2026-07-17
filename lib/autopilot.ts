import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { runImplementationAgent, type ImplementationAgentRun } from "./implementation-agent";
import { assertPermission } from "./permissions";
import type { VerificationCommand } from "./local-agent";

export type AutopilotOptions = { repoPath: string; provider?: string; agent?: string; retrievalTopK?: number; verify: VerificationCommand; maxIterations?: number; apply?: boolean };
export type AutopilotAttempt = { iteration: number; summary: string; patch: string; verified: boolean; reReviewDecision?: string; reReviewPassed?: boolean; unsupportedClaims?: number; error?: string };
export type AutopilotRun = { summary: string; patch: string; attempts: AutopilotAttempt[]; trace: { model: string; headSha: string; iterations: number; converged: boolean; appliedToCheckout: boolean; verified: boolean; reReviewPassed: boolean; changedPaths: string[] } };

const MAX_ITERATIONS = 5;

function git(root: string, args: string[], input?: string): string { return execFileSync("git", args, { cwd: root, input, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, stdio: input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"] }).toString().trim(); }

function requestWithFeedback(request: string, previous?: ImplementationAgentRun): string {
  if (!previous) return request;
  const feedback = [`Previous autonomous attempt summary: ${previous.summary}`, `Verification passed: ${previous.trace.verified}`, `Evidence re-review decision: ${previous.trace.reReviewDecision ?? "not available"}`, `Unsupported claims: ${previous.trace.reReviewUnsupportedClaims ?? "unknown"}`, "Return a corrected complete patch against the original clean checkout. Do not assume the previous patch was applied.", previous.patch ? `Previous patch:\n${previous.patch.slice(0, 8_000)}` : ""].filter(Boolean).join("\n\n");
  return `${request}\n\nAutonomous correction context:\n${feedback}`.slice(0, 12_000);
}

export async function runAutopilot(request: string, model: string | undefined, options: AutopilotOptions): Promise<AutopilotRun> {
  if (!options.verify) throw new Error("Autopilot requires an allowlisted verification command.");
  const repositoryRoot = resolve(options.repoPath);
  const headSha = git(repositoryRoot, ["rev-parse", "HEAD"]);
  const maxIterations = Math.max(1, Math.min(MAX_ITERATIONS, Math.floor(options.maxIterations ?? 3)));
  const attempts: AutopilotAttempt[] = [];
  let previous: ImplementationAgentRun | undefined;
  let winner: ImplementationAgentRun | undefined;
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    try {
      const run = await runImplementationAgent(requestWithFeedback(request, previous), model, { repoPath: repositoryRoot, provider: options.provider, agent: options.agent, retrievalTopK: options.retrievalTopK, verify: options.verify, reReview: true, apply: false });
      attempts.push({ iteration, summary: run.summary, patch: run.patch, verified: run.trace.verified, reReviewDecision: run.trace.reReviewDecision, reReviewPassed: run.trace.reReviewPassed, unsupportedClaims: run.trace.reReviewUnsupportedClaims });
      previous = run;
      if (run.patch && run.trace.verified && run.trace.reReviewPassed === true) { winner = run; break; }
    } catch (error) {
      attempts.push({ iteration, summary: "Autonomous attempt failed.", patch: "", verified: false, error: error instanceof Error ? error.message : "Autonomous attempt failed." });
    }
  }
  if (!winner) {
    const last = previous;
    return { summary: last?.summary ?? "Autopilot could not produce a verified patch.", patch: last?.patch ?? "", attempts, trace: { model: last?.trace.model ?? `${options.provider ?? "openai"}:unknown`, headSha, iterations: attempts.length, converged: false, appliedToCheckout: false, verified: last?.trace.verified === true, reReviewPassed: last?.trace.reReviewPassed === true, changedPaths: last?.trace.changedPaths ?? [] } };
  }
  let appliedToCheckout = false;
  if (options.apply) {
    await assertPermission(repositoryRoot, "apply", { paths: winner.trace.changedPaths, verified: true });
    if (git(repositoryRoot, ["status", "--porcelain"]) || git(repositoryRoot, ["rev-parse", "HEAD"]) !== headSha) throw new Error("Checkout changed during autopilot; refusing to apply a stale patch.");
    git(repositoryRoot, ["apply", "--check", "--whitespace=error", "-"], winner.patch);
    execFileSync("git", ["apply", "--whitespace=error", "-"], { cwd: repositoryRoot, input: winner.patch, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    appliedToCheckout = true;
  }
  return { summary: winner.summary, patch: winner.patch, attempts, trace: { model: winner.trace.model, headSha, iterations: attempts.length, converged: true, appliedToCheckout, verified: true, reReviewPassed: true, changedPaths: winner.trace.changedPaths } };
}
