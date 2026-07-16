import type { ReviewThread } from "./types";
import type { PullRequestRef } from "./github";
import { resolveGithubToken } from "./github-auth";

const QUERY = `query($owner:String!,$repo:String!,$number:Int!) {
  repository(owner:$owner,name:$repo) {
    pullRequest(number:$number) {
      reviewThreads(first:100) {
        nodes {
          id isResolved isOutdated path line originalLine
          comments(first:20) { nodes { body url createdAt author { login } } }
        }
      }
    }
  }
}`;

type GraphqlPayload = {
  data?: { repository?: { pullRequest?: { reviewThreads?: { nodes?: Array<{
    id?: string; isResolved?: boolean; isOutdated?: boolean; path?: string | null; line?: number | null; originalLine?: number | null;
    comments?: { nodes?: Array<{ body?: string; url?: string; createdAt?: string; author?: { login?: string } | null }> };
  } | null> } } } };
  errors?: Array<{ message?: string }>;
};

export type ReviewThreadReport = { threads: ReviewThread[]; sources: string[]; unavailable?: string };

export async function fetchGithubReviewThreads(ref: PullRequestRef): Promise<ReviewThreadReport> {
  const token = await resolveGithubToken(false, true);
  if (!token) return { threads: [], sources: [], unavailable: "No GitHub token available for review-thread access." };
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { accept: "application/vnd.github+json", "content-type": "application/json", authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ query: QUERY, variables: { owner: ref.owner, repo: ref.repo, number: ref.number } }),
  });
  if (!response.ok) return { threads: [], sources: [], unavailable: `GitHub review-thread query failed with HTTP ${response.status}.` };
  const payload = await response.json() as GraphqlPayload;
  if (payload.errors?.length) return { threads: [], sources: [], unavailable: payload.errors.map((error) => error.message ?? "GraphQL error").join("; ") };
  const threads: ReviewThread[] = [];
  const sources = new Set<string>();
  for (const node of payload.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []) {
    if (!node?.id) continue;
    const comments = (node.comments?.nodes ?? []).filter((comment) => comment?.body && comment?.url).slice(0, 20).map((comment) => ({ author: comment.author?.login ?? "unknown", body: comment.body!.slice(0, 4000), url: comment.url!, ...(comment.createdAt ? { createdAt: comment.createdAt } : {}) }));
    const url = comments[0]?.url ?? ref.url;
    sources.add(url);
    comments.forEach((comment) => sources.add(comment.url));
    threads.push({ id: node.id, path: node.path ?? "unknown", ...(node.line != null ? { line: node.line } : {}), ...(node.originalLine != null ? { originalLine: node.originalLine } : {}), isResolved: Boolean(node.isResolved), isOutdated: Boolean(node.isOutdated), comments, url });
  }
  return { threads, sources: [...sources] };
}
