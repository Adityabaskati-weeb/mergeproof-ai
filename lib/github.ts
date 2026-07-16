import { Octokit } from "@octokit/rest";
import { z } from "zod";

const pullRequestUrlSchema = z.string().url().regex(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+\/?$/i, "Expected a GitHub pull request URL");

export type PullRequestRef = { owner: string; repo: string; number: number; url: string };
export type PullRequestContext = {
  ref: PullRequestRef;
  title: string;
  body: string;
  headSha: string;
  baseSha: string;
  files: Array<{ path: string; patch: string; status: string; additions: number; deletions: number; url: string }>;
  checks: Array<{ name: string; status: string; conclusion: string | null; url: string }>;
  sources: Set<string>;
};

export function parsePullRequestUrl(value: string): PullRequestRef {
  const url = pullRequestUrlSchema.parse(value).replace(/\/$/, "");
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)$/i);
  if (!match) throw new Error("Expected a GitHub pull request URL");
  return { owner: match[1], repo: match[2], number: Number(match[3]), url };
}

export async function fetchPullRequest(ref: PullRequestRef): Promise<PullRequestContext> {
  const octokit = new Octokit(process.env.GITHUB_TOKEN ? { auth: process.env.GITHUB_TOKEN } : undefined);
  const pull = await octokit.rest.pulls.get({ owner: ref.owner, repo: ref.repo, pull_number: ref.number });
  const [files, checks] = await Promise.all([
    octokit.paginate(octokit.rest.pulls.listFiles, { owner: ref.owner, repo: ref.repo, pull_number: ref.number, per_page: 100 }),
    octokit.rest.checks.listForRef({ owner: ref.owner, repo: ref.repo, ref: pull.data.head.sha, per_page: 100 }).catch(() => ({ data: { check_runs: [] } })),
  ]);
  const sources = new Set<string>();
  const filesData = files.map((file) => {
    const url = file.blob_url ?? `${ref.url}/files`;
    sources.add(url);
    return { path: file.filename, patch: file.patch ?? "(binary or patch unavailable)", status: file.status, additions: file.additions, deletions: file.deletions, url };
  });
  const checkData = checks.data.check_runs.map((check) => ({ name: check.name, status: check.status, conclusion: check.conclusion, url: check.html_url ?? ref.url }));
  checkData.forEach((check) => sources.add(check.url));
  sources.add(ref.url);
  return { ref, title: pull.data.title, body: pull.data.body ?? "", headSha: pull.data.head.sha, baseSha: pull.data.base.sha, files: filesData, checks: checkData, sources };
}
