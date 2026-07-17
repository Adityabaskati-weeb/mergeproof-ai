import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { analyzePullRequest } from "./analyze";
import { askRepository } from "./ask";
import { planWorkItem } from "./work-plan";
import { runImplementationAgent } from "./implementation-agent";
import type { VerificationCommand } from "./local-agent";

export type ChatAction = "ask" | "plan" | "review" | "implement" | "help" | "exit";
export type ChatInput = { action: ChatAction; request: string };
export type ChatOptions = { repoPath: string; model?: string; provider?: string; agent?: string; verify?: VerificationCommand; reReview?: boolean; apply?: boolean };

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
  console.log("Bare text is treated as a read-only repository question. Implementations always use an ephemeral worktree and only apply with --apply after explicit verification.");
}

async function runChatAction(inputValue: ChatInput, options: ChatOptions): Promise<boolean> {
  if (inputValue.action === "exit") return false;
  if (inputValue.action === "help") {
    printHelp();
    return true;
  }
  if (!inputValue.request) {
    printHelp();
    return true;
  }
  if (inputValue.action === "ask") {
    const result = await askRepository(inputValue.request, options.model, { repoPath: options.repoPath, provider: options.provider, agent: options.agent });
    console.log(`\n${result.answer}\n\n[read-only evidence: ${result.trace.evidenceSources}/${result.trace.indexedChunks} sources | ${result.trace.model}]`);
    return true;
  }
  if (inputValue.action === "plan") {
    const result = await planWorkItem(inputValue.request, options.model, { repoPath: options.repoPath, provider: options.provider, agent: options.agent });
    console.log(`\n${result.summary}\n${result.steps.map((step, index) => `${index + 1}. ${step.title}: ${step.detail}`).join("\n")}\n\n[${result.trace.citedSources}/${result.trace.fetchedSources} citations verified | ${result.trace.model}]`);
    return true;
  }
  if (inputValue.action === "review") {
    const result = await analyzePullRequest(inputValue.request, options.model, { repoPath: options.repoPath, provider: options.provider, agent: options.agent, effort: "medium" });
    console.log(`\nMERGEPROOF: ${result.decision.toUpperCase()}`);
    for (const row of result.rows) console.log(`${row.state === "pass" ? "[x]" : row.state === "warn" ? "[!]" : "[ ]"} ${row.criterion}: ${row.evidence}`);
    console.log(`\n[${result.trace.citedSources} citations | ${result.trace.unsupportedClaims} unsupported claims | ${result.trace.model}]`);
    return true;
  }
  const result = await runImplementationAgent(inputValue.request, options.model, { repoPath: options.repoPath, provider: options.provider, agent: options.agent, verify: options.verify, reReview: options.reReview, apply: options.apply });
  console.log(`\n${result.summary}\n\n${result.patch || "No safe patch was proposed."}\n\n[verification: ${result.trace.verified ? "passed" : "not passed"}${result.trace.verificationCommand ? ` via ${result.trace.verificationCommand}` : ""} | applied: ${result.trace.appliedToCheckout ? "yes" : "no"}]`);
  return true;
}

export async function runInteractiveChat(options: ChatOptions): Promise<void> {
  const session = readline.createInterface({ input, output, terminal: Boolean(input.isTTY) });
  console.log("MergeProof interactive session. Type /help for commands or /exit to leave.");
  try {
    let active = true;
    while (active) {
      const line = await session.question("mergeproof> ");
      if (line === undefined) break;
      try {
        active = await runChatAction(parseChatInput(line), options);
      } catch (error) {
        console.error(`MergeProof chat error: ${error instanceof Error ? error.message : "Action failed."}`);
      }
    }
  } finally {
    session.close();
  }
}
