import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildWorkingTreeReviewContext, reviewWorkingTree, type LocalReviewOptions } from "./local-review";
import { createModelProvider } from "./models";
import { validatePatchPaths } from "./fix";
import type { Analysis } from "./types";

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export type VerificationCommand = "npm test" | "npm run build" | "npm run typecheck" | "pytest" | "cargo test" | "go test ./...";
export const VERIFICATION_COMMANDS: readonly VerificationCommand[] = ["npm test", "npm run build", "npm run typecheck", "pytest", "cargo test", "go test ./..."];
export type LocalAgentOptions = LocalReviewOptions & { verify?: VerificationCommand; reReview?: boolean };
export type LocalAgentRun = {
  summary: string;
  patch: string;
  trace: {
    model: string;
    changedPaths: string[];
    sandboxed: true;
    appliedToSandbox: boolean;
    verified: boolean;
    verificationCommand?: VerificationCommand;
    verificationOutput?: string;
    reReviewDecision?: Analysis["decision"];
    reReviewPassed?: boolean;
    reReviewUnsupportedClaims?: number;
    reReviewError?: string;
  };
};

function normalizePatch(value: string): string {
  return value.replace(/^```(?:diff|patch)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function runGit(root: string, args: string[], input?: string): string {
  return execFileSync("git", args, { cwd: root, input, encoding: "utf8", maxBuffer: MAX_OUTPUT_BYTES, stdio: input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"] }).toString();
}

function runVerification(root: string, command: VerificationCommand): string {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const [executable, args] = command === "npm test" ? [npm, ["test"]] : command === "npm run build" ? [npm, ["run", "build"]] : command === "npm run typecheck" ? [npm, ["run", "typecheck"]] : command === "pytest" ? ["pytest", []] : command === "cargo test" ? ["cargo", ["test"]] : ["go", ["test", "./..."]];
  const environment = { ...process.env };
  for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GITHUB_TOKEN", "GH_TOKEN", "SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET", "GITLAB_TOKEN", "BITBUCKET_TOKEN", "BITBUCKET_APP_PASSWORD", "AZURE_DEVOPS_TOKEN", "JIRA_API_TOKEN", "LINEAR_API_KEY"]) delete environment[key];
  return execFileSync(executable, args, { cwd: root, env: environment, encoding: "utf8", timeout: 120_000, maxBuffer: MAX_OUTPUT_BYTES, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

export async function runLocalAgent(model?: string, options: LocalAgentOptions = {}): Promise<LocalAgentRun> {
  if (options.verify && !VERIFICATION_COMMANDS.includes(options.verify)) throw new Error(`Unsupported verification command. Choose one of: ${VERIFICATION_COMMANDS.join(", ")}.`);
  const workingTree = await buildWorkingTreeReviewContext(options);
  const providerName = (options.provider || workingTree.policy.provider || process.env.MERGEPROOF_PROVIDER || "openai").toLowerCase();
  const selectedModel = model || workingTree.policy.model || (providerName === "anthropic" ? process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514" : process.env.OPENAI_MODEL || "gpt-5.6");
  const provider = createModelProvider(selectedModel, providerName as Parameters<typeof createModelProvider>[1]);
  const result = await provider.fix(workingTree.context, workingTree.criteria, AbortSignal.timeout(45_000));
  const patch = normalizePatch(result.patch);
  const changedPaths = patch ? validatePatchPaths(patch) : [];
  if (!patch) return { summary: result.summary, patch: "", trace: { model: provider.name, changedPaths, sandboxed: true, appliedToSandbox: false, verified: false } };

  let sandbox: string | undefined;
  let verified = false;
  let verificationOutput = "";
  let reReviewDecision: Analysis["decision"] | undefined;
  let reReviewPassed: boolean | undefined;
  let reReviewUnsupportedClaims: number | undefined;
  let reReviewError: string | undefined;
  try {
    sandbox = await mkdtemp(join(tmpdir(), "mergeproof-agent-"));
    runGit(workingTree.repositoryRoot, ["worktree", "add", "--detach", sandbox, workingTree.changes.gitHeadSha]);
    runGit(sandbox, ["apply", "--check", "--whitespace=error"], patch);
    runGit(sandbox, ["apply", "--whitespace=error"], patch);
    if (options.verify) {
      try {
        verificationOutput = runVerification(sandbox, options.verify);
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
          const rereview = await reviewWorkingTree(model, { repoPath: sandbox, provider: options.provider, criteria: workingTree.criteria, retrievalTopK: options.retrievalTopK, effort: options.effort, agent: options.agent, directories: options.directories, externalSecurity: options.externalSecurity, codeqlDatabase: options.codeqlDatabase, codeqlCreate: options.codeqlCreate, codeqlLanguages: options.codeqlLanguages, codeqlQuery: options.codeqlQuery });
          reReviewDecision = rereview.decision;
          reReviewPassed = rereview.decision === "ready";
          reReviewUnsupportedClaims = rereview.trace.unsupportedClaims;
        } catch (error) {
          reReviewPassed = false;
          reReviewError = error instanceof Error ? error.message : "Re-review failed.";
        }
      }
    }
  } finally {
    if (sandbox) {
      try {
        runGit(workingTree.repositoryRoot, ["worktree", "remove", "--force", sandbox]);
      } catch {
        // Cleanup is best effort; the patch was never applied to the user's working tree.
      }
      await rm(sandbox, { recursive: true, force: true });
    }
  }
  return { summary: result.summary, patch, trace: { model: provider.name, changedPaths, sandboxed: true, appliedToSandbox: true, verified, ...(options.verify ? { verificationCommand: options.verify, verificationOutput } : {}), ...(options.reReview ? { reReviewDecision, reReviewPassed, reReviewUnsupportedClaims, reReviewError } : {}) } };
}
