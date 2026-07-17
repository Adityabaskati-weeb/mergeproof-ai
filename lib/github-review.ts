import { fetchPullRequest, parsePullRequestUrl } from "./github";
import { createGithubClient } from "./github-auth";
import type { Analysis } from "./types";
import { shouldPublishFinding } from "./profile";

function lineFromCitation(url: string): number {
  return Number(url.match(/#L(\d+)/)?.[1] ?? 1);
}

export async function publishPullRequestReview(prUrl: string, analysis: Analysis): Promise<string | undefined> {
  const ref = parsePullRequestUrl(prUrl);
  const context = await fetchPullRequest(ref);
  const changedPaths = new Set(context.files.map((file) => file.path));
  const profile = analysis.trace.reviewProfile ?? "chill";
  const rows = profile === "quiet" ? analysis.rows.filter((row) => row.state !== "pass") : analysis.rows;
  const comments = rows.flatMap((row) => row.citations.slice(0, 1).filter((citation) => changedPaths.has(citation.path)).map((citation) => ({ path: citation.path, line: lineFromCitation(citation.url), side: "RIGHT" as const, body: `**${row.state.toUpperCase()}**: ${row.evidence}\n\nEvidence: ${citation.url}` })));
  comments.push(...(analysis.securityFindings ?? []).filter((finding) => changedPaths.has(finding.path) && shouldPublishFinding(profile, finding.severity, finding.category)).map((finding) => ({ path: finding.path, line: finding.line, side: "RIGHT" as const, body: `**${(finding.category === "privacy" ? "PRIVACY" : "SECURITY")} ${finding.severity.toUpperCase()}**: ${finding.title}\n\n${finding.detail}\n\nEvidence: ${finding.citation.url}` })));
  comments.push(...(analysis.qualitySignals ?? []).filter((finding) => changedPaths.has(finding.path) && shouldPublishFinding(profile, finding.severity, finding.category)).map((finding) => ({ path: finding.path, line: finding.line, side: "RIGHT" as const, body: `**QUALITY ${finding.severity.toUpperCase()}**: ${finding.title}\n\n${finding.detail}\n\nEvidence: ${finding.citation.url}` })));
  const event = analysis.decision === "ready" ? "APPROVE" : analysis.decision === "needs-evidence" ? "REQUEST_CHANGES" : "COMMENT";
  const security = (analysis.securityFindings ?? []).map((finding) => `- **${finding.severity.toUpperCase()}** ${finding.path}:${finding.line} ${finding.title}`).join("\n");
  const quality = (analysis.qualitySignals ?? []).map((finding) => `- **${finding.severity.toUpperCase()}** ${finding.path}:${finding.line} ${finding.title}`).join("\n");
  const body = `MergeProof decision: **${analysis.decision}**\n\n${security ? `Security/privacy findings:\n${security}\n\n` : ""}${quality ? `Quality signals:\n${quality}\n\n` : ""}${rows.map((row) => `- **${row.state.toUpperCase()}** ${row.criterion}`).join("\n")}\n\nProfile: ${profile} | Verified citations: ${analysis.trace.citedSources}`;
  const octokit = await createGithubClient(true);
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
  const ref = parsePullRequestUrl(prUrl);
  const octokit = await createGithubClient(true);
  const response = await octokit.rest.issues.createComment({ owner: ref.owner, repo: ref.repo, issue_number: ref.number, body });
  return response.data.html_url ?? undefined;
}

export async function requestPullRequestReviewers(prUrl: string, reviewers: string[]): Promise<string> {
  const ref = parsePullRequestUrl(prUrl);
  const normalized = reviewers.map((reviewer) => reviewer.replace(/^@/, "").trim()).filter(Boolean);
  const users = normalized.filter((reviewer) => !reviewer.startsWith("team:"));
  const teams = normalized.filter((reviewer) => reviewer.startsWith("team:")).map((reviewer) => reviewer.slice("team:".length)).filter(Boolean);
  if (!users.length && !teams.length) throw new Error("At least one GitHub username or team:<slug> reviewer is required.");
  const octokit = await createGithubClient(true);
  await octokit.rest.pulls.requestReviewers({ owner: ref.owner, repo: ref.repo, pull_number: ref.number, ...(users.length ? { reviewers: users } : {}), ...(teams.length ? { team_reviewers: teams } : {}) });
  return ref.url;
}
