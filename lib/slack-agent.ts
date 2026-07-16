import { createHmac, timingSafeEqual } from "node:crypto";
import { analyzePullRequest } from "./analyze";
import { createGithubIssueFromAnalysis } from "./github-issues";
import { planPullRequest } from "./plan";
import { parseChangeRequestUrl } from "./change-request";
import { fixPullRequest } from "./fix";
import { generateTestsPullRequest } from "./tests";
import { readSlackThread, recordSlackThread } from "./slack-memory";

export type SlackAgentOptions = { signingSecret: string; botToken?: string; repoPath?: string; model?: string; provider?: string; log?: (message: string) => void };
export type SlackCommand = { action: "review" | "investigate" | "plan" | "fix" | "tests" | "issue"; prUrl: string };

export function verifySlackRequestSignature(body: string, timestamp: string | undefined, signature: string | undefined, secret: string, now = Date.now()): boolean {
  if (!timestamp || !signature || !secret || Math.abs(now - Number(timestamp) * 1000) > 5 * 60 * 1000) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function parseSlackCommand(text: string, fallbackPrUrl?: string): SlackCommand | undefined {
  const normalized = text.trim().replace(/^<@[^>]+>\s*/, "");
  const match = normalized.match(/^(review|investigate|plan|fix|tests|issue)(?:\s+(https:\/\/\S+))?(?:\s|$)/i);
  if (!match) return undefined;
  const prUrl = (match[2] ?? fallbackPrUrl)?.replace(/\/$/, "");
  if (!prUrl) return undefined;
  try {
    parseChangeRequestUrl(prUrl);
  } catch {
    return undefined;
  }
  return { action: match[1].toLowerCase() as SlackCommand["action"], prUrl };
}

function resultText(action: SlackCommand["action"], prUrl: string, value: Awaited<ReturnType<typeof analyzePullRequest>> | Awaited<ReturnType<typeof planPullRequest>> | Awaited<ReturnType<typeof fixPullRequest>> | Awaited<ReturnType<typeof generateTestsPullRequest>> | string): string {
  if (typeof value === "string") return `MergeProof created a follow-up issue: ${value}`;
  if (action === "plan") {
    const plan = value as Awaited<ReturnType<typeof planPullRequest>>;
    return `MergeProof plan for ${prUrl}\n${plan.summary}\n${plan.steps.map((step, index) => `${index + 1}. ${step.title}`).join("\n")}`;
  }
  if (action === "fix" || action === "tests") {
    const suggestion = value as Awaited<ReturnType<typeof fixPullRequest>> | Awaited<ReturnType<typeof generateTestsPullRequest>>;
    return `MergeProof ${action} suggestion for ${prUrl}\n${suggestion.summary}\nChanged paths: ${suggestion.trace.changedPaths.join(", ") || "none"}\n\n${suggestion.patch.slice(0, 6000) || "No patch was proposed."}`;
  }
  const analysis = value as Awaited<ReturnType<typeof analyzePullRequest>>;
  const security = (analysis.securityFindings ?? []).map((finding) => `:rotating_light: ${finding.severity} ${finding.path}:${finding.line} ${finding.title}`).join("\n");
  return `MergeProof *${analysis.decision}* for ${prUrl}\n${security ? `${security}\n` : ""}${analysis.rows.map((row) => `${row.state === "pass" ? ":white_check_mark:" : ":warning:"} ${row.criterion}`).join("\n")}\nCitations verified: ${analysis.trace.citedSources}`;
}

export async function runSlackCommand(command: SlackCommand, options: SlackAgentOptions): Promise<string> {
  if (command.action === "plan") return resultText(command.action, command.prUrl, await planPullRequest(command.prUrl, options.model, options.provider));
  if (command.action === "fix") return resultText(command.action, command.prUrl, await fixPullRequest(command.prUrl, options.model, { provider: options.provider, repoPath: options.repoPath }));
  if (command.action === "tests") return resultText(command.action, command.prUrl, await generateTestsPullRequest(command.prUrl, options.model, { provider: options.provider, repoPath: options.repoPath }));
  const analysis = await analyzePullRequest(command.prUrl, options.model, { provider: options.provider, repoPath: options.repoPath, remember: true, memoryRoot: options.repoPath });
  if (command.action === "issue") {
    if (parseChangeRequestUrl(command.prUrl).provider !== "github") throw new Error("Slack issue creation currently supports GitHub pull requests only.");
    return resultText(command.action, command.prUrl, await createGithubIssueFromAnalysis(command.prUrl, analysis));
  }
  return resultText(command.action, command.prUrl, analysis);
}

export async function processSlackCommand(body: string, options: SlackAgentOptions): Promise<{ text: string; responseUrl?: string }> {
  const params = new URLSearchParams(body);
  const command = parseSlackCommand(params.get("text") ?? "");
  if (!command) return { text: "Usage: `review|investigate|plan|fix|tests <GitHub, GitLab, Bitbucket, or Azure DevOps change-request URL>`, or `issue <GitHub PR URL>`." };
  const responseUrl = params.get("response_url") ?? undefined;
  try {
    const text = await runSlackCommand(command, options);
    if (responseUrl) await fetch(responseUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ response_type: "in_channel", replace_original: true, text }) });
    return { text, responseUrl };
  } catch (error) {
    const text = `MergeProof failed: ${error instanceof Error ? error.message : "unknown error"}`;
    options.log?.(text);
    if (responseUrl) await fetch(responseUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ response_type: "ephemeral", replace_original: true, text }) });
    return { text, responseUrl };
  }
}

export async function processSlackEvent(payload: unknown, options: SlackAgentOptions): Promise<{ accepted: boolean; ignored?: boolean; text?: string }> {
  if (!payload || typeof payload !== "object") return { accepted: false, text: "Invalid Slack event." };
  const value = payload as { event?: { type?: string; bot_id?: string; text?: string; channel?: string; thread_ts?: string; ts?: string } };
  const event = value.event;
  if (!event || !["app_mention", "message"].includes(event.type ?? "") || event.bot_id) return { accepted: true, ignored: true };
  const threadKey = event.channel ? `${event.channel}:${event.thread_ts ?? event.ts ?? "root"}` : undefined;
  const previous = threadKey ? await readSlackThread(options.repoPath || process.cwd(), threadKey) : undefined;
  const command = parseSlackCommand(event.text ?? "", previous?.prUrl);
  if (!command) return { accepted: true, ignored: true, text: "Mention MergeProof with `review`, `investigate`, `plan`, `fix`, or `tests` followed by a change-request URL." };
  const text = await runSlackCommand(command, options);
  if (threadKey) await recordSlackThread(options.repoPath || process.cwd(), threadKey, command.prUrl);
  if (options.botToken && event.channel) {
    const response = await fetch("https://slack.com/api/chat.postMessage", { method: "POST", headers: { authorization: `Bearer ${options.botToken}`, "content-type": "application/json" }, body: JSON.stringify({ channel: event.channel, thread_ts: event.thread_ts ?? event.ts, text }) });
    if (!response.ok) throw new Error(`Slack message publication failed with HTTP ${response.status}.`);
    const result = await response.json() as { ok?: boolean; error?: string };
    if (!result.ok) throw new Error(`Slack message publication failed: ${result.error ?? "unknown error"}.`);
  } else {
    options.log?.(`MergeProof Slack event result: ${text}`);
  }
  return { accepted: true, text };
}
