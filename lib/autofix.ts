import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fetchChangeRequest, parseChangeRequestUrl } from "./change-request";
import { createGithubClient } from "./github-auth";
import { fixPullRequest, type FixOptions } from "./fix";
import { reviewWorkingTree } from "./local-review";
import { runVerificationCommand, type VerificationCommand } from "./local-agent";

export type AutofixOptions = FixOptions & { verify?: VerificationCommand; reReview?: boolean; createPr?: boolean; branch?: string; threadIds?: string[] };
export type AutofixResult = {
  summary: string;
  patch: string;
  trace: {
    model: string;
    headSha: string;
    changedPaths: string[];
    unresolvedThreads: number;
    sandboxed: true;
    verified: boolean;
    verificationCommand?: VerificationCommand;
    verificationOutput?: string;
    reReviewDecision?: string;
    reReviewPassed?: boolean;
    branch?: string;
    pullRequestUrl?: string;
  };
};

function git(root: string, args: string[], input?: string): string {
  return execFileSync("git", args, { cwd: root, input, encoding: "utf8", stdio: input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"] }).toString().trim();
}

function ownerFromRemote(root: string, fallback: string): string {
  try {
    const remote = git(root, ["config", "--get", "remote.origin.url"]);
    return remote.match(/github\.com[/:]([^/]+)\//i)?.[1] ?? fallback;
  } catch {
    return fallback;
  }
}

async function createGitlabMergeRequest(target: Awaited<ReturnType<typeof parseChangeRequestUrl>>, context: Awaited<ReturnType<typeof fetchChangeRequest>>, branch: string, body: string): Promise<string> {
  const url = new URL(target.ref.url);
  const base = (process.env.GITLAB_API_URL || `${url.origin}/api/v4`).replace(/\/$/, "");
  const project = encodeURIComponent(`${target.ref.owner}/${target.ref.repo}`);
  const response = await fetch(`${base}/projects/${project}/merge_requests`, { method: "POST", headers: { "content-type": "application/json", ...(process.env.GITLAB_TOKEN ? { "PRIVATE-TOKEN": process.env.GITLAB_TOKEN } : {}) }, body: JSON.stringify({ source_branch: branch, target_branch: context.baseBranch ?? "main", title: `MergeProof autofix: ${context.title}`, description: body }) });
  if (!response.ok) throw new Error(`GitLab autofix merge-request creation failed with HTTP ${response.status}.`);
  const payload = await response.json() as { web_url?: string };
  return payload.web_url ?? target.ref.url;
}

export async function autofixPullRequest(prUrl: string, model?: string, options: AutofixOptions = {}): Promise<AutofixResult> {
  if (!options.repoPath) throw new Error("Autofix requires --repo so the target checkout is explicit.");
  const target = parseChangeRequestUrl(prUrl);
  if (target.provider !== "github" && target.provider !== "gitlab") throw new Error("Review-thread autofix currently supports GitHub pull requests and GitLab merge requests.");
  const context = await fetchChangeRequest(target);
  const localHead = git(options.repoPath, ["rev-parse", "HEAD"]);
  if (localHead !== context.headSha) throw new Error(`Checkout SHA ${localHead} does not match pull-request head ${context.headSha}. Refusing to autofix the wrong revision.`);
  const selectedThreads = context.reviewThreads?.filter((thread) => !thread.isResolved && !thread.isOutdated && (!options.threadIds?.length || options.threadIds.includes(thread.id))) ?? [];
  if (options.threadIds?.length && !selectedThreads.length) throw new Error("None of the selected review-thread IDs are unresolved and current.");
  const fix = await fixPullRequest(prUrl, model, { provider: options.provider, repoPath: options.repoPath, agent: options.agent, threadIds: options.threadIds, apply: false });
  const baseTrace = { model: fix.trace.model, headSha: fix.trace.headSha, changedPaths: fix.trace.changedPaths, unresolvedThreads: selectedThreads.length, sandboxed: true as const };
  if (!fix.patch) return { summary: fix.summary, patch: "", trace: { ...baseTrace, verified: false } };

  const sandbox = await mkdtemp(join(tmpdir(), "mergeproof-autofix-"));
  let branch: string | undefined;
  let verified = false;
  let verificationOutput = "";
  let reReviewDecision: string | undefined;
  let reReviewPassed: boolean | undefined;
  let pullRequestUrl: string | undefined;
  try {
    git(options.repoPath, ["worktree", "add", "--detach", sandbox, context.headSha]);
    if (options.createPr) {
      branch = options.branch?.trim() || `mergeproof/autofix-${Date.now()}`;
      if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith("-") || branch.includes("..")) throw new Error("Unsafe autofix branch name.");
      git(sandbox, ["checkout", "-b", branch]);
    }
    git(sandbox, ["apply", "--check", "--whitespace=error"], fix.patch);
    git(sandbox, ["apply", "--whitespace=error"], fix.patch);
    if (options.verify) {
      try {
        verificationOutput = runVerificationCommand(sandbox, options.verify);
        verified = true;
      } catch (error) {
        verificationOutput = error instanceof Error ? error.message : "Verification failed.";
      }
    } else {
      verified = true;
    }
    if (options.reReview) {
      if (!verified) {
        reReviewPassed = false;
        reReviewDecision = "needs-evidence";
      } else {
        const review = await reviewWorkingTree(model, { repoPath: sandbox, provider: options.provider, agent: options.agent });
        reReviewDecision = review.decision;
        reReviewPassed = review.decision === "ready";
      }
    }
    if (options.createPr) {
      if (!verified || options.reReview && !reReviewPassed) throw new Error("Refusing to create a PR because verification or re-review did not pass.");
      git(sandbox, ["add", "-A"]);
      git(sandbox, ["config", "user.name", "MergeProof Autofix"]);
      git(sandbox, ["config", "user.email", "mergeproof-autofix@users.noreply.github.com"]);
      git(sandbox, ["commit", "-m", "Apply verified MergeProof review-thread autofix"]);
      git(sandbox, ["push", "--set-upstream", "origin", branch!]);
      const body = [`This pull request was created by an explicit MergeProof autofix request.`, ``, `- Verified against ${context.headSha}`, `- Unresolved review threads addressed: ${baseTrace.unresolvedThreads}`, `- Verification: ${options.verify ?? "patch application only"}`, options.reReview ? `- Re-review: ${reReviewDecision}` : "", ``, `The original pull request branch was not modified.`].filter(Boolean).join("\n");
      if (target.provider === "github") {
        const client = await createGithubClient(true);
        const owner = ownerFromRemote(options.repoPath, target.ref.owner);
        const created = await client.rest.pulls.create({ owner: target.ref.owner, repo: target.ref.repo, title: `MergeProof autofix: ${context.title}`, head: owner === target.ref.owner ? branch! : `${owner}:${branch!}`, base: context.baseBranch ?? "main", body });
        pullRequestUrl = created.data.html_url;
      } else {
        pullRequestUrl = await createGitlabMergeRequest(target, context, branch!, body);
      }
    }
  } finally {
    try { git(options.repoPath, ["worktree", "remove", "--force", sandbox]); } catch { /* cleanup is best effort */ }
    await rm(sandbox, { recursive: true, force: true });
  }
  return { summary: fix.summary, patch: fix.patch, trace: { ...baseTrace, verified, ...(options.verify ? { verificationCommand: options.verify, verificationOutput } : {}), ...(options.reReview ? { reReviewDecision, reReviewPassed } : {}), ...(branch ? { branch } : {}), ...(pullRequestUrl ? { pullRequestUrl } : {}) } };
}
