import { z } from "zod";
import { createGithubClient } from "./github-auth";
import type { CustomCheck, EvidenceChunk, LinkedIssue, ReviewMemoryEntry, SecurityFinding, ReviewThread } from "./types";
import type { KnowledgeFact } from "./knowledge";
import type { ReviewEffort, ReviewProfile } from "./types";
import { fetchGithubReviewThreads } from "./github-threads";

const pullRequestUrlSchema = z.string().url().regex(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+\/?$/i, "Expected a GitHub pull request URL");

export type PullRequestRef = { owner: string; repo: string; number: number; url: string; provider?: "github" | "gitlab" | "bitbucket" | "azure-devops" };
export type PullRequestContext = {
  ref: PullRequestRef;
  title: string;
  body: string;
  headSha: string;
  baseSha: string;
  files: Array<{ path: string; patch: string; status: string; additions: number; deletions: number; url: string }>;
  checks: Array<{ name: string; status: string; conclusion: string | null; url: string; details?: string }>;
  commits?: Array<{ sha: string; message: string; url: string }>;
  discussion?: Array<{ author: string; body: string; url: string }>;
  reviewThreads?: ReviewThread[];
  reviewThreadsUnavailable?: string;
  baseBranch?: string;
  headBranch?: string;
  headOwner?: string;
  headRepo?: string;
  sources: Set<string>;
  repositoryEvidence?: EvidenceChunk[];
  issues?: LinkedIssue[];
  customInstructions?: string;
  customChecks?: CustomCheck[];
  securityFindings?: SecurityFinding[];
  qualitySignals?: SecurityFinding[];
  suggestedReviewers?: string[];
  reviewMemory?: ReviewMemoryEntry[];
  knowledge?: KnowledgeFact[];
  reviewEffort?: ReviewEffort;
  reviewProfile?: ReviewProfile;
  sourceCommits?: Set<string>;
};

export function parsePullRequestUrl(value: string): PullRequestRef {
  const url = pullRequestUrlSchema.parse(value).replace(/\/$/, "");
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)$/i);
  if (!match) throw new Error("Expected a GitHub pull request URL");
  return { owner: match[1], repo: match[2], number: Number(match[3]), url };
}

export async function fetchPullRequest(ref: PullRequestRef): Promise<PullRequestContext> {
  const octokit = await createGithubClient();
  const pull = await octokit.rest.pulls.get({ owner: ref.owner, repo: ref.repo, pull_number: ref.number });
  const [files, checks, commits, issueComments, reviewComments, threadReport] = await Promise.all([
    octokit.paginate(octokit.rest.pulls.listFiles, { owner: ref.owner, repo: ref.repo, pull_number: ref.number, per_page: 100 }),
    octokit.rest.checks.listForRef({ owner: ref.owner, repo: ref.repo, ref: pull.data.head.sha, per_page: 100 }).catch(() => ({ data: { check_runs: [] } })),
    octokit.paginate(octokit.rest.pulls.listCommits, { owner: ref.owner, repo: ref.repo, pull_number: ref.number, per_page: 100 }).catch(() => []),
    octokit.paginate(octokit.rest.issues.listComments, { owner: ref.owner, repo: ref.repo, issue_number: ref.number, per_page: 100 }).catch(() => []),
    octokit.paginate(octokit.rest.pulls.listReviewComments, { owner: ref.owner, repo: ref.repo, pull_number: ref.number, per_page: 100 }).catch(() => []),
    fetchGithubReviewThreads(ref).catch((error) => ({ threads: [], sources: [], unavailable: error instanceof Error ? error.message : "Review-thread access failed." })),
  ]);
  const sources = new Set<string>();
  const filesData = files.map((file) => {
    const url = file.blob_url ?? `${ref.url}/files`;
    sources.add(url);
    return { path: file.filename, patch: file.patch ?? "(binary or patch unavailable)", status: file.status, additions: file.additions, deletions: file.deletions, url };
  });
  const checkData = await Promise.all(checks.data.check_runs.slice(0, 100).map(async (check) => {
    const details = [check.output?.title, check.output?.summary, check.output?.text].filter(Boolean).join("\n");
    let annotations = "";
    if (check.conclusion && !["success", "neutral", "skipped"].includes(check.conclusion.toLowerCase())) {
      try {
        const values = await octokit.paginate(octokit.rest.checks.listAnnotations, { owner: ref.owner, repo: ref.repo, check_run_id: check.id, per_page: 100 });
        annotations = values.slice(0, 100).map((annotation) => `${annotation.path ?? "unknown"}:${annotation.start_line ?? "?"} ${annotation.annotation_level ?? "warning"}: ${annotation.message ?? ""}`).join("\n");
      } catch {
        // Check annotations are optional and may not be available to the token.
      }
    }
    return { name: check.name, status: check.status, conclusion: check.conclusion, url: check.html_url ?? ref.url, details: [details, annotations].filter(Boolean).join("\n").slice(0, 12_000) || undefined };
  }));
  checkData.forEach((check) => sources.add(check.url));
  const commitData = commits.slice(0, 100).map((commit) => ({ sha: commit.sha, message: commit.commit.message.slice(0, 2000), url: commit.html_url ?? `${ref.url}/commits/${commit.sha}` }));
  commitData.forEach((commit) => sources.add(commit.url));
  const discussion = [...issueComments.map((comment) => ({ author: comment.user?.login ?? "unknown", body: (comment.body ?? "").slice(0, 4000), url: comment.html_url ?? ref.url })), ...reviewComments.map((comment) => ({ author: comment.user?.login ?? "unknown", body: (comment.body ?? "").slice(0, 4000), url: comment.html_url ?? ref.url }))].slice(0, 100);
  discussion.forEach((comment) => sources.add(comment.url));
  threadReport.sources.forEach((source) => sources.add(source));
  sources.add(ref.url);
  return { ref, title: pull.data.title, body: pull.data.body ?? "", headSha: pull.data.head.sha, baseSha: pull.data.base.sha, baseBranch: pull.data.base.ref, headBranch: pull.data.head.ref, headOwner: pull.data.head.repo?.owner?.login ?? undefined, headRepo: pull.data.head.repo?.name ?? undefined, files: filesData, checks: checkData, commits: commitData, discussion, reviewThreads: threadReport.threads, ...(threadReport.unavailable ? { reviewThreadsUnavailable: threadReport.unavailable } : {}), sources, repositoryEvidence: [], issues: [] };
}
