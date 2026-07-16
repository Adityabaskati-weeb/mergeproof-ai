import { createHmac, timingSafeEqual } from "node:crypto";
import { analyzePullRequest } from "./analyze";
import { createGithubIssueFromAnalysis } from "./github-issues";
import { planPullRequest } from "./plan";

export type SlackAgentOptions = { signingSecret: string; repoPath?: string; model?: string; provider?: string; log?: (message: string) => void };
export type SlackCommand = { action: "review" | "plan" | "issue"; prUrl: string };

export function verifySlackRequestSignature(body: string, timestamp: string | undefined, signature: string | undefined, secret: string, now = Date.now()): boolean {
  if (!timestamp || !signature || !secret || Math.abs(now - Number(timestamp) * 1000) > 5 * 60 * 1000) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function parseSlackCommand(text: string): SlackCommand | undefined {
  const match = text.trim().match(/^(review|plan|issue)\s+(https:\/\/github\.com\/[^\s]+\/pull\/\d+\/?)(?:\s|$)/i);
  if (!match) return undefined;
  return { action: match[1].toLowerCase() as SlackCommand["action"], prUrl: match[2].replace(/\/$/, "") };
}

function resultText(action: SlackCommand["action"], prUrl: string, value: Awaited<ReturnType<typeof analyzePullRequest>> | Awaited<ReturnType<typeof planPullRequest>> | string): string {
  if (typeof value === "string") return `MergeProof created a follow-up issue: ${value}`;
  if (action === "plan") {
    const plan = value as Awaited<ReturnType<typeof planPullRequest>>;
    return `MergeProof plan for ${prUrl}\n${plan.summary}\n${plan.steps.map((step, index) => `${index + 1}. ${step.title}`).join("\n")}`;
  }
  const analysis = value as Awaited<ReturnType<typeof analyzePullRequest>>;
  const security = (analysis.securityFindings ?? []).map((finding) => `:rotating_light: ${finding.severity} ${finding.path}:${finding.line} ${finding.title}`).join("\n");
  return `MergeProof *${analysis.decision}* for ${prUrl}\n${security ? `${security}\n` : ""}${analysis.rows.map((row) => `${row.state === "pass" ? ":white_check_mark:" : ":warning:"} ${row.criterion}`).join("\n")}\nCitations verified: ${analysis.trace.citedSources}`;
}

export async function runSlackCommand(command: SlackCommand, options: SlackAgentOptions): Promise<string> {
  if (command.action === "plan") return resultText(command.action, command.prUrl, await planPullRequest(command.prUrl, options.model, options.provider));
  const analysis = await analyzePullRequest(command.prUrl, options.model, { provider: options.provider, repoPath: options.repoPath, remember: true, memoryRoot: options.repoPath });
  if (command.action === "issue") return resultText(command.action, command.prUrl, await createGithubIssueFromAnalysis(command.prUrl, analysis));
  return resultText(command.action, command.prUrl, analysis);
}

export async function processSlackCommand(body: string, options: SlackAgentOptions): Promise<{ text: string; responseUrl?: string }> {
  const params = new URLSearchParams(body);
  const command = parseSlackCommand(params.get("text") ?? "");
  if (!command) return { text: "Usage: `review <GitHub PR URL>`, `plan <GitHub PR URL>`, or `issue <GitHub PR URL>`." };
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
