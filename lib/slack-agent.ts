import { createHmac, timingSafeEqual } from "node:crypto";
import { analyzePullRequest } from "./analyze";
import { createGithubIssueFromAnalysis } from "./github-issues";
import { planPullRequest } from "./plan";
import { parseChangeRequestUrl } from "./change-request";
import { fixPullRequest, simplifyPullRequest } from "./fix";
import { generateTestsPullRequest } from "./tests";
import { readSlackThread, recordSlackThread } from "./slack-memory";
import { loadSlackAutomations, matchSlackAutomation } from "./slack-automations";
import { addKnowledge } from "./knowledge";
import { createGithubClient } from "./github-auth";
import { autofixPullRequest } from "./autofix";
import { VERIFICATION_COMMANDS, type VerificationCommand } from "./local-agent";
import { parseIssueUrl, planIssue } from "./issue-plan";
import { runConsensus } from "./consensus";
import { updateReviewState } from "./review-state";

export type SlackAgentOptions = { signingSecret: string; botToken?: string; repoPath?: string; model?: string; provider?: string; log?: (message: string) => void };
export type SlackCommand = { action: "review" | "investigate" | "walkthrough" | "plan" | "fix" | "simplify" | "tests" | "consensus" | "issue" | "learn" | "rate" | "autofix" | "pause" | "resume"; prUrl?: string; fact?: string };

export function verifySlackRequestSignature(body: string, timestamp: string | undefined, signature: string | undefined, secret: string, now = Date.now()): boolean {
  if (!timestamp || !signature || !secret || Math.abs(now - Number(timestamp) * 1000) > 5 * 60 * 1000) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function parseSlackCommand(text: string, fallbackPrUrl?: string): SlackCommand | undefined {
  const normalized = text.trim().replace(/^<@[^>]+>\s*/, "");
  const actionMatch = normalized.match(/\b(review|investigate|walkthrough|summary|diagram|plan|fix|simplify|tests|consensus|issue|learn|rate(?:\s+limit)?|autofix|pause|resume)\b/i);
  const urlMatch = normalized.match(/https:\/\/\S+/i);
  const action = actionMatch?.[1]?.toLowerCase() ?? (urlMatch ? "investigate" : undefined);
  if (!action) return undefined;
  if (action.startsWith("rate")) return { action: "rate" };
  if (action === "pause" || action === "resume") return { action };
  if (action === "learn") {
    const prUrl = (urlMatch?.[0] ?? fallbackPrUrl)?.replace(/[),.;]+$/, "").replace(/\/$/, "");
    const fact = normalized.replace(actionMatch![0], "").replace(urlMatch?.[0] ?? "", "").trim();
    if (!prUrl || !fact) return undefined;
    try { parseChangeRequestUrl(prUrl); } catch { return undefined; }
    return { action: "learn", prUrl, fact: fact.slice(0, 2_000) };
  }
  const prUrl = (urlMatch?.[0] ?? fallbackPrUrl)?.replace(/[),.;]+$/, "").replace(/\/$/, "");
  if (!prUrl) return undefined;
  try { parseChangeRequestUrl(prUrl); } catch {
    if (action !== "plan") return undefined;
    try { parseIssueUrl(prUrl); } catch { return undefined; }
  }
  const normalizedAction = action === "summary" || action === "diagram" ? "walkthrough" : action;
  return { action: normalizedAction as Exclude<SlackCommand["action"], "learn" | "rate">, prUrl };
}

function resultText(action: SlackCommand["action"], prUrl: string, value: Awaited<ReturnType<typeof analyzePullRequest>> | Awaited<ReturnType<typeof planPullRequest>> | Awaited<ReturnType<typeof fixPullRequest>> | Awaited<ReturnType<typeof generateTestsPullRequest>> | Awaited<ReturnType<typeof runConsensus>> | string): string {
  if (typeof value === "string") return `MergeProof created a follow-up issue: ${value}`;
  if (action === "plan") {
    const plan = value as Awaited<ReturnType<typeof planPullRequest>>;
    return `MergeProof plan for ${prUrl}\n${plan.summary}\n${plan.steps.map((step, index) => `${index + 1}. ${step.title}`).join("\n")}`;
  }
  if (action === "fix" || action === "simplify" || action === "tests") {
    const suggestion = value as Awaited<ReturnType<typeof fixPullRequest>> | Awaited<ReturnType<typeof generateTestsPullRequest>>;
    return `MergeProof ${action} suggestion for ${prUrl}\n${suggestion.summary}\nChanged paths: ${suggestion.trace.changedPaths.join(", ") || "none"}\n\n${suggestion.patch.slice(0, 6000) || "No patch was proposed."}`;
  }
  if (action === "consensus") {
    const consensus = value as Awaited<ReturnType<typeof runConsensus>>;
    return `MergeProof consensus *${consensus.decision}* for ${prUrl}\nAgents: ${consensus.trace.agents} | Agreement: ${Math.round(consensus.trace.agreement * 100)}%\n${consensus.rows.map((row) => `${row.agreement >= 0.67 ? ":white_check_mark:" : ":warning:"} ${row.criterion} (${Math.round(row.agreement * 100)}%)`).join("\n")}`;
  }
  if (action === "walkthrough") {
    const analysis = value as Awaited<ReturnType<typeof analyzePullRequest>>;
    const walkthrough = analysis.walkthrough;
    return `MergeProof walkthrough for ${prUrl}\n${walkthrough?.summary ?? "No walkthrough was generated."}\nChange stack: ${walkthrough?.changeStack.map((layer) => `${layer.title} (${layer.files.length})`).join(" -> ") ?? "none"}\nReview effort: ${walkthrough?.effortScore ?? "unknown"}/5\nCited files: ${walkthrough?.citations.length ?? 0}`;
  }
  const analysis = value as Awaited<ReturnType<typeof analyzePullRequest>>;
  const security = (analysis.securityFindings ?? []).map((finding) => `:rotating_light: ${finding.severity} ${finding.path}:${finding.line} ${finding.title}`).join("\n");
  return `MergeProof *${analysis.decision}* for ${prUrl}\n${security ? `${security}\n` : ""}${analysis.rows.map((row) => `${row.state === "pass" ? ":white_check_mark:" : ":warning:"} ${row.criterion}`).join("\n")}\nCitations verified: ${analysis.trace.citedSources}`;
}

export async function runSlackCommand(command: SlackCommand, options: SlackAgentOptions): Promise<string> {
  if (command.action === "rate") {
    const client = await createGithubClient(true);
    const result = await client.rest.rateLimit.get();
    const core = result.data.resources.core;
    return `GitHub API rate limit: ${core.remaining}/${core.limit} remaining; resets ${new Date(core.reset * 1000).toISOString()}.`;
  }
  if (command.action === "learn") {
    if (!command.prUrl || !command.fact) throw new Error("Learn requires a fact and a change-request URL in the message or thread.");
    const target = parseChangeRequestUrl(command.prUrl);
    const fact = await addKnowledge(options.repoPath || process.cwd(), target.ref, command.fact);
    return `MergeProof learned for ${fact.repository}: ${fact.content}`;
  }
  if (command.action === "pause" || command.action === "resume") {
    if (!options.repoPath) throw new Error("Slack review lifecycle controls require an explicit repository path.");
    const state = await updateReviewState(options.repoPath, { paused: command.action === "pause", reason: `${command.action === "pause" ? "Paused" : "Resumed"} by Slack command.` });
    return `MergeProof automatic reviews are now ${state.paused ? "paused" : "resumed"}.`;
  }
  if (!command.prUrl) throw new Error(`${command.action} requires a change-request URL.`);
  const prUrl = command.prUrl;
  if (command.action === "autofix") {
    if (process.env.MERGEPROOF_SLACK_AUTOFIX_ENABLED !== "true") throw new Error("Slack autofix is disabled. Set MERGEPROOF_SLACK_AUTOFIX_ENABLED=true only for an explicitly trusted workspace.");
    if (!options.repoPath) throw new Error("Slack autofix requires the server to have an explicit repository checkout.");
    const verify = process.env.MERGEPROOF_SLACK_AUTOFIX_VERIFY as VerificationCommand | undefined;
    if (!verify || !VERIFICATION_COMMANDS.includes(verify)) throw new Error(`Slack autofix requires MERGEPROOF_SLACK_AUTOFIX_VERIFY to be one of: ${VERIFICATION_COMMANDS.join(", ")}.`);
    const result = await autofixPullRequest(prUrl, options.model, { provider: options.provider, repoPath: options.repoPath, verify, reReview: true, createPr: true });
    return `MergeProof autofix for ${prUrl}\n${result.summary}\nVerification: ${result.trace.verified ? "passed" : "failed"}\nCreated PR: ${result.trace.pullRequestUrl ?? "none"}`;
  }
  if (command.action === "plan") {
    try { parseIssueUrl(prUrl); } catch { return resultText(command.action, prUrl, await planPullRequest(prUrl, options.model, options.provider)); }
    return resultText(command.action, prUrl, await planIssue(prUrl, options.model, options.provider, { repoPath: options.repoPath }));
  }
  if (command.action === "consensus") return resultText(command.action, prUrl, await runConsensus(prUrl, { models: options.model ? [options.model, options.model] : undefined, provider: options.provider, providers: options.provider ? [options.provider, options.provider] : undefined, repoPath: options.repoPath }));
  if (command.action === "fix") return resultText(command.action, prUrl, await fixPullRequest(prUrl, options.model, { provider: options.provider, repoPath: options.repoPath }));
  if (command.action === "simplify") return resultText(command.action, prUrl, await simplifyPullRequest(prUrl, options.model, { provider: options.provider, repoPath: options.repoPath }));
  if (command.action === "tests") return resultText(command.action, prUrl, await generateTestsPullRequest(prUrl, options.model, { provider: options.provider, repoPath: options.repoPath }));
  const analysis = await analyzePullRequest(prUrl, options.model, { provider: options.provider, repoPath: options.repoPath, remember: true, memoryRoot: options.repoPath });
  if (command.action === "issue") {
    if (parseChangeRequestUrl(prUrl).provider !== "github") throw new Error("Slack issue creation currently supports GitHub pull requests only.");
    return resultText(command.action, prUrl, await createGithubIssueFromAnalysis(prUrl, analysis));
  }
  return resultText(command.action, prUrl, analysis);
}

export async function processSlackCommand(body: string, options: SlackAgentOptions): Promise<{ text: string; responseUrl?: string }> {
  const params = new URLSearchParams(body);
  const command = parseSlackCommand(params.get("text") ?? "");
  if (!command) return { text: "Usage: `review|investigate|walkthrough|plan|fix|simplify|tests|consensus|autofix <change-request URL>`, `learn <fact> <change-request URL>`, `pause`, `resume`, `rate`, or `issue <GitHub PR URL>`." };
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
  const automation = matchSlackAutomation(await loadSlackAutomations(options.repoPath || process.cwd()), event);
  const command = parseSlackCommand(event.text ?? "", previous?.prUrl) ?? (automation ? parseSlackCommand(`${automation.action} ${event.text ?? ""}`, previous?.prUrl) : undefined);
  if (!command) return { accepted: true, ignored: true, text: "Mention MergeProof with `review`, `investigate`, `walkthrough`, `plan`, `fix`, `simplify`, `tests`, `consensus`, `autofix`, `learn`, `pause`, `resume`, or `rate`." };
  const text = await runSlackCommand(command, options);
  if (threadKey && command.prUrl) await recordSlackThread(options.repoPath || process.cwd(), threadKey, command.prUrl);
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
