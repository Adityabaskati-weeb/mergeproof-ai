import { extractAcceptanceCriteria } from "./criteria";
import { createModelProvider, type ReviewPlan } from "./models";
import { loadPolicy } from "./policy";
import { combineInstructions, loadAgentProfile } from "./agents";
import type { LinkedIssue } from "./types";
import type { PullRequestContext, PullRequestRef } from "./github";

export type IssueTarget = { provider: "jira" | "linear"; key: string; url: string };

function textFromAtlassian(value: unknown): string {
  if (!value || typeof value !== "object") return typeof value === "string" ? value : "";
  const node = value as { text?: string; content?: unknown[] };
  return `${node.text ?? ""}${node.content?.map(textFromAtlassian).join(" ") ?? ""}`;
}

export function parseIssueUrl(value: string): IssueTarget {
  const jira = value.trim().match(/^https:\/\/([^/]+)\/browse\/([A-Z][A-Z0-9]+-\d+)\/?$/i);
  if (jira) return { provider: "jira", key: jira[2].toUpperCase(), url: `https://${jira[1]}/browse/${jira[2].toUpperCase()}` };
  const linear = value.trim().match(/^https:\/\/linear\.app\/(?:[^/]+\/)?issue\/([A-Z][A-Z0-9]+-\d+)(?:\/[^/]+)?\/?$/i);
  if (linear) return { provider: "linear", key: linear[1].toUpperCase(), url: value.trim().replace(/\/$/, "") };
  throw new Error("Expected a Jira /browse/KEY-123 or Linear /issue/KEY-123 URL.");
}

async function fetchIssue(target: IssueTarget): Promise<LinkedIssue> {
  if (target.provider === "jira") {
    const baseUrl = target.url.match(/^https:\/\/[^/]+/)?.[0];
    const token = process.env.JIRA_API_TOKEN || process.env.JIRA_ACCESS_TOKEN;
    if (!baseUrl || !token) throw new Error("JIRA_API_TOKEN is required for direct Jira planning.");
    const email = process.env.JIRA_EMAIL;
    const response = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(target.key)}?fields=summary,description,status`, { headers: { Accept: "application/json", Authorization: email ? `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}` : `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Jira issue request failed with HTTP ${response.status}.`);
    const payload = await response.json() as { fields?: { summary?: string; description?: unknown; status?: { name?: string } } };
    const description = textFromAtlassian(payload.fields?.description);
    return { provider: "jira", key: target.key, url: target.url, summary: payload.fields?.summary ?? target.key, description, status: payload.fields?.status?.name ?? "Unknown", acceptanceCriteria: extractAcceptanceCriteria(description).criteria };
  }
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) throw new Error("LINEAR_API_KEY is required for direct Linear planning.");
  const response = await fetch(process.env.LINEAR_API_URL || "https://api.linear.app/graphql", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: apiKey }, body: JSON.stringify({ query: "query($identifier:String!){issues(filter:{identifier:{eq:$identifier}}){nodes{identifier title description state{name} url}}}", variables: { identifier: target.key } }) });
  if (!response.ok) throw new Error(`Linear issue request failed with HTTP ${response.status}.`);
  const payload = await response.json() as { data?: { issues?: { nodes?: Array<{ identifier?: string; title?: string; description?: string; state?: { name?: string }; url?: string }> } } };
  const issue = payload.data?.issues?.nodes?.[0];
  if (!issue) throw new Error(`Linear issue ${target.key} was not found.`);
  const description = issue.description ?? "";
  return { provider: "linear", key: issue.identifier ?? target.key, url: issue.url ?? target.url, summary: issue.title ?? target.key, description, status: issue.state?.name ?? "Unknown", acceptanceCriteria: extractAcceptanceCriteria(description).criteria };
}

export async function planIssue(issueUrl: string, model?: string, providerName?: string, options: { repoPath?: string; agent?: string } = {}): Promise<ReviewPlan> {
  const target = parseIssueUrl(issueUrl);
  const issue = await fetchIssue(target);
  const policy = await loadPolicy(options.repoPath || process.cwd());
  const profile = await loadAgentProfile(options.repoPath || process.cwd(), options.agent);
  const criteria = issue.acceptanceCriteria.length ? issue.acceptanceCriteria : [`Implement the requirements described by ${issue.key}.`];
  const ref: PullRequestRef = { owner: target.provider, repo: issue.key, number: 0, url: issue.url };
  const headSha = `issue:${target.provider}:${issue.key}`;
  const context: PullRequestContext = { ref, title: issue.summary, body: issue.description, headSha, baseSha: headSha, files: [], checks: [], commits: [], discussion: [], sources: new Set([issue.url]), repositoryEvidence: [], issues: [issue], customInstructions: combineInstructions(policy.instructions, profile) };
  const provider = (providerName || policy.provider || process.env.MERGEPROOF_PROVIDER || "openai").toLowerCase();
  const selectedModel = model || policy.model || (provider === "anthropic" ? process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514" : process.env.OPENAI_MODEL || "gpt-5.6");
  const modelProvider = createModelProvider(selectedModel, provider as Parameters<typeof createModelProvider>[1]);
  const result = await modelProvider.plan(context, criteria, AbortSignal.timeout(45_000));
  const valid = (citation: { commitSha: string; url: string }) => citation.commitSha === headSha && context.sources.has(citation.url);
  const risks = result.risks.map((risk) => ({ ...risk, citations: risk.citations.filter(valid) }));
  const steps = result.steps.map((step) => ({ ...step, citations: step.citations.filter(valid) }));
  return { ...result, risks, steps, trace: { model: modelProvider.name, headSha, fetchedSources: context.sources.size, citedSources: [...risks.flatMap((risk) => risk.citations), ...steps.flatMap((step) => step.citations)].length } };
}
