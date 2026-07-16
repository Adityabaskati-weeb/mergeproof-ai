import { extractAcceptanceCriteria } from "./criteria";
import type { LinkedIssue } from "./types";

function textFromAtlassian(value: unknown): string {
  if (!value || typeof value !== "object") return typeof value === "string" ? value : "";
  const node = value as { type?: string; text?: string; content?: unknown[] };
  return `${node.text ?? ""}${node.content?.map(textFromAtlassian).join(" ") ?? ""}`;
}

function linkedReferences(body: string): Array<{ provider: "jira" | "linear"; key: string; url: string }> {
  const references = new Map<string, { provider: "jira" | "linear"; key: string; url: string }>();
  const urlPattern = /https?:\/\/[^\s)]+\/browse\/([A-Z][A-Z0-9]+-\d+)/gi;
  for (const match of body.matchAll(urlPattern)) references.set(`jira:${match[1].toUpperCase()}`, { provider: "jira", key: match[1].toUpperCase(), url: match[0] });
  const baseUrl = process.env.JIRA_BASE_URL?.replace(/\/$/, "");
  if (baseUrl) {
    const keyPattern = /\b([A-Z][A-Z0-9]+-\d+)\b/g;
    for (const match of body.matchAll(keyPattern)) {
      const key = match[1].toUpperCase();
      references.set(`jira:${key}`, { provider: "jira", key, url: `${baseUrl}/browse/${key}` });
    }
  }
  const linearPattern = /https?:\/\/linear\.app\/[^\s/]+\/issue\/([A-Z][A-Z0-9]+-\d+)(?:\/[^\s)]+)?/gi;
  for (const match of body.matchAll(linearPattern)) references.set(`linear:${match[1].toUpperCase()}`, { provider: "linear", key: match[1].toUpperCase(), url: match[0] });
  const linearTeam = process.env.LINEAR_TEAM_KEY?.toUpperCase();
  if (linearTeam) {
    const keyPattern = new RegExp(`\\b(${linearTeam}-\\d+)\\b`, "g");
    for (const match of body.matchAll(keyPattern)) references.set(`linear:${match[1].toUpperCase()}`, { provider: "linear", key: match[1].toUpperCase(), url: `https://linear.app/issue/${match[1].toUpperCase()}` });
  }
  return [...references.values()];
}

export async function fetchLinkedIssues(body: string): Promise<LinkedIssue[]> {
  const baseUrl = process.env.JIRA_BASE_URL?.replace(/\/$/, "");
  const token = process.env.JIRA_API_TOKEN || process.env.JIRA_ACCESS_TOKEN;
  const email = process.env.JIRA_EMAIL;
  const headers: Record<string, string> = { Accept: "application/json" };
  headers.Authorization = email ? `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}` : `Bearer ${token}`;
  const results: LinkedIssue[] = [];
  for (const reference of linkedReferences(body).slice(0, 5)) {
    try {
      if (reference.provider === "linear") {
        const linearKey = process.env.LINEAR_API_KEY;
        if (!linearKey) continue;
        const response = await fetch(process.env.LINEAR_API_URL || "https://api.linear.app/graphql", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: linearKey }, body: JSON.stringify({ query: "query($identifier:String!){issues(filter:{identifier:{eq:$identifier}}){nodes{identifier title description state{name}}}}", variables: { identifier: reference.key } }) });
        if (!response.ok) continue;
        const payload = await response.json() as { data?: { issues?: { nodes?: Array<{ identifier?: string; title?: string; description?: string; state?: { name?: string } }> } } };
        const issue = payload.data?.issues?.nodes?.[0];
        if (issue) results.push({ provider: "linear", key: issue.identifier ?? reference.key, url: reference.url, summary: issue.title ?? reference.key, description: issue.description ?? "", status: issue.state?.name ?? "Unknown", acceptanceCriteria: extractAcceptanceCriteria(issue.description ?? "").criteria });
        continue;
      }
      if (!baseUrl || !token) continue;
      const response = await fetch(`${baseUrl}/rest/api/3/issue/${encodeURIComponent(reference.key)}?fields=summary,description,status`, { headers });
      if (!response.ok) continue;
      const payload = await response.json() as { fields?: { summary?: string; description?: unknown; status?: { name?: string } } };
      const description = textFromAtlassian(payload.fields?.description);
      results.push({ provider: "jira", key: reference.key, url: reference.url, summary: payload.fields?.summary ?? reference.key, description, status: payload.fields?.status?.name ?? "Unknown", acceptanceCriteria: extractAcceptanceCriteria(description).criteria });
    } catch {
      // An unavailable issue tracker must not prevent a local PR analysis.
    }
  }
  return results;
}

export async function createLinearIssue(summary: string, description: string): Promise<string> {
  const apiKey = process.env.LINEAR_API_KEY;
  const teamId = process.env.LINEAR_TEAM_ID;
  if (!apiKey || !teamId) throw new Error("LINEAR_API_KEY and LINEAR_TEAM_ID are required to create a Linear issue.");
  const response = await fetch(process.env.LINEAR_API_URL || "https://api.linear.app/graphql", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: apiKey }, body: JSON.stringify({ query: "mutation($teamId:String!,$title:String!,$description:String!){issueCreate(input:{teamId:$teamId,title:$title,description:$description}){success issue{url}}}", variables: { teamId, title: summary.slice(0, 200), description: description.slice(0, 30000) } }) });
  if (!response.ok) throw new Error(`Linear issue creation failed with HTTP ${response.status}.`);
  const payload = await response.json() as { data?: { issueCreate?: { success?: boolean; issue?: { url?: string } } } };
  const url = payload.data?.issueCreate?.issue?.url;
  if (!payload.data?.issueCreate?.success || !url) throw new Error("Linear issue creation returned no issue URL.");
  return url;
}

export async function createJiraIssue(summary: string, description: string): Promise<string> {
  const baseUrl = process.env.JIRA_BASE_URL?.replace(/\/$/, "");
  const token = process.env.JIRA_API_TOKEN || process.env.JIRA_ACCESS_TOKEN;
  const projectKey = process.env.JIRA_PROJECT_KEY;
  if (!baseUrl || !token || !projectKey) throw new Error("JIRA_BASE_URL, JIRA_PROJECT_KEY, and JIRA_API_TOKEN are required to create a Jira issue.");
  const email = process.env.JIRA_EMAIL;
  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json", Authorization: email ? `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}` : `Bearer ${token}` };
  const response = await fetch(`${baseUrl}/rest/api/3/issue`, { method: "POST", headers, body: JSON.stringify({ fields: { project: { key: projectKey }, summary, issuetype: { name: process.env.JIRA_ISSUE_TYPE || "Task" }, description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: description.slice(0, 30000) }] }] } } }) });
  if (!response.ok) throw new Error(`Jira issue creation failed with HTTP ${response.status}.`);
  const payload = await response.json() as { key?: string; self?: string };
  return payload.self ?? `${baseUrl}/browse/${payload.key ?? ""}`;
}
