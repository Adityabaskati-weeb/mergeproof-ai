import { Octokit } from "@octokit/rest";
import { fetchPullRequest, parsePullRequestUrl } from "./github";
import type { Analysis } from "./types";

function lineFromCitation(url: string): number {
  return Number(url.match(/#L(\d+)/)?.[1] ?? 1);
}

export async function publishPullRequestReview(prUrl: string, analysis: Analysis): Promise<string | undefined> {
  if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is required to publish a pull-request review.");
  const ref = parsePullRequestUrl(prUrl);
  const context = await fetchPullRequest(ref);
  const changedPaths = new Set(context.files.map((file) => file.path));
  const comments = analysis.rows.flatMap((row) => row.citations.slice(0, 1).filter((citation) => changedPaths.has(citation.path)).map((citation) => ({ path: citation.path, line: lineFromCitation(citation.url), side: "RIGHT" as const, body: `**${row.state.toUpperCase()}**: ${row.evidence}\n\nEvidence: ${citation.url}` })));
  comments.push(...(analysis.securityFindings ?? []).filter((finding) => changedPaths.has(finding.path)).map((finding) => ({ path: finding.path, line: finding.line, side: "RIGHT" as const, body: `**SECURITY ${finding.severity.toUpperCase()}**: ${finding.title}\n\n${finding.detail}\n\nEvidence: ${finding.citation.url}` })));
  const event = analysis.decision === "ready" ? "APPROVE" : analysis.decision === "needs-evidence" ? "REQUEST_CHANGES" : "COMMENT";
  const security = (analysis.securityFindings ?? []).map((finding) => `- **${finding.severity.toUpperCase()}** ${finding.path}:${finding.line} ${finding.title}`).join("\n");
  const body = `MergeProof decision: **${analysis.decision}**\n\n${security ? `Security findings:\n${security}\n\n` : ""}${analysis.rows.map((row) => `- **${row.state.toUpperCase()}** ${row.criterion}`).join("\n")}\n\nVerified citations: ${analysis.trace.citedSources}`;
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  try {
    const response = await octokit.rest.pulls.createReview({ owner: ref.owner, repo: ref.repo, pull_number: ref.number, commit_id: context.headSha, body, event, comments: comments.slice(0, 50) });
    return response.data.html_url ?? undefined;
  } catch (error) {
    if (!(error instanceof Error) || !/422|line|diff/i.test(error.message)) throw error;
    const response = await octokit.rest.issues.createComment({ owner: ref.owner, repo: ref.repo, issue_number: ref.number, body });
    return response.data.html_url ?? undefined;
  }
}

export async function publishPullRequestComment(prUrl: string, body: string): Promise<string | undefined> {
  if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is required to publish a pull-request comment.");
  const ref = parsePullRequestUrl(prUrl);
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const response = await octokit.rest.issues.createComment({ owner: ref.owner, repo: ref.repo, issue_number: ref.number, body });
  return response.data.html_url ?? undefined;
}
