import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createGithubClient } from "./github-auth";
import { extractAcceptanceCriteria } from "./criteria";
import { createModelProvider } from "./models";
import { loadPolicy } from "./policy";
import { combineInstructions, loadAgentProfile } from "./agents";
import { retrieveLocalEvidence } from "./retrieval";
import { validatePatchPaths } from "./fix";
import { reviewWorkingTree } from "./local-review";
import { runVerificationCommand, type VerificationCommand } from "./local-agent";
import type { LinkedIssue } from "./types";
import type { PullRequestContext } from "./github";
import { assertPermission } from "./permissions";

export type GithubIssueRef = { owner: string; repo: string; number: number; url: string };
export type TaskAgentOptions = { repoPath?: string; provider?: string; agent?: string; retrievalTopK?: number; verify?: VerificationCommand; reReview?: boolean; createPr?: boolean; branch?: string };
export type TaskAgentRun = {
  summary: string;
  patch: string;
  trace: { model: string; issueUrl: string; headSha: string; changedPaths: string[]; evidenceSources: number; sandboxed: true; appliedToSandbox: boolean; verified: boolean; verificationCommand?: VerificationCommand; verificationOutput?: string; reReviewDecision?: string; reReviewPassed?: boolean; branch?: string; pullRequestUrl?: string };
};

export function parseGithubIssueUrl(value: string): GithubIssueRef {
  const normalized = value.trim().replace(/\/$/, "");
  const match = normalized.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)$/i);
  if (!match) throw new Error("Expected a GitHub issue URL such as https://github.com/owner/repo/issues/123.");
  return { owner: match[1], repo: match[2], number: Number(match[3]), url: normalized };
}

function git(root: string, args: string[], input?: string): string {
  return execFileSync("git", args, { cwd: root, input, encoding: "utf8", stdio: input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"] }).toString().trim();
}

function normalizePatch(value: string): string {
  return value.replace(/^```(?:diff|patch)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function safeBranch(value: string): string {
  const branch = value.trim();
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith("-") || branch.includes("..")) throw new Error("Unsafe task branch name.");
  return branch;
}

async function fetchIssue(ref: GithubIssueRef): Promise<{ issue: LinkedIssue; defaultBranch: string }> {
  const client = await createGithubClient();
  const [issueResponse, repositoryResponse] = await Promise.all([
    client.rest.issues.get({ owner: ref.owner, repo: ref.repo, issue_number: ref.number }),
    client.rest.repos.get({ owner: ref.owner, repo: ref.repo }),
  ]);
  if (issueResponse.data.pull_request) throw new Error("The task URL points to a pull request. Use the review or autofix workflow for pull requests.");
  const issue: LinkedIssue = { provider: "github", key: `#${ref.number}`, url: ref.url, summary: issueResponse.data.title, description: issueResponse.data.body ?? "", status: issueResponse.data.state, acceptanceCriteria: extractAcceptanceCriteria(issueResponse.data.body ?? "").criteria };
  return { issue, defaultBranch: repositoryResponse.data.default_branch };
}

function ownerFromRemote(root: string, fallback: string): string {
  try { return git(root, ["config", "--get", "remote.origin.url"]).match(/github\.com[/:]([^/]+)\//i)?.[1] ?? fallback; } catch { return fallback; }
}

export async function runIssueAgent(issueUrl: string, model?: string, options: TaskAgentOptions = {}): Promise<TaskAgentRun> {
  if (!options.repoPath) throw new Error("Issue agent requires --repo so the target checkout is explicit.");
  const repositoryRoot = resolve(options.repoPath);
  const target = parseGithubIssueUrl(issueUrl);
  const status = git(repositoryRoot, ["status", "--porcelain"]);
  if (status) throw new Error("Issue agent requires a clean checkout so retrieved evidence matches the sandbox base commit.");
  const remote = git(repositoryRoot, ["config", "--get", "remote.origin.url"]);
  if (!new RegExp(`(?:github\\.com[:/])${target.owner}/${target.repo}(?:\\.git)?$`, "i").test(remote.replace(/\/$/, ""))) throw new Error(`Checkout origin does not match ${target.owner}/${target.repo}. Refusing to create an issue patch from the wrong repository.`);
  const { issue, defaultBranch } = await fetchIssue(target);
  const policy = await loadPolicy(repositoryRoot);
  const profile = await loadAgentProfile(repositoryRoot, options.agent);
  const headSha = git(repositoryRoot, ["rev-parse", "HEAD"]);
  const criteria = issue.acceptanceCriteria.length ? issue.acceptanceCriteria : [`Implement the requirements described by ${issue.key}.`];
  const retrieval = await retrieveLocalEvidence(repositoryRoot, headSha, `${issue.summary}\n${issue.description}`, options.retrievalTopK ?? policy.retrievalTopK ?? 10);
  const ref = { owner: target.owner, repo: target.repo, number: 0, url: `https://github.com/${target.owner}/${target.repo}`, provider: "github" as const };
  const context: PullRequestContext = { ref, title: issue.summary, body: issue.description, headSha, baseSha: headSha, baseBranch: defaultBranch, files: [], checks: [], commits: [], discussion: [], sources: new Set([issue.url, ...retrieval.chunks.map((chunk) => chunk.url)]), repositoryEvidence: retrieval.chunks, issues: [issue], customInstructions: combineInstructions(policy.instructions, profile) };
  const providerName = (options.provider || policy.provider || process.env.MERGEPROOF_PROVIDER || "openai").toLowerCase();
  const selectedModel = model || policy.model || (providerName === "anthropic" ? process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514" : process.env.OPENAI_MODEL || "gpt-5.6");
  const provider = createModelProvider(selectedModel, providerName as Parameters<typeof createModelProvider>[1]);
  const result = await provider.task(context, criteria, AbortSignal.timeout(60_000));
  const patch = normalizePatch(result.patch);
  const changedPaths = patch ? validatePatchPaths(patch) : [];
  const baseTrace = { model: provider.name, issueUrl: target.url, headSha, changedPaths, evidenceSources: retrieval.chunks.length + 1, sandboxed: true as const };
  if (!patch) return { summary: result.summary, patch: "", trace: { ...baseTrace, appliedToSandbox: false, verified: false } };

  const sandbox = await mkdtemp(join(tmpdir(), "mergeproof-task-"));
  let branch: string | undefined;
  let verified = false;
  let verificationOutput = "";
  let reReviewDecision: string | undefined;
  let reReviewPassed: boolean | undefined;
  let pullRequestUrl: string | undefined;
  try {
    git(repositoryRoot, ["worktree", "add", "--detach", sandbox, headSha]);
    if (options.createPr) {
      branch = safeBranch(options.branch || `mergeproof/issue-${target.number}-${Date.now()}`);
      git(sandbox, ["checkout", "-b", branch]);
    }
    git(sandbox, ["apply", "--check", "--whitespace=error"], patch);
    git(sandbox, ["apply", "--whitespace=error"], patch);
    if (options.verify) {
      try { verificationOutput = runVerificationCommand(sandbox, options.verify); verified = true; } catch (error) { verificationOutput = error instanceof Error ? error.message : "Verification failed."; }
    } else verified = true;
    if (options.reReview) {
      if (!verified) { reReviewPassed = false; reReviewDecision = "needs-evidence"; }
      else {
        const review = await reviewWorkingTree(model, { repoPath: sandbox, provider: options.provider, criteria, agent: options.agent });
        reReviewDecision = review.decision;
        reReviewPassed = review.decision === "ready";
      }
    }
    if (options.createPr) {
      await assertPermission(repositoryRoot, "publish", { paths: changedPaths, verified });
      if (!verified || options.reReview && !reReviewPassed) throw new Error("Refusing to create a PR because verification or re-review did not pass.");
      git(sandbox, ["add", "-A"]);
      git(sandbox, ["config", "user.name", "MergeProof Task Agent"]);
      git(sandbox, ["config", "user.email", "mergeproof-task@users.noreply.github.com"]);
      git(sandbox, ["commit", "-m", `Implement GitHub issue #${target.number}`]);
      git(sandbox, ["push", "--set-upstream", "origin", branch!]);
      const owner = ownerFromRemote(repositoryRoot, target.owner);
      const body = [`This pull request was created by an explicit MergeProof issue-agent request.`, ``, `- Source issue: ${target.url}`, `- Implemented from repository evidence at ${headSha}`, `- Evidence sources: ${baseTrace.evidenceSources}`, `- Verification: ${options.verify ?? "patch application only"}`, options.reReview ? `- Evidence re-review: ${reReviewDecision}` : "", ``, `The original working tree was never modified.`].filter(Boolean).join("\n");
      const client = await createGithubClient(true);
      const created = await client.rest.pulls.create({ owner: target.owner, repo: target.repo, title: `MergeProof: ${issue.summary}`, head: owner === target.owner ? branch! : `${owner}:${branch!}`, base: defaultBranch, body });
      pullRequestUrl = created.data.html_url;
    }
  } finally {
    try { git(repositoryRoot, ["worktree", "remove", "--force", sandbox]); } catch { /* cleanup is best effort */ }
    await rm(sandbox, { recursive: true, force: true });
  }
  return { summary: result.summary, patch, trace: { ...baseTrace, appliedToSandbox: true, verified, ...(options.verify ? { verificationCommand: options.verify, verificationOutput } : {}), ...(options.reReview ? { reReviewDecision, reReviewPassed } : {}), ...(branch ? { branch } : {}), ...(pullRequestUrl ? { pullRequestUrl } : {}) } };
}
