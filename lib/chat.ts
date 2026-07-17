import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { analyzePullRequest } from "./analyze";
import { askRepository } from "./ask";
import { planWorkItem } from "./work-plan";
import { runImplementationAgent } from "./implementation-agent";
import type { VerificationCommand } from "./local-agent";
import { appendSessionTurn, openSession } from "./sessions";

export type ChatAction = "ask" | "plan" | "review" | "implement" | "help" | "exit";
export type ChatInput = { action: ChatAction; request: string };
export type ChatOptions = { repoPath: string; model?: string; provider?: string; agent?: string; verify?: VerificationCommand; reReview?: boolean; apply?: boolean; sessionId?: string };
export type ChatTurnResult = { continue: boolean; summary?: string; trace?: Record<string, unknown> };

export function parseChatInput(line: string): ChatInput {
  const value = line.trim();
  if (!value) return { action: "help", request: "" };
  const normalized = value.replace(/^\/+/, "");
  const match = normalized.match(/^(ask|plan|review|implement|help|exit|quit)\b\s*(.*)$/i);
  if (!match) return { action: "ask", request: value };
  const command = match[1].toLowerCase() === "quit" ? "exit" : match[1].toLowerCase();
  return { action: command as ChatAction, request: match[2].trim() };
}

function printHelp(): void {
  console.log("Commands: ask <question>, plan <request>, review <GitHub/GitLab/Bitbucket/Azure PR URL>, implement <request>, /help, /exit");
  console.log("Bare text is treated as a read-only repository question. Implementations always use an ephemeral worktree and only apply with --apply after explicit verification. Sessions are stored in .mergeproof/sessions and can be resumed with --session.");
}

async function runChatAction(inputValue: ChatInput, options: ChatOptions): Promise<ChatTurnResult> {
  if (inputValue.action === "exit") return { continue: false };
  if (inputValue.action === "help") {
    printHelp();
    return { continue: true };
  }
  if (!inputValue.request) {
    printHelp();
    return { continue: true };
  }
  if (inputValue.action === "ask") {
    const result = await askRepository(inputValue.request, options.model, { repoPath: options.repoPath, provider: options.provider, agent: options.agent });
    console.log(`\n${result.answer}\n\n[read-only evidence: ${result.trace.evidenceSources}/${result.trace.indexedChunks} sources | ${result.trace.model}]`);
    return { continue: true, summary: result.answer, trace: result.trace };
  }
  if (inputValue.action === "plan") {
    const result = await planWorkItem(inputValue.request, options.model, { repoPath: options.repoPath, provider: options.provider, agent: options.agent });
    console.log(`\n${result.summary}\n${result.steps.map((step, index) => `${index + 1}. ${step.title}: ${step.detail}`).join("\n")}\n\n[${result.trace.citedSources}/${result.trace.fetchedSources} citations verified | ${result.trace.model}]`);
    return { continue: true, summary: result.summary, trace: result.trace };
  }
  if (inputValue.action === "review") {
    const result = await analyzePullRequest(inputValue.request, options.model, { repoPath: options.repoPath, provider: options.provider, agent: options.agent, effort: "medium" });
    console.log(`\nMERGEPROOF: ${result.decision.toUpperCase()}`);
    for (const row of result.rows) console.log(`${row.state === "pass" ? "[x]" : row.state === "warn" ? "[!]" : "[ ]"} ${row.criterion}: ${row.evidence}`);
    console.log(`\n[${result.trace.citedSources} citations | ${result.trace.unsupportedClaims} unsupported claims | ${result.trace.model}]`);
    return { continue: true, summary: `Decision: ${result.decision}\n${result.rows.map((row) => `${row.state.toUpperCase()}: ${row.criterion} - ${row.evidence}`).join("\n")}`, trace: result.trace };
  }
  const result = await runImplementationAgent(inputValue.request, options.model, { repoPath: options.repoPath, provider: options.provider, agent: options.agent, verify: options.verify, reReview: options.reReview, apply: options.apply });
  console.log(`\n${result.summary}\n\n${result.patch || "No safe patch was proposed."}\n\n[verification: ${result.trace.verified ? "passed" : "not passed"}${result.trace.verificationCommand ? ` via ${result.trace.verificationCommand}` : ""} | applied: ${result.trace.appliedToCheckout ? "yes" : "no"}]`);
  return { continue: true, summary: result.summary, trace: result.trace };
}

export async function runInteractiveChat(options: ChatOptions): Promise<void> {
  const session = readline.createInterface({ input, output, terminal: Boolean(input.isTTY) });
  const persisted = await openSession(options.repoPath, options.sessionId);
  console.log(`MergeProof interactive session ${persisted.id}. Type /help for commands or /exit to leave.`);
  if (persisted.turns.length) console.log(`Resumed ${persisted.turns.length} prior turn(s) from ${persisted.updatedAt}.`);
  try {
    let active = true;
    while (active) {
      const line = await session.question("mergeproof> ");
      if (line === undefined) break;
      try {
        const inputValue = parseChatInput(line);
        const result = await runChatAction(inputValue, options);
        active = result.continue;
        if (result.summary) await appendSessionTurn(options.repoPath, persisted.id, { action: inputValue.action, request: inputValue.request, outcome: "success", summary: result.summary, trace: result.trace });
      } catch (error) {
        console.error(`MergeProof chat error: ${error instanceof Error ? error.message : "Action failed."}`);
        const inputValue = parseChatInput(line);
        await appendSessionTurn(options.repoPath, persisted.id, { action: inputValue.action, request: inputValue.request, outcome: "error", summary: error instanceof Error ? error.message : "Action failed." });
      }
    }
  } finally {
    session.close();
  }
}
