import { fetchPullRequest, parsePullRequestUrl } from "./github";
import { createGithubClient } from "./github-auth";
import type { Analysis } from "./types";

export type GithubFollowUpDraft = { title: string; body: string; suggestedLabels: string[]; relatedUrls: string[] };

export function buildGithubFollowUpDraft(prUrl: string, analysis: Analysis, headSha: string, title?: string): GithubFollowUpDraft {
  const security = (analysis.securityFindings ?? []).map((finding) => `- **Security ${finding.severity}** ${finding.path}:${finding.line}: ${finding.title} - ${finding.detail}`).join("\n");
  const criteria = analysis.rows.filter((row) => row.state !== "pass").map((row) => `- **${row.state.toUpperCase()}** ${row.criterion}: ${row.evidence}`).join("\n");
  const relatedUrls = (analysis.walkthrough?.relatedIssues ?? []).map((issue) => issue.url).filter(Boolean);
  const suggestedLabels = [
    "mergeproof",
    `mergeproof:${analysis.decision}`,
    ...(analysis.securityFindings?.length ? ["security"] : []),
    ...(analysis.qualitySignals?.length ? ["quality"] : []),
  ];
  const related = relatedUrls.length ? `\n## Related issues\n${relatedUrls.map((url) => `- ${url}`).join("\n")}` : "";
  const labelHint = `\nSuggested labels: ${suggestedLabels.map((label) => `\`${label}\``).join(", ")}`;
  const description = [`MergeProof follow-up for ${prUrl}`, `\nDecision: **${analysis.decision}**`, security ? `\n## Security findings\n${security}` : "", criteria ? `\n## Unresolved criteria\n${criteria}` : "", related, labelHint, `\nModel: ${analysis.trace.model}`, `Head SHA: ${headSha}`].filter(Boolean).join("\n");
  return { title: title || `MergeProof follow-up for ${prUrl}`, body: description, suggestedLabels, relatedUrls };
}

function configuredAssignees(): string[] {
  return (process.env.GITHUB_ISSUE_ASSIGNEES || "").split(",").map((value) => value.trim()).filter((value) => /^[A-Za-z0-9-]{1,39}$/.test(value)).slice(0, 10);
}

async function findExistingFollowUp(octokit: Awaited<ReturnType<typeof createGithubClient>>, owner: string, repo: string, title: string, prUrl: string): Promise<string | undefined> {
  if (process.env.GITHUB_ISSUE_ENRICHMENT === "false") return undefined;
  try {
    const response = await octokit.rest.search.issuesAndPullRequests({ q: `repo:${owner}/${repo} in:title "${title.replace(/"/g, "\\\"")}"`, per_page: 100 });
    const match = response.data.items.find((issue) => !issue.pull_request && issue.title === title && (issue.body ?? "").includes(prUrl));
    return match?.html_url;
  } catch {
    return undefined;
  }
}

async function existingLabels(octokit: Awaited<ReturnType<typeof createGithubClient>>, owner: string, repo: string, suggested: string[]): Promise<string[]> {
  const configured = process.env.GITHUB_ISSUE_LABEL;
  if (process.env.GITHUB_ISSUE_ENRICHMENT === "false") return configured ? [configured] : [];
  try {
    const response = await octokit.rest.issues.listLabelsForRepo({ owner, repo, per_page: 100 });
    const available = new Set(response.data.map((label) => label.name));
    return [...new Set([...(configured ? [configured] : []), ...suggested.filter((label) => available.has(label))])];
  } catch {
    return configured ? [configured] : [];
  }
}

export async function createGithubIssueFromAnalysis(prUrl: string, analysis: Analysis, title?: string): Promise<string> {
  const ref = parsePullRequestUrl(prUrl);
  const body = await fetchPullRequest(ref);
  const octokit = await createGithubClient(true);
  const draft = buildGithubFollowUpDraft(prUrl, analysis, analysis.trace.headSha ?? body.headSha, title || `MergeProof follow-up for PR #${ref.number}`);
  const existing = await findExistingFollowUp(octokit, ref.owner, ref.repo, draft.title, prUrl);
  if (existing) return existing;
  const labels = await existingLabels(octokit, ref.owner, ref.repo, draft.suggestedLabels);
  const assignees = configuredAssignees();
  const response = await octokit.rest.issues.create({ owner: ref.owner, repo: ref.repo, title: draft.title, body: draft.body, labels: labels.length ? labels : undefined, assignees: assignees.length ? assignees : undefined });
  return response.data.html_url ?? `${ref.url}#issue-${response.data.number}`;
}
