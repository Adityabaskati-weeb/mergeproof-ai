import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fetchChangeRequest, parseChangeRequestUrl } from "./change-request";
import { createModelProvider } from "./models";
import { loadPolicy } from "./policy";
import { publishChangeRequestComment } from "./change-publish";
import type { PostMergeAction } from "./types";

export type PostMergeActionResult = {
  name: string;
  prompt: string;
  answer: string;
  recordedAt: string;
  digest: string;
};

export type PostMergeRun = {
  pullRequestUrl: string;
  model: string;
  results: PostMergeActionResult[];
  trace: { enabledActions: number; recorded: boolean; publishedComment?: string };
};

export type PostMergeOptions = { repoPath?: string; provider?: string; actionName?: string; publishComment?: boolean };

const MAX_RECORDS = 100;

function recordPath(root: string): string { return join(resolve(root), ".mergeproof", "post-merge.jsonl"); }

function evidence(context: Awaited<ReturnType<typeof fetchChangeRequest>>) {
  return context.files.slice(0, 100).map((file) => ({ path: file.path, startLine: 1, endLine: 1, content: file.patch.slice(0, 6_000), commitSha: context.headSha, url: file.url }));
}

async function persistResults(root: string, results: PostMergeActionResult[]): Promise<void> {
  const path = recordPath(root);
  await mkdir(resolve(root, ".mergeproof"), { recursive: true });
  let previous: PostMergeActionResult[] = [];
  try { previous = (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean).slice(-MAX_RECORDS).map((line) => JSON.parse(line) as PostMergeActionResult); } catch { /* First post-merge run. */ }
  const retained = [...previous, ...results].slice(-MAX_RECORDS);
  await writeFile(path, `${retained.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
}

export function selectPostMergeActions(actions: PostMergeAction[], name?: string): PostMergeAction[] {
  const enabled = actions.filter((action) => action.enabled !== false);
  if (!name) return enabled;
  const selected = enabled.filter((action) => action.name.toLowerCase() === name.trim().toLowerCase());
  if (!selected.length) throw new Error(`Post-merge action '${name}' was not found or disabled.`);
  return selected;
}

export async function runPostMergeActions(prUrl: string, model?: string, options: PostMergeOptions = {}): Promise<PostMergeRun> {
  const target = parseChangeRequestUrl(prUrl);
  const context = await fetchChangeRequest(target);
  const root = options.repoPath || process.cwd();
  const policy = await loadPolicy(root);
  const actions = selectPostMergeActions(policy.postMergeActions ?? [], options.actionName);
  if (!actions.length) throw new Error("No enabled post-merge actions are configured in .mergeproof/config.json.");
  const providerName = (options.provider || policy.provider || process.env.MERGEPROOF_PROVIDER || "openai").toLowerCase();
  const selectedModel = model || policy.model || process.env.OPENAI_MODEL || "gpt-5.6";
  const provider = createModelProvider(selectedModel, providerName as Parameters<typeof createModelProvider>[1]);
  const repositoryEvidence = evidence(context);
  const results: PostMergeActionResult[] = [];
  for (const action of actions) {
    const prompt = `${action.prompt}\n\nPost-merge context: ${context.title}\nChange request: ${target.ref.url}\nHead SHA: ${context.headSha}\nThis is a read-only post-merge action. Do not claim to have executed commands or changed files. Return a concise result with explicit uncertainty.`;
    const answer = await provider.answer({ prompt, repository: `${target.ref.owner}/${target.ref.repo}`, headSha: context.headSha, status: "merged", repositoryEvidence }, AbortSignal.timeout(45_000));
    const recordedAt = new Date().toISOString();
    const digest = createHash("sha256").update(JSON.stringify({ name: action.name, prompt, answer: answer.answer, headSha: context.headSha })).digest("hex");
    results.push({ name: action.name, prompt, answer: answer.answer, recordedAt, digest });
  }
  await persistResults(root, results);
  let publishedComment: string | undefined;
  if (options.publishComment) publishedComment = await publishChangeRequestComment(prUrl, ["## MergeProof post-merge actions", `Model: \`${provider.name}\``, ...results.map((result) => `### ${result.name}\n${result.answer}\n\nDigest: \`${result.digest}\``)].join("\n\n"));
  return { pullRequestUrl: target.ref.url, model: provider.name, results, trace: { enabledActions: actions.length, recorded: true, ...(publishedComment ? { publishedComment } : {}) } };
}
