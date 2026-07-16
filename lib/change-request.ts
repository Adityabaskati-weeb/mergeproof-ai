import { parsePullRequestUrl, fetchPullRequest, type PullRequestContext, type PullRequestRef } from "./github";

export type ChangeRequestProvider = "github" | "gitlab" | "bitbucket" | "azure-devops";
export type ChangeRequestTarget = { provider: ChangeRequestProvider; ref: PullRequestRef };

type JsonRecord = Record<string, unknown>;

async function getJson(url: string, headers: Record<string, string>, provider: string): Promise<JsonRecord | JsonRecord[]> {
  const response = await fetch(url, { headers: { accept: "application/json", ...headers } });
  if (!response.ok) throw new Error(`${provider} request failed with HTTP ${response.status}.`);
  return await response.json() as JsonRecord | JsonRecord[];
}

function authHeaders(provider: ChangeRequestProvider): Record<string, string> {
  if (provider === "gitlab" && process.env.GITLAB_TOKEN) return { "PRIVATE-TOKEN": process.env.GITLAB_TOKEN };
  if (provider === "bitbucket" && process.env.BITBUCKET_TOKEN) return { authorization: `Bearer ${process.env.BITBUCKET_TOKEN}` };
  if (provider === "bitbucket" && process.env.BITBUCKET_USERNAME && process.env.BITBUCKET_APP_PASSWORD) return { authorization: `Basic ${Buffer.from(`${process.env.BITBUCKET_USERNAME}:${process.env.BITBUCKET_APP_PASSWORD}`).toString("base64")}` };
  if (provider === "azure-devops" && process.env.AZURE_DEVOPS_TOKEN) return { authorization: `Basic ${Buffer.from(`:${process.env.AZURE_DEVOPS_TOKEN}`).toString("base64")}` };
  return {};
}

function addSource(sources: Set<string>, value: unknown, fallback: string): string {
  const url = typeof value === "string" && value ? value : fallback;
  sources.add(url);
  return url;
}

function parseUnifiedDiff(diff: string, sourceUrl: (path: string) => string): PullRequestContext["files"] {
  const chunks = diff.split(/(?=^diff --git )/m).map((chunk) => chunk.trim()).filter(Boolean);
  return chunks.map((patch) => {
    const path = patch.match(/^diff --git a\/(.+?) b\/(.+)$/m)?.[2] ?? patch.match(/^\+\+\+ b\/(.+)$/m)?.[1] ?? "unknown";
    const additions = patch.split(/\r?\n/).filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
    const deletions = patch.split(/\r?\n/).filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
    return { path, patch, status: "modified", additions, deletions, url: sourceUrl(path) };
  });
}

function gitlabTarget(value: string): ChangeRequestTarget | undefined {
  const match = value.match(/^https:\/\/([^/]+)\/(.+)\/-\/merge_requests\/(\d+)\/?$/i);
  if (!match) return undefined;
  const projectPath = match[2].replace(/\/$/, "");
  const repo = projectPath.split("/").at(-1) ?? projectPath;
  return { provider: "gitlab", ref: { owner: projectPath.slice(0, -(repo.length + 1)), repo, number: Number(match[3]), url: `https://${match[1]}/${projectPath}/-/merge_requests/${match[3]}`, provider: "gitlab" } };
}

function bitbucketTarget(value: string): ChangeRequestTarget | undefined {
  const match = value.match(/^https:\/\/bitbucket\.org\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)\/?$/i);
  if (!match) return undefined;
  return { provider: "bitbucket", ref: { owner: match[1], repo: match[2], number: Number(match[3]), url: `https://bitbucket.org/${match[1]}/${match[2]}/pull-requests/${match[3]}`, provider: "bitbucket" } };
}

function azureTarget(value: string): ChangeRequestTarget | undefined {
  const modern = value.match(/^https:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)\/?$/i);
  const legacy = value.match(/^https:\/\/([^/.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)\/?$/i);
  const match = modern ?? legacy;
  if (!match) return undefined;
  const organization = match[1];
  const project = match[2];
  const repo = match[3];
  const number = Number(match[4]);
  const url = `https://dev.azure.com/${organization}/${project}/_git/${repo}/pullrequest/${number}`;
  return { provider: "azure-devops", ref: { owner: organization, repo, number, url, provider: "azure-devops" } };
}

export function parseChangeRequestUrl(value: string): ChangeRequestTarget {
  try {
    return { provider: "github", ref: parsePullRequestUrl(value) };
  } catch {
    const target = gitlabTarget(value) ?? bitbucketTarget(value) ?? azureTarget(value);
    if (target) return target;
    throw new Error("Expected a GitHub pull request, GitLab merge request, Bitbucket pull request, or Azure DevOps pull request URL.");
  }
}

async function fetchGitLab(target: ChangeRequestTarget): Promise<PullRequestContext> {
  const ref = target.ref;
  const parsed = new URL(ref.url);
  const projectPath = ref.owner === (ref.repo.split("/")[0] ?? ref.owner) ? `${ref.owner}/${ref.repo}` : `${ref.owner}/${ref.repo}`;
  const apiBase = (process.env.GITLAB_API_URL || `${parsed.origin}/api/v4`).replace(/\/$/, "");
  const project = encodeURIComponent(projectPath);
  const headers = authHeaders("gitlab");
  const pull = await getJson(`${apiBase}/projects/${project}/merge_requests/${ref.number}`, headers, "GitLab") as JsonRecord;
  const [diffs, commits, discussions, pipelines] = await Promise.all([
    getJson(`${apiBase}/projects/${project}/merge_requests/${ref.number}/diffs?per_page=100&unidiff=true`, headers, "GitLab").catch(() => ({ diffs: [] })),
    getJson(`${apiBase}/projects/${project}/merge_requests/${ref.number}/commits?per_page=100`, headers, "GitLab").catch(() => []),
    getJson(`${apiBase}/projects/${project}/merge_requests/${ref.number}/discussions?per_page=100`, headers, "GitLab").catch(() => []),
    getJson(`${apiBase}/projects/${project}/pipelines?ref=${encodeURIComponent(String(pull.sha ?? ""))}&per_page=100`, headers, "GitLab").catch(() => []),
  ]);
  const sources = new Set<string>([ref.url]);
  const sha = String(pull.sha ?? "unknown");
  const webBase = `${parsed.origin}/${projectPath}`;
  const diffValues = Array.isArray(diffs) ? diffs : Array.isArray(diffs.diffs) ? diffs.diffs : [];
  const files = diffValues.map((item) => {
    const path = String(item.new_path ?? item.old_path ?? "unknown");
    const url = addSource(sources, `${webBase}/-/blob/${sha}/${path}`, ref.url);
    const patch = String(item.diff ?? `@@\n+GitLab ${item.new_file ? "new" : item.deleted_file ? "deleted" : "changed"} file`);
    return { path, patch, status: item.new_file ? "added" : item.deleted_file ? "deleted" : item.renamed_file ? "renamed" : "modified", additions: patch.split(/\r?\n/).filter((line) => line.startsWith("+") && !line.startsWith("+++")).length, deletions: patch.split(/\r?\n/).filter((line) => line.startsWith("-") && !line.startsWith("---")).length, url };
  });
  const checks = (Array.isArray(pipelines) ? pipelines : []).map((pipeline) => ({ name: `pipeline-${pipeline.id ?? "unknown"}`, status: String(pipeline.status ?? "unknown"), conclusion: pipeline.status ? String(pipeline.status) : null, url: addSource(sources, pipeline.web_url, ref.url) }));
  const commitData = (Array.isArray(commits) ? commits : []).slice(0, 100).map((commit) => ({ sha: String(commit.id ?? "unknown"), message: String(commit.title ?? commit.message ?? "").slice(0, 2000), url: addSource(sources, commit.web_url, ref.url) }));
  const discussion = (Array.isArray(discussions) ? discussions : []).flatMap((thread) => Array.isArray(thread.notes) ? thread.notes.map((note) => ({ author: String(note.author?.username ?? "unknown"), body: String(note.body ?? "").slice(0, 4000), url: addSource(sources, note.noteable_web_url ?? note.web_url, ref.url) })) : []).slice(0, 100);
  const diffRefs = pull.diff_refs as JsonRecord | undefined;
  return { ref, title: String(pull.title ?? "GitLab merge request"), body: String(pull.description ?? ""), headSha: sha, baseSha: String(diffRefs?.base_sha ?? "unknown"), files, checks, commits: commitData, discussion, sources, repositoryEvidence: [], issues: [] };
}

async function fetchBitbucket(target: ChangeRequestTarget): Promise<PullRequestContext> {
  const ref = target.ref;
  const apiBase = (process.env.BITBUCKET_API_URL || "https://api.bitbucket.org/2.0").replace(/\/$/, "");
  const base = `${apiBase}/repositories/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/pullrequests/${ref.number}`;
  const headers = authHeaders("bitbucket");
  const pull = await getJson(base, headers, "Bitbucket") as JsonRecord;
  const [diffResponse, commits, comments, statuses] = await Promise.all([
    fetch(`${base}/diff`, { headers }).then(async (response) => { if (!response.ok) throw new Error(`Bitbucket diff failed with HTTP ${response.status}.`); return response.text(); }).catch(() => ""),
    getJson(`${base}/commits?pagelen=100`, headers, "Bitbucket").catch(() => ({ values: [] })),
    getJson(`${base}/comments?pagelen=100`, headers, "Bitbucket").catch(() => ({ values: [] })),
    getJson(`${base}/statuses`, headers, "Bitbucket").catch(() => ({ values: [] })),
  ]);
  const sources = new Set<string>([ref.url]);
  const sourceCommit = String((pull.source as JsonRecord | undefined)?.commit && ((pull.source as JsonRecord).commit as JsonRecord).hash || "unknown");
  const destinationCommit = String((pull.destination as JsonRecord | undefined)?.commit && ((pull.destination as JsonRecord).commit as JsonRecord).hash || "unknown");
  const sourceUrl = (path: string) => addSource(sources, `https://bitbucket.org/${ref.owner}/${ref.repo}/src/${sourceCommit}/${path}`, ref.url);
  const files = parseUnifiedDiff(diffResponse, sourceUrl);
  const checks = (Array.isArray(statuses) ? statuses : Array.isArray(statuses.values) ? statuses.values : []).map((status) => ({ name: String(status.name ?? status.key ?? "status"), status: String(status.state ?? "completed"), conclusion: status.state ? String(status.state) : null, url: addSource(sources, status.url ?? status.links?.self?.href, ref.url) }));
  const commitData = (Array.isArray(commits) ? commits : Array.isArray(commits.values) ? commits.values : []).slice(0, 100).map((commit) => ({ sha: String(commit.hash ?? "unknown"), message: String(commit.message ?? "").slice(0, 2000), url: addSource(sources, commit.links?.html?.href, ref.url) }));
  const discussion = (Array.isArray(comments) ? comments : Array.isArray(comments.values) ? comments.values : []).slice(0, 100).map((comment) => ({ author: String(comment.user?.nickname ?? comment.user?.display_name ?? "unknown"), body: String(comment.content?.raw ?? "").slice(0, 4000), url: addSource(sources, comment.links?.html?.href, ref.url) }));
  return { ref, title: String(pull.title ?? "Bitbucket pull request"), body: String((pull.summary as JsonRecord | undefined)?.raw ?? ""), headSha: sourceCommit, baseSha: destinationCommit, files, checks, commits: commitData, discussion, sources, repositoryEvidence: [], issues: [] };
}

async function fetchAzure(target: ChangeRequestTarget): Promise<PullRequestContext> {
  const ref = target.ref;
  const project = encodeURIComponent(new URL(ref.url).pathname.split("/")[2] ?? "");
  const apiBase = `https://dev.azure.com/${encodeURIComponent(ref.owner)}/${project}/_apis/git`;
  const headers = authHeaders("azure-devops");
  const pull = await getJson(`${apiBase}/pullrequests/${ref.number}?api-version=7.1`, headers, "Azure DevOps") as JsonRecord;
  const repositoryId = String((pull.repository as JsonRecord | undefined)?.id ?? ref.repo);
  const [commits, iterations] = await Promise.all([
    getJson(`${apiBase}/repositories/${encodeURIComponent(repositoryId)}/pullRequests/${ref.number}/commits?api-version=7.1`, headers, "Azure DevOps").catch(() => ({ value: [] })),
    getJson(`${apiBase}/repositories/${encodeURIComponent(repositoryId)}/pullRequests/${ref.number}/iterations?api-version=7.1`, headers, "Azure DevOps").catch(() => ({ value: [] })),
  ]);
  const sources = new Set<string>([ref.url]);
  const sha = String((pull.lastMergeSourceCommit as JsonRecord | undefined)?.commitId ?? "unknown");
  const iterationValues = Array.isArray(iterations) ? iterations : Array.isArray(iterations.value) ? iterations.value : [];
  const latestIteration = iterationValues.at(-1);
  const changes = latestIteration?.id ? await getJson(`${apiBase}/repositories/${encodeURIComponent(repositoryId)}/pullRequests/${ref.number}/iterations/${latestIteration.id}/changes?api-version=7.1`, headers, "Azure DevOps").catch(() => ({ changeEntries: [] })) : { changeEntries: [] };
  const changeValues = Array.isArray(changes) ? changes : Array.isArray(changes.changeEntries) ? changes.changeEntries : [];
  const files = changeValues.map((change) => {
    const item = change.item as JsonRecord | undefined;
    const path = String(item?.path ?? "unknown");
    const url = addSource(sources, item?.url, ref.url);
    return { path, patch: `@@\n+Azure DevOps ${String(change.changeType ?? "changed")} item`, status: String(change.changeType ?? "modified").toLowerCase(), additions: 1, deletions: 0, url };
  });
  const commitData = (Array.isArray(commits) ? commits : Array.isArray(commits.value) ? commits.value : []).slice(0, 100).map((commit) => ({ sha: String(commit.commitId ?? "unknown"), message: String(commit.comment ?? "").slice(0, 2000), url: addSource(sources, commit.remoteUrl, ref.url) }));
  return { ref, title: String(pull.title ?? "Azure DevOps pull request"), body: String(pull.description ?? ""), headSha: sha, baseSha: String((pull.lastMergeTargetCommit as JsonRecord | undefined)?.commitId ?? "unknown"), files, checks: [], commits: commitData, discussion: [], sources, repositoryEvidence: [], issues: [] };
}

export async function fetchChangeRequest(target: ChangeRequestTarget): Promise<PullRequestContext> {
  if (target.provider === "github") return fetchPullRequest(target.ref);
  if (target.provider === "gitlab") return fetchGitLab(target);
  if (target.provider === "bitbucket") return fetchBitbucket(target);
  return fetchAzure(target);
}
