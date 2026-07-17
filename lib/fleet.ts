import { createHash } from "node:crypto";
import { askRepository, type AskResult } from "./ask";
import { runConsensus, type ConsensusResult } from "./consensus";
import { planWorkItem } from "./work-plan";
import type { ReviewPlan } from "./models";

export type FleetOptions = { repoPath?: string; models?: string[]; providers?: string[]; agent?: string; retrievalTopK?: number; effort?: string; profile?: string; relatedRepos?: string[]; mcp?: boolean; webSearch?: boolean };
export type FleetAskAgent = AskResult & { model: string; provider: string; fingerprint: string };
export type FleetAskResult = {
  mode: "ask";
  question: string;
  agents: FleetAskAgent[];
  agreement: number;
  disagreements: boolean;
  trace: { agents: number; headSha: string; evidenceSources: number; indexedChunks: number; elapsedMs: number; contextConsistent: true };
};
export type FleetPlanAgent = ReviewPlan & { model: string; provider: string };
export type FleetPlanResult = {
  mode: "plan";
  request: string;
  agents: FleetPlanAgent[];
  sharedSteps: string[];
  trace: { agents: number; headSha: string; elapsedMs: number; contextConsistent: true };
};
export type FleetReviewResult = { mode: "review"; consensus: ConsensusResult };
export type FleetResult = FleetAskResult | FleetPlanResult | FleetReviewResult;

function selectedModels(options: FleetOptions): string[] {
  const models = (options.models?.length ? options.models : (process.env.MERGEPROOF_FLEET_MODELS || process.env.MERGEPROOF_CONSENSUS_MODELS || process.env.OPENAI_MODEL || "gpt-5.6").split(",")).map((value) => value.trim()).filter(Boolean).slice(0, 5);
  if (models.length < 2) throw new Error("Fleet requires at least two models. Pass --model model-a model-b or set MERGEPROOF_FLEET_MODELS.");
  return models;
}

function selectedProviders(options: FleetOptions): string[] {
  return (options.providers?.length ? options.providers : (process.env.MERGEPROOF_FLEET_PROVIDERS || process.env.MERGEPROOF_PROVIDER || "openai").split(",")).map((value) => value.trim()).filter(Boolean);
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value.replace(/\s+/g, " ").trim().toLowerCase()).digest("hex");
}

function assertConsistentHeads(heads: string[]): string {
  const unique = [...new Set(heads)];
  if (unique.length !== 1) throw new Error(`Fleet context drift detected: agents observed ${unique.join(", ")}. Refusing to merge results from different repository heads.`);
  return unique[0];
}

export function summarizeFleetAnswers(answers: FleetAskAgent[]): Pick<FleetAskResult, "agreement" | "disagreements"> {
  if (!answers.length) return { agreement: 0, disagreements: true };
  const counts = new Map<string, number>();
  answers.forEach((answer) => counts.set(answer.fingerprint, (counts.get(answer.fingerprint) ?? 0) + 1));
  const majority = Math.max(...counts.values());
  return { agreement: majority / answers.length, disagreements: counts.size > 1 };
}

export async function runFleetAsk(question: string, options: FleetOptions = {}): Promise<FleetAskResult> {
  const request = question.trim();
  if (!request) throw new Error("Fleet ask requires a non-empty question.");
  const started = Date.now();
  const models = selectedModels(options);
  const providers = selectedProviders(options);
  const agents = await Promise.all(models.map(async (model, index) => {
    const provider = providers[index] || providers[0] || "openai";
    const result = await askRepository(request, model, { repoPath: options.repoPath, provider, agent: options.agent, retrievalTopK: options.retrievalTopK });
    return { ...result, model: result.trace.model, provider, fingerprint: fingerprint(result.answer) };
  }));
  const headSha = assertConsistentHeads(agents.map((agent) => agent.trace.headSha));
  const summary = summarizeFleetAnswers(agents);
  return { mode: "ask", question: request, agents, ...summary, trace: { agents: agents.length, headSha, evidenceSources: Math.min(...agents.map((agent) => agent.trace.evidenceSources)), indexedChunks: Math.max(...agents.map((agent) => agent.trace.indexedChunks)), elapsedMs: Date.now() - started, contextConsistent: true } };
}

function normalizedStepTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().toLowerCase();
}

export async function runFleetPlan(request: string, options: FleetOptions = {}): Promise<FleetPlanResult> {
  const workItem = request.trim();
  if (!workItem) throw new Error("Fleet plan requires a non-empty request.");
  const started = Date.now();
  const models = selectedModels(options);
  const providers = selectedProviders(options);
  const agents = await Promise.all(models.map(async (model, index) => {
    const provider = providers[index] || providers[0] || "openai";
    const result = await planWorkItem(workItem, model, { repoPath: options.repoPath, provider, agent: options.agent, retrievalTopK: options.retrievalTopK });
    return { ...result, model: result.trace.model, provider };
  }));
  const headSha = assertConsistentHeads(agents.map((agent) => agent.trace.headSha));
  const counts = new Map<string, { title: string; count: number }>();
  agents.flatMap((agent) => agent.steps.map((step) => step.title)).forEach((title) => {
    const key = normalizedStepTitle(title);
    const current = counts.get(key);
    counts.set(key, { title: current?.title ?? title, count: (current?.count ?? 0) + 1 });
  });
  const sharedSteps = [...counts.values()].filter((entry) => entry.count >= Math.ceil(agents.length / 2)).map((entry) => entry.title);
  return { mode: "plan", request: workItem, agents, sharedSteps, trace: { agents: agents.length, headSha, elapsedMs: Date.now() - started, contextConsistent: true } };
}

export async function runFleetReview(prUrl: string, options: FleetOptions = {}): Promise<FleetReviewResult> {
  return { mode: "review", consensus: await runConsensus(prUrl, { models: selectedModels(options), providers: selectedProviders(options), repoPath: options.repoPath, relatedRepos: options.relatedRepos, effort: options.effort, profile: options.profile, agent: options.agent, mcp: options.mcp, webSearch: options.webSearch }) };
}
