import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModelProvider } from "./models";
import { loadPolicy } from "./policy";
import { retrieveLocalEvidence } from "./retrieval";
import { scanPullRequestSecurity } from "./security";
import { scanExternalSecurity, type ExternalSecurityReport } from "./external-security";
import { validateAnalysis } from "./validator";
import { attestAnalysis } from "./attestation";
import { readKnowledge } from "./knowledge";
import { normalizeReviewEffort, retrievalTopKForEffort } from "./effort";
import { combineInstructions, loadAgentProfile } from "./agents";
import { runHooks, type HookReport } from "./hooks";
import type { PullRequestContext } from "./github";
import type { Analysis } from "./types";

const DEFAULT_CRITERION = "The working-tree changes are correct, secure, tested, and consistent with repository instructions.";
const MAX_DIFF_BYTES = 20 * 1024 * 1024;
const MAX_UNTRACKED_BYTES = 250_000;

export type WorkingTreeFile = PullRequestContext["files"][number];
export type LocalReviewOptions = { repoPath?: string; provider?: string; criteria?: string[]; retrievalTopK?: number; effort?: string; agent?: string; directories?: string[]; externalSecurity?: boolean; codeqlDatabase?: string; codeqlCreate?: boolean; codeqlLanguages?: string; codeqlQuery?: string; hooks?: boolean };

function runGit(root: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: MAX_DIFF_BYTES, stdio: ["ignore", "pipe", "pipe"] }).toString();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Git command failed.";
    throw new Error(`Local review requires a Git repository: ${detail}`);
  }
}

function normalizePath(root: string, value: string): string {
  const absolute = resolve(root, value);
  const relativePath = relative(resolve(root), absolute);
  if (!relativePath || relativePath.startsWith("..") || relativePath.includes(":") || relativePath.startsWith("\\")) throw new Error(`Unsafe working-tree path: ${value}`);
  return relativePath.replace(/\\/g, "/");
}

function parseStatus(root: string): Map<string, string> {
  const records = runGit(root, ["status", "--porcelain=v1", "--untracked-files=all", "-z"]).split("\0").filter(Boolean);
  const statuses = new Map<string, string>();
  for (const record of records) {
    if (record.length < 4) continue;
    const status = record.slice(0, 2).trim();
    const path = record.slice(3);
    statuses.set(normalizePath(root, path), status === "??" ? "untracked" : status || "modified");
  }
  return statuses;
}

function stats(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

function newFilePatch(path: string, content: string): string {
  const lines = content.split(/\r?\n/);
  return [`diff --git a/${path} b/${path}`, "new file mode 100644", "--- /dev/null", `+++ b/${path}`, `@@ -0,0 +1,${Math.max(1, lines.length)} @@`, ...lines.map((line) => `+${line}`)].join("\n");
}

async function readUntracked(root: string, path: string): Promise<string | undefined> {
  try {
    const value = await fs.readFile(join(root, path));
    if (value.length > MAX_UNTRACKED_BYTES || value.includes(0)) return undefined;
    return value.toString("utf8");
  } catch {
    return undefined;
  }
}

function normalizeScopePath(root: string, value: string): string {
  const trimmed = value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  return trimmed === "" || trimmed === "." ? "" : normalizePath(root, trimmed).toLowerCase();
}

function matchesScope(path: string, scopes: string[]): boolean {
  const normalized = path.toLowerCase();
  return scopes.length === 0 || scopes.some((scope) => normalized === scope || normalized.startsWith(`${scope}/`));
}

export async function collectWorkingTreeChanges(root: string, directories: string[] = []): Promise<{ files: WorkingTreeFile[]; digest: string; gitHeadSha: string }> {
  const repositoryRoot = resolve(root);
  const gitHeadSha = runGit(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  const statuses = parseStatus(repositoryRoot);
  const trackedPaths = runGit(repositoryRoot, ["diff", "--name-only", "-z", "HEAD", "--"]).split("\0").filter(Boolean).map((path) => normalizePath(repositoryRoot, path));
  const scopes = directories.map((directory) => normalizeScopePath(repositoryRoot, directory)).filter(Boolean);
  const paths = [...new Set([...trackedPaths, ...statuses.keys()])].filter((path) => matchesScope(path, scopes)).sort();
  const files: WorkingTreeFile[] = [];
  for (const path of paths) {
    const status = statuses.get(path) ?? "modified";
    const content = status === "untracked" ? await readUntracked(repositoryRoot, path) : undefined;
    const patch = status === "untracked" ? newFilePatch(path, content ?? "") : runGit(repositoryRoot, ["diff", "--no-ext-diff", "--unified=20", "HEAD", "--", path]).trim();
    if (!patch || (status === "untracked" && content === undefined)) continue;
    const fileStats = stats(patch);
    files.push({ path, patch, status, additions: fileStats.additions, deletions: fileStats.deletions, url: pathToFileURL(join(repositoryRoot, path)).toString() });
  }
  if (!files.length) throw new Error("No staged, unstaged, or untracked changes were found.");
  const digest = createHash("sha256").update(JSON.stringify({ gitHeadSha, files: files.map(({ path, status, patch }) => ({ path, status, patch })) })).digest("hex");
  return { files, digest, gitHeadSha };
}

function uniqueCriteria(criteria: string[] | undefined): string[] {
  return [...new Set((criteria ?? []).map((value) => value.trim()).filter(Boolean))];
}

export type WorkingTreeReviewContext = {
  repositoryRoot: string;
  context: PullRequestContext;
  changes: Awaited<ReturnType<typeof collectWorkingTreeChanges>>;
  criteria: string[];
  policy: Awaited<ReturnType<typeof loadPolicy>>;
  retrieval: Awaited<ReturnType<typeof retrieveLocalEvidence>>;
  knowledge: Awaited<ReturnType<typeof readKnowledge>>;
  scopePaths: string[];
  securityFindings: ReturnType<typeof scanPullRequestSecurity>;
  externalSecurity: ExternalSecurityReport;
  hooksBefore: HookReport;
};

export async function buildWorkingTreeReviewContext(options: LocalReviewOptions = {}): Promise<WorkingTreeReviewContext> {
  const repositoryRoot = resolve(options.repoPath || process.cwd());
  const policy = await loadPolicy(repositoryRoot);
  const hooksBefore = await runHooks(repositoryRoot, "beforeReview", options.hooks);
  const agentProfile = await loadAgentProfile(repositoryRoot, options.agent);
  const effort = normalizeReviewEffort(options.effort || policy.effort || process.env.MERGEPROOF_REVIEW_EFFORT);
  const changes = await collectWorkingTreeChanges(repositoryRoot, options.directories);
  const reviewSha = `working-tree:${changes.digest}`;
  const ref = { owner: "local", repo: basename(repositoryRoot), number: 0, url: pathToFileURL(repositoryRoot).toString() };
  const retrieval = await retrieveLocalEvidence(repositoryRoot, reviewSha, `${basename(repositoryRoot)} ${changes.files.map((file) => file.path).join(" ")}`, options.retrievalTopK ?? policy.retrievalTopK ?? retrievalTopKForEffort(effort));
  const knowledge = await readKnowledge(repositoryRoot, ref, changes.files.map((file) => file.path), basename(repositoryRoot), 12);
  const criteria = uniqueCriteria(options.criteria);
  if (!criteria.length) criteria.push(DEFAULT_CRITERION);
  const context: PullRequestContext = { ref, title: `Working-tree review: ${basename(repositoryRoot)}`, body: criteria.join("\n"), headSha: reviewSha, baseSha: changes.gitHeadSha, files: changes.files, checks: [], commits: [], discussion: [], sources: new Set([ref.url, ...changes.files.map((file) => file.url), ...retrieval.chunks.map((chunk) => chunk.url)]), repositoryEvidence: retrieval.chunks, issues: [], customInstructions: combineInstructions(policy.instructions, agentProfile), knowledge, reviewEffort: effort };
  const baseSecurityFindings = scanPullRequestSecurity(context);
  const externalSecurity = options.externalSecurity || options.codeqlDatabase ? await scanExternalSecurity({ repoPath: repositoryRoot, commitSha: reviewSha, npmAudit: options.externalSecurity, semgrep: options.externalSecurity, codeqlDatabase: options.codeqlDatabase, codeqlCreate: options.codeqlCreate, codeqlLanguages: options.codeqlLanguages, codeqlQuery: options.codeqlQuery }) : { findings: [], tools: [], unavailable: [] };
  const securityFindings = [...baseSecurityFindings, ...externalSecurity.findings];
  context.securityFindings = securityFindings;
  return { repositoryRoot, context, changes, criteria, policy, retrieval, knowledge, scopePaths: (options.directories ?? []).map((directory) => directory.replace(/\\/g, "/").replace(/\/$/, "")).filter(Boolean), securityFindings, externalSecurity, hooksBefore };
}

export async function reviewWorkingTree(model?: string, options: LocalReviewOptions = {}): Promise<Analysis> {
  const started = Date.now();
  const workingTree = await buildWorkingTreeReviewContext(options);
  const { context, criteria, policy, retrieval, changes, knowledge, scopePaths, securityFindings, externalSecurity, hooksBefore } = workingTree;
  const providerName = (options.provider || policy.provider || process.env.MERGEPROOF_PROVIDER || "openai").toLowerCase();
  const selectedModel = model || policy.model || (providerName === "anthropic" ? process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514" : process.env.OPENAI_MODEL || "gpt-5.6");
  const provider = createModelProvider(selectedModel, providerName as Parameters<typeof createModelProvider>[1]);
  const retrievalTrace = { enabled: true, indexedChunks: retrieval.indexedChunks, selectedChunks: retrieval.chunks.length, ...(retrieval.indexCommitSha ? { indexCommitSha: retrieval.indexCommitSha } : {}) };
  const result = await provider.analyze(context, criteria, AbortSignal.timeout(45_000));
  const analysis = validateAnalysis(result, context, criteria, provider.name, Date.now() - started, retrievalTrace, policy.minCitationsPerCriterion ?? 1, securityFindings);
  const hooksAfter = await runHooks(workingTree.repositoryRoot, "afterReview", options.hooks);
  const hooks = { enabled: hooksBefore.enabled || hooksAfter.enabled, before: hooksBefore.before, after: hooksAfter.after, failed: [...hooksBefore.failed, ...hooksAfter.failed] };
  const gated = hooks.failed.length ? { ...analysis, decision: analysis.decision === "ready" ? "needs-evidence" as const : analysis.decision } : analysis;
  const withScope = { ...gated, trace: { ...gated.trace, scope: "working-tree" as const, workingTreeDigest: changes.digest, externalSecurity: { tools: externalSecurity.tools, unavailable: externalSecurity.unavailable }, knowledge: { enabled: true, matchedFacts: knowledge.length }, reviewEffort: context.reviewEffort, reviewPaths: scopePaths, agent: options.agent, hooks } };
  return { ...withScope, trace: { ...withScope.trace, attestation: attestAnalysis(withScope) } };
}
