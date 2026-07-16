import { Octokit } from "@octokit/rest";
import { fetchPullRequest, parsePullRequestUrl } from "./github";
import type { Analysis } from "./types";

type CheckAnnotation = { path: string; start_line: number; end_line: number; annotation_level: "warning" | "failure"; title: string; message: string };

export async function publishPullRequestCheck(prUrl: string, analysis: Analysis): Promise<string | undefined> {
  if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is required to publish a GitHub Check.");
  const ref = parsePullRequestUrl(prUrl);
  const context = await fetchPullRequest(ref);
  const conclusion = analysis.decision === "ready" ? "success" : analysis.decision === "needs-owner" ? "neutral" : "failure";
  const annotations: CheckAnnotation[] = analysis.rows.flatMap((row) => row.citations.slice(0, 1).map((citation): CheckAnnotation => {
    const line = Number(citation.url.match(/#L(\d+)/)?.[1] ?? 1);
    return { path: citation.path, start_line: line, end_line: line, annotation_level: row.state === "fail" ? "failure" : "warning", title: `MergeProof: ${row.state}`, message: `${row.criterion}: ${row.evidence}` };
  })).slice(0, 50);
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  try {
    const response = await octokit.rest.checks.create({ owner: ref.owner, repo: ref.repo, name: "MergeProof evidence gate", head_sha: context.headSha, status: "completed", conclusion, details_url: ref.url, output: { title: `MergeProof: ${analysis.decision}`, summary: `${analysis.rows.length} criteria evaluated. ${analysis.trace.citedSources} citations verified.`, text: analysis.rows.map((row) => `- **${row.state.toUpperCase()}** ${row.criterion}: ${row.evidence}`).join("\n"), annotations } });
    return response.data.html_url ?? undefined;
  } catch (error) {
    if (!(error instanceof Error) || !/403|forbidden|check/i.test(error.message)) throw error;
    const status = analysis.decision === "ready" ? "success" : analysis.decision === "needs-owner" ? "failure" : "failure";
    await octokit.rest.repos.createCommitStatus({ owner: ref.owner, repo: ref.repo, sha: context.headSha, state: status, context: "MergeProof evidence gate", description: `MergeProof: ${analysis.decision}` });
    return ref.url;
  }
}
