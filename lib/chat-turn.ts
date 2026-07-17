import { analyzePullRequest } from "./analyze";
import { askRepository } from "./ask";
import { runImplementationAgent } from "./implementation-agent";
import { planWorkItem } from "./work-plan";
import { appendSessionTurn, openSession } from "./sessions";
import type { VerificationCommand } from "./local-agent";

export type ChatTurnAction = "ask" | "plan" | "review" | "implement";
export type ChatTurnOptions = { repoPath: string; sessionId?: string; model?: string; provider?: string; agent?: string; verify?: VerificationCommand; reReview?: boolean; apply?: boolean };
export type ChatTurnOutput = { sessionId: string; action: ChatTurnAction; request: string; output: Record<string, unknown> };

function reviewSummary(value: { decision: string; rows: Array<{ criterion: string; state: string; evidence: string }> }): string {
  return `Decision: ${value.decision}\n${value.rows.map((row) => `${row.state.toUpperCase()}: ${row.criterion} - ${row.evidence}`).join("\n")}`;
}

export async function runChatTurn(action: ChatTurnAction, request: string, options: ChatTurnOptions): Promise<ChatTurnOutput> {
  const prompt = request.trim();
  if (!prompt) throw new Error("Chat turns require a non-empty request.");
  const session = await openSession(options.repoPath, options.sessionId);
  try {
    if (action === "ask") {
      const output = await askRepository(prompt, options.model, { repoPath: options.repoPath, provider: options.provider, agent: options.agent });
      await appendSessionTurn(options.repoPath, session.id, { action, request: prompt, outcome: "success", summary: output.answer, trace: output.trace });
      return { sessionId: session.id, action, request: prompt, output: output as unknown as Record<string, unknown> };
    }
    if (action === "plan") {
      const output = await planWorkItem(prompt, options.model, { repoPath: options.repoPath, provider: options.provider, agent: options.agent });
      await appendSessionTurn(options.repoPath, session.id, { action, request: prompt, outcome: "success", summary: output.summary, trace: output.trace });
      return { sessionId: session.id, action, request: prompt, output: output as unknown as Record<string, unknown> };
    }
    if (action === "review") {
      const output = await analyzePullRequest(prompt, options.model, { repoPath: options.repoPath, provider: options.provider, agent: options.agent, effort: "medium" });
      await appendSessionTurn(options.repoPath, session.id, { action, request: prompt, outcome: "success", summary: reviewSummary(output), trace: output.trace });
      return { sessionId: session.id, action, request: prompt, output: output as unknown as Record<string, unknown> };
    }
    const output = await runImplementationAgent(prompt, options.model, { repoPath: options.repoPath, provider: options.provider, agent: options.agent, verify: options.verify, reReview: options.reReview, apply: options.apply });
    await appendSessionTurn(options.repoPath, session.id, { action, request: prompt, outcome: "success", summary: output.summary, trace: output.trace });
    return { sessionId: session.id, action, request: prompt, output: output as unknown as Record<string, unknown> };
  } catch (error) {
    await appendSessionTurn(options.repoPath, session.id, { action, request: prompt, outcome: "error", summary: error instanceof Error ? error.message : "Chat action failed." });
    throw error;
  }
}
