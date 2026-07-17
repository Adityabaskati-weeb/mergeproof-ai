import { fetchChangeRequest, parseChangeRequestUrl, type ChangeRequestTarget } from "./change-request";
import type { Analysis } from "./types";
import { publishPullRequestCheck, type CheckPublicationOptions } from "./github-publish";
import { publishPullRequestComment, publishPullRequestReview, type ReviewPublicationOptions } from "./github-review";

function authHeaders(provider: ChangeRequestTarget["provider"]): Record<string, string> {
  if (provider === "gitlab" && process.env.GITLAB_TOKEN) return { "PRIVATE-TOKEN": process.env.GITLAB_TOKEN };
  if (provider === "bitbucket" && process.env.BITBUCKET_TOKEN) return { authorization: `Bearer ${process.env.BITBUCKET_TOKEN}` };
  if (provider === "bitbucket" && process.env.BITBUCKET_USERNAME && process.env.BITBUCKET_APP_PASSWORD) return { authorization: `Basic ${Buffer.from(`${process.env.BITBUCKET_USERNAME}:${process.env.BITBUCKET_APP_PASSWORD}`).toString("base64")}` };
  if (provider === "azure-devops" && process.env.AZURE_DEVOPS_TOKEN) return { authorization: `Basic ${Buffer.from(`:${process.env.AZURE_DEVOPS_TOKEN}`).toString("base64")}` };
  return {};
}

function bodyFor(analysis: Analysis): string {
  const security = (analysis.securityFindings ?? []).map((finding) => `- **SECURITY ${finding.severity.toUpperCase()}** ${finding.path}:${finding.line}: ${finding.title}`).join("\n");
  return [`MergeProof decision: **${analysis.decision}**`, security ? `\nSecurity findings:\n${security}` : "", "\nEvidence matrix", ...analysis.rows.map((row) => `- **${row.state.toUpperCase()}** ${row.criterion}: ${row.evidence}`), `\nVerified citations: ${analysis.trace.citedSources}`, analysis.trace.attestation ? `Attestation: ${analysis.trace.attestation.algorithm}:${analysis.trace.attestation.digest}` : ""].filter(Boolean).join("\n");
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, provider: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${provider} publication failed with HTTP ${response.status}.`);
  return await response.json().catch(() => ({})) as Record<string, unknown>;
}

function gitlabBase(target: ChangeRequestTarget): { base: string; project: string } {
  const url = new URL(target.ref.url);
  return { base: (process.env.GITLAB_API_URL || `${url.origin}/api/v4`).replace(/\/$/, ""), project: encodeURIComponent(`${target.ref.owner}/${target.ref.repo}`) };
}

function azureBase(target: ChangeRequestTarget): { base: string; repository: string } {
  const path = new URL(target.ref.url).pathname.split("/");
  const gitIndex = path.findIndex((segment) => segment.toLowerCase() === "_git");
  const project = encodeURIComponent(gitIndex > 0 ? path[gitIndex - 1] : path[1] ?? "");
  return { base: `https://dev.azure.com/${encodeURIComponent(target.ref.owner)}/${project}/_apis/git`, repository: encodeURIComponent(target.ref.repo) };
}

export type ChangeRequestPublicationOptions = ReviewPublicationOptions & CheckPublicationOptions;

export async function publishChangeRequestCheck(prUrl: string, analysis: Analysis, options: ChangeRequestPublicationOptions = {}): Promise<string | undefined> {
  const target = parseChangeRequestUrl(prUrl);
  if (target.provider === "github") return publishPullRequestCheck(prUrl, analysis, options);
  const context = await fetchChangeRequest(target);
  const passed = options.mode === "shadow" || analysis.decision === "ready";
  const description = `MergeProof${options.mode === "shadow" ? " shadow" : ""}: ${analysis.decision}`;
  if (target.provider === "gitlab") {
    const { base, project } = gitlabBase(target);
    const response = await fetch(`${base}/projects/${project}/statuses/${encodeURIComponent(context.headSha)}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...authHeaders(target.provider) }, body: new URLSearchParams({ state: passed ? "success" : "failed", name: options.mode === "shadow" ? "MergeProof evidence gate (shadow)" : "MergeProof evidence gate", description, target_url: target.ref.url }).toString() });
    if (!response.ok) throw new Error(`GitLab status publication failed with HTTP ${response.status}.`);
    return target.ref.url;
  }
  if (target.provider === "bitbucket") {
    const response = await postJson(`https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(target.ref.owner)}/${encodeURIComponent(target.ref.repo)}/commit/${encodeURIComponent(context.headSha)}/statuses/build`, authHeaders(target.provider), { key: "mergeproof", name: options.mode === "shadow" ? "MergeProof evidence gate (shadow)" : "MergeProof evidence gate", state: passed ? "SUCCESSFUL" : "FAILED", description, url: target.ref.url }, "Bitbucket");
    return typeof response.url === "string" ? response.url : target.ref.url;
  }
  const { base, repository } = azureBase(target);
  const response = await postJson(`${base}/repositories/${repository}/commits/${encodeURIComponent(context.headSha)}/statuses?api-version=7.1`, authHeaders(target.provider), { state: passed ? "succeeded" : "failed", description, targetUrl: target.ref.url, context: { name: options.mode === "shadow" ? "MergeProof evidence gate (shadow)" : "MergeProof evidence gate", genre: "MergeProof" } }, "Azure DevOps");
  return typeof response.url === "string" ? response.url : target.ref.url;
}

export async function publishChangeRequestReview(prUrl: string, analysis: Analysis, options: ChangeRequestPublicationOptions = {}): Promise<string | undefined> {
  if (parseChangeRequestUrl(prUrl).provider === "github") return publishPullRequestReview(prUrl, analysis, options);
  return publishChangeRequestComment(prUrl, bodyFor(analysis));
}

export async function publishChangeRequestComment(prUrl: string, body: string): Promise<string | undefined> {
  const target = parseChangeRequestUrl(prUrl);
  if (target.provider === "github") return (await publishPullRequestComment(prUrl, body)) ?? target.ref.url;
  if (target.provider === "gitlab") {
    const { base, project } = gitlabBase(target);
    const response = await postJson(`${base}/projects/${project}/merge_requests/${target.ref.number}/notes`, authHeaders(target.provider), { body }, "GitLab");
    return typeof response.web_url === "string" ? response.web_url : target.ref.url;
  }
  if (target.provider === "bitbucket") {
    const response = await postJson(`https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(target.ref.owner)}/${encodeURIComponent(target.ref.repo)}/pullrequests/${target.ref.number}/comments`, authHeaders(target.provider), { content: { raw: body } }, "Bitbucket");
    const links = response.links as Record<string, unknown> | undefined;
    const html = links?.html as Record<string, unknown> | undefined;
    return typeof html?.href === "string" ? html.href : target.ref.url;
  }
  const { base, repository } = azureBase(target);
  const response = await postJson(`${base}/repositories/${repository}/pullRequests/${target.ref.number}/threads?api-version=7.1`, authHeaders(target.provider), { comments: [{ parentCommentId: 0, content: body, commentType: 1 }], status: 1 }, "Azure DevOps");
  return typeof response._links === "object" ? target.ref.url : target.ref.url;
}
