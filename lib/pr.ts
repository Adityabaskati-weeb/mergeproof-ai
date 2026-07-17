import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { assertPermission } from "./permissions";
import { createGithubClient } from "./github-auth";
import { fetchPullRequest } from "./github";
import { runVerificationCommand, type VerificationCommand } from "./local-agent";
import type { PullRequestRef } from "./github";

export type GithubRemote = { owner: string; repo: string };

export type PullRequestView = {
  url: string;
  title: string;
  state: string;
  merged: boolean;
  draft: boolean;
  headSha: string;
  baseSha: string;
  baseBranch: string;
  headBranch: string;
  author: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewComments: number;
  checks: number;
  unresolvedReviewThreads: number;
};

export type CreatePullRequestOptions = {
  repoPath: string;
  title: string;
  body?: string;
  base?: string;
  draft?: boolean;
  verify?: VerificationCommand;
  reviewers?: string[];
};

export type CreatedPullRequest = {
  url: string;
  number: number;
  owner: string;
  repo: string;
  head: string;
  base: string;
  verified: boolean;
  verificationOutput?: string;
};

function git(root: string, args: string[], input?: string): string {
  return execFileSync("git", args, { cwd: root, input, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, stdio: input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"] }).toString().trim();
}

export function parseGithubRemote(value: string): GithubRemote {
  const normalized = value.trim().replace(/\.git$/, "");
  const match = normalized.match(/github\.com[/:]([^/]+)\/([^/]+)$/i);
  if (!match) throw new Error("The origin remote must point to github.com/owner/repo.");
  const owner = match[1].trim();
  const repo = match[2].trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("The GitHub origin remote contains an unsafe owner or repository name.");
  return { owner, repo };
}

function parseReviewers(reviewers: string[] | undefined): { users: string[]; teams: string[] } {
  const values = [...new Set((reviewers ?? []).map((value) => value.replace(/^@/, "").trim()).filter(Boolean))].slice(0, 20);
  const users = values.filter((value) => !value.startsWith("team:"));
  const teams = values.filter((value) => value.startsWith("team:")).map((value) => value.slice("team:".length)).filter((value) => /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(value));
  if (values.length && users.length === 0 && teams.length === 0) throw new Error("Reviewers must be GitHub usernames or team:<slug> values.");
  if (users.some((value) => !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(value))) throw new Error("Reviewer usernames contain an unsafe value.");
  return { users, teams };
}

export async function viewPullRequest(ref: PullRequestRef): Promise<PullRequestView> {
  const client = await createGithubClient();
  const pull = await client.rest.pulls.get({ owner: ref.owner, repo: ref.repo, pull_number: ref.number });
  const context = await fetchPullRequest(ref);
  return {
    url: pull.data.html_url ?? ref.url,
    title: pull.data.title,
    state: pull.data.state,
    merged: Boolean(pull.data.merged_at),
    draft: Boolean(pull.data.draft),
    headSha: pull.data.head.sha,
    baseSha: pull.data.base.sha,
    baseBranch: pull.data.base.ref,
    headBranch: pull.data.head.ref,
    author: pull.data.user?.login ?? "unknown",
    additions: pull.data.additions,
    deletions: pull.data.deletions,
    changedFiles: pull.data.changed_files,
    reviewComments: pull.data.review_comments,
    checks: context.checks.length,
    unresolvedReviewThreads: context.reviewThreads?.filter((thread) => !thread.isResolved && !thread.isOutdated).length ?? 0,
  };
}

export async function createPullRequest(options: CreatePullRequestOptions): Promise<CreatedPullRequest> {
  const root = resolve(options.repoPath);
  const title = options.title.trim();
  if (!title || title.length > 256) throw new Error("A pull-request title between 1 and 256 characters is required.");
  if (options.body && options.body.length > 50_000) throw new Error("The pull-request body must be at most 50,000 characters.");
  const branch = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith("-") || branch.includes("..")) throw new Error("The current branch name is unsafe for publication.");
  if (git(root, ["status", "--porcelain"])) throw new Error("The checkout must be clean before creating a pull request.");
  const remote = parseGithubRemote(git(root, ["config", "--get", "remote.origin.url"]));
  const client = await createGithubClient(true);
  const repository = await client.rest.repos.get({ owner: remote.owner, repo: remote.repo });
  const base = (options.base?.trim() || repository.data.default_branch || "main").replace(/^refs\/heads\//, "");
  if (!/^[A-Za-z0-9._/-]+$/.test(base) || base.startsWith("-") || base.includes("..")) throw new Error("The base branch contains an unsafe value.");
  let verificationOutput: string | undefined;
  if (options.verify) verificationOutput = runVerificationCommand(root, options.verify);
  await assertPermission(root, "publish", { verified: true });
  git(root, ["push", "--set-upstream", "origin", branch]);
  const created = await client.rest.pulls.create({ owner: remote.owner, repo: remote.repo, title, body: options.body ?? "", head: branch, base, draft: options.draft === true });
  const reviewerSet = parseReviewers(options.reviewers);
  if (reviewerSet.users.length || reviewerSet.teams.length) await client.rest.pulls.requestReviewers({ owner: remote.owner, repo: remote.repo, pull_number: created.data.number, ...(reviewerSet.users.length ? { reviewers: reviewerSet.users } : {}), ...(reviewerSet.teams.length ? { team_reviewers: reviewerSet.teams } : {}) });
  return { url: created.data.html_url ?? `https://github.com/${remote.owner}/${remote.repo}/pull/${created.data.number}`, number: created.data.number, owner: remote.owner, repo: remote.repo, head: branch, base, verified: Boolean(options.verify), ...(verificationOutput ? { verificationOutput } : {}) };
}
