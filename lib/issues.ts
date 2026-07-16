import { extractAcceptanceCriteria } from "./criteria";
import type { LinkedIssue } from "./types";

function textFromAtlassian(value: unknown): string {
  if (!value || typeof value !== "object") return typeof value === "string" ? value : "";
  const node = value as { type?: string; text?: string; content?: unknown[] };
  return `${node.text ?? ""}${node.content?.map(textFromAtlassian).join(" ") ?? ""}`;
}

function linkedReferences(body: string): Array<{ key: string; url: string }> {
  const references = new Map<string, { key: string; url: string }>();
  const urlPattern = /https?:\/\/[^\s)]+\/browse\/([A-Z][A-Z0-9]+-\d+)/gi;
  for (const match of body.matchAll(urlPattern)) references.set(match[1].toUpperCase(), { key: match[1].toUpperCase(), url: match[0] });
  const baseUrl = process.env.JIRA_BASE_URL?.replace(/\/$/, "");
  if (baseUrl) {
    const keyPattern = /\b([A-Z][A-Z0-9]+-\d+)\b/g;
    for (const match of body.matchAll(keyPattern)) {
      const key = match[1].toUpperCase();
      references.set(key, { key, url: `${baseUrl}/browse/${key}` });
    }
  }
  return [...references.values()];
}

export async function fetchLinkedIssues(body: string): Promise<LinkedIssue[]> {
  const baseUrl = process.env.JIRA_BASE_URL?.replace(/\/$/, "");
  const token = process.env.JIRA_API_TOKEN || process.env.JIRA_ACCESS_TOKEN;
  if (!baseUrl || !token) return [];
  const email = process.env.JIRA_EMAIL;
  const headers: Record<string, string> = { Accept: "application/json" };
  headers.Authorization = email ? `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}` : `Bearer ${token}`;
  const results: LinkedIssue[] = [];
  for (const reference of linkedReferences(body).slice(0, 5)) {
    try {
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
