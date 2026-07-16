import { fetchPullRequest, parsePullRequestUrl } from "./github";
import { createGithubClient } from "./github-auth";
import type { Analysis } from "./types";

export async function createGithubIssueFromAnalysis(prUrl: string, analysis: Analysis, title?: string): Promise<string> {
  const ref = parsePullRequestUrl(prUrl);
  const body = await fetchPullRequest(ref);
  const security = (analysis.securityFindings ?? []).map((finding) => `- **Security ${finding.severity}** ${finding.path}:${finding.line}: ${finding.title} - ${finding.detail}`).join("\n");
  const criteria = analysis.rows.filter((row) => row.state !== "pass").map((row) => `- **${row.state.toUpperCase()}** ${row.criterion}: ${row.evidence}`).join("\n");
  const description = [`MergeProof follow-up for [#${ref.number}](${prUrl})`, `\nDecision: **${analysis.decision}**`, security ? `\n## Security findings\n${security}` : "", criteria ? `\n## Unresolved criteria\n${criteria}` : "", `\nModel: ${analysis.trace.model}`, `Head SHA: ${analysis.trace.headSha ?? body.headSha}`].filter(Boolean).join("\n");
  const octokit = await createGithubClient(true);
  const response = await octokit.rest.issues.create({ owner: ref.owner, repo: ref.repo, title: title || `MergeProof follow-up for PR #${ref.number}`, body: description, labels: process.env.GITHUB_ISSUE_LABEL ? [process.env.GITHUB_ISSUE_LABEL] : undefined });
  return response.data.html_url ?? `${ref.url}#issue-${response.data.number}`;
}
