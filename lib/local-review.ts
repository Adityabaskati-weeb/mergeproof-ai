import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModelProvider } from "./models";
import { filterPathsByPolicy, loadPolicy } from "./policy";
import { retrieveLocalEvidence } from "./retrieval";
import { scanPullRequestSecurity } from "./security";
import { scanPullRequestPrivacy } from "./privacy";
import { scanSlopSignals } from "./slop";
import { scanExternalSecurity, type ExternalSecurityReport } from "./external-security";
import { scanLspDiagnostics } from "./lsp-diagnostics";
import { validateAnalysis } from "./validator";
import { attestAnalysis } from "./attestation";
import { readKnowledge } from "./knowledge";
import { normalizeReviewEffort, retrievalTopKForEffort } from "./effort";
import { normalizeReviewProfile } from "./profile";
import { combineInstructions, loadAdditionalInstructions, loadAgentProfile } from "./agents";
import { runHooks, type HookReport } from "./hooks";
import { suggestReviewers } from "./reviewers";
import { recordAuditEvent } from "./audit";
import { renderAnalysisPrompts } from "./models";
import { recordPrompt } from "./prompt-log";
import type { PullRequestContext } from "./github";
import type { Analysis } from "./types";

const DEFAULT_CRITERION = "The working-tree changes are correct, secure, tested, and consistent with repository instructions.";
const MAX_DIFF_BYTES = 20 * 1024 * 1024;
const MAX_UNTRACKED_BYTES = 250_000;

export type WorkingTreeFile = PullRequestContext["files"][number];
export type LocalReviewType = "all" | "committed" | "uncommitted";
export type LocalReviewOptions = { repoPath?: string; provider?: string; criteria?: string[]; retrievalTopK?: number; effort?: string; profile?: string; agent?: string; instructionFiles?: string[]; directories?: string[]; reviewType?: LocalReviewType; base?: string; baseCommit?: string; externalSecurity?: boolean; codeqlDatabase?: string; codeqlCreate?: boolean; codeqlLanguages?: string; codeqlQuery?: string; toolSarif?: string[]; lspDiagnostics?: string; hooks?: boolean; savePrompts?: boolean };

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

function diffPaths(root: string, args: string[]): string[] {
  return runGit(root, ["diff", "--name-only", "-z", ...args, "--"]).split("\0").filter(Boolean).map((path) => normalizePath(root, path));
}

export async function collectWorkingTreeChanges(root: string, directories: string[] = [], options: { reviewType?: LocalReviewType; base?: string; baseCommit?: string } = {}): Promise<{ files: WorkingTreeFile[]; digest: string; gitHeadSha: string }> {
  const repositoryRoot = resolve(root);
  const gitHeadSha = runGit(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  const reviewType = options.reviewType ?? "all";
  const baseRef = options.baseCommit?.trim() || options.base?.trim() || (reviewType === "committed" ? "HEAD~1" : undefined);
  if (baseRef && (!/^[A-Za-z0-9._/~^:-]+$/.test(baseRef) || baseRef.startsWith("-"))) throw new Error("Unsafe review base ref.");
  const statuses = parseStatus(repositoryRoot);
  const uncommittedPaths = reviewType === "committed" ? [] : [...new Set([...diffPaths(repositoryRoot, ["HEAD"]), ...statuses.keys()])];
  const committedPaths = reviewType === "uncommitted" || !baseRef ? [] : diffPaths(repositoryRoot, [baseRef, "HEAD"]);
  const scopes = directories.map((directory) => normalizeScopePath(repositoryRoot, directory)).filter(Boolean);
  const paths = [...new Set([...uncommittedPaths, ...committedPaths])].filter((path) => matchesScope(path, scopes)).sort();
  const files: WorkingTreeFile[] = [];
  for (const path of paths) {
    const status = reviewType === "committed" ? "committed" : statuses.get(path) ?? (baseRef ? "committed" : "modified");
    const content = status === "untracked" ? await readUntracked(repositoryRoot, path) : undefined;
    const diffArgs = baseRef && status !== "untracked" ? (reviewType === "committed" ? [baseRef, "HEAD"] : [baseRef]) : ["HEAD"];
    const patch = status === "untracked" ? newFilePatch(path, content ?? "") : runGit(repositoryRoot, ["diff", "--no-ext-diff", "--unified=20", ...diffArgs, "--", path]).trim();
    if (!patch || (status === "untracked" && content === undefined)) continue;
    const fileStats = stats(patch);
    files.push({ path, patch, status, additions: fileStats.additions, deletions: fileStats.deletions, url: pathToFileURL(join(repositoryRoot, path)).toString() });
  }
  if (!files.length) throw new Error("No staged, unstaged, or untracked changes were found.");
  const digest = createHash("sha256").update(JSON.stringify({ gitHeadSha, reviewType, baseRef, files: files.map(({ path, status, patch }) => ({ path, status, patch })) })).digest("hex");
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
  qualitySignals: ReturnType<typeof scanSlopSignals>;
  externalSecurity: ExternalSecurityReport;
  hooksBefore: HookReport;
};

export async function buildWorkingTreeReviewContext(options: LocalReviewOptions = {}): Promise<WorkingTreeReviewContext> {
  const repositoryRoot = resolve(options.repoPath || process.cwd());
  const policy = await loadPolicy(repositoryRoot);
  const hooksBefore = await runHooks(repositoryRoot, "beforeReview", options.hooks);
  const agentProfile = await loadAgentProfile(repositoryRoot, options.agent);
  const additionalInstructions = await loadAdditionalInstructions(repositoryRoot, options.instructionFiles);
  const effort = normalizeReviewEffort(options.effort || policy.effort || process.env.MERGEPROOF_REVIEW_EFFORT);
  const profile = normalizeReviewProfile(options.profile || policy.profile || process.env.MERGEPROOF_REVIEW_PROFILE);
  const changes = await collectWorkingTreeChanges(repositoryRoot, options.directories, { reviewType: options.reviewType, base: options.base, baseCommit: options.baseCommit });
  const scopedFiles = filterPathsByPolicy(changes.files, policy.pathFilters);
  if (!scopedFiles.length) throw new Error("No changes remain after configured review path filters.");
  const scopedChanges = { ...changes, files: scopedFiles };
  const reviewSha = `working-tree:${changes.digest}`;
  const ref = { owner: "local", repo: basename(repositoryRoot), number: 0, url: pathToFileURL(repositoryRoot).toString() };
  const retrieval = await retrieveLocalEvidence(repositoryRoot, reviewSha, `${basename(repositoryRoot)} ${scopedFiles.map((file) => file.path).join(" ")}`, options.retrievalTopK ?? policy.retrievalTopK ?? retrievalTopKForEffort(effort));
  const knowledge = await readKnowledge(repositoryRoot, ref, scopedFiles.map((file) => file.path), basename(repositoryRoot), 12);
  const criteria = uniqueCriteria(options.criteria);
  if (!criteria.length) criteria.push(DEFAULT_CRITERION);
  const customInstructions = [combineInstructions(policy.instructions, agentProfile), additionalInstructions].filter(Boolean).join("\n\n").slice(0, 40_000) || undefined;
  const context: PullRequestContext = { ref, title: `Working-tree review: ${basename(repositoryRoot)}`, body: criteria.join("\n"), headSha: reviewSha, baseSha: changes.gitHeadSha, files: scopedFiles, checks: [], commits: [], discussion: [], sources: new Set([ref.url, ...scopedFiles.map((file) => file.url), ...retrieval.chunks.map((chunk) => chunk.url)]), repositoryEvidence: retrieval.chunks, issues: [], customInstructions, knowledge, reviewEffort: effort, reviewProfile: profile };
  const baseSecurityFindings = scanPullRequestSecurity(context);
  const privacyFindings = scanPullRequestPrivacy(context);
  const qualitySignals = scanSlopSignals(context);
  const suggestedReviewers = await suggestReviewers(repositoryRoot, scopedFiles.map((file) => file.path));
  const externalSecurity = options.externalSecurity || options.codeqlDatabase || options.toolSarif?.length ? await scanExternalSecurity({ repoPath: repositoryRoot, commitSha: reviewSha, npmAudit: options.externalSecurity, semgrep: options.externalSecurity, codeqlDatabase: options.codeqlDatabase, codeqlCreate: options.codeqlCreate, codeqlLanguages: options.codeqlLanguages, codeqlQuery: options.codeqlQuery, sarifPaths: options.toolSarif }) : { findings: [], tools: [], unavailable: [] };
  const lsp = options.lspDiagnostics ? await scanLspDiagnostics(repositoryRoot, options.lspDiagnostics, reviewSha) : { findings: [], unavailable: [] };
  const externalSecurityWithLsp = { ...externalSecurity, unavailable: [...externalSecurity.unavailable, ...lsp.unavailable] };
  const securityFindings = [...baseSecurityFindings, ...privacyFindings, ...externalSecurity.findings, ...lsp.findings];
  context.securityFindings = securityFindings;
  context.qualitySignals = qualitySignals;
  context.suggestedReviewers = suggestedReviewers;
  return { repositoryRoot, context, changes: scopedChanges, criteria, policy, retrieval, knowledge, scopePaths: [...(options.directories ?? []), ...(policy.pathFilters ?? [])].map((directory) => directory.replace(/\\/g, "/").replace(/\/$/, "")).filter(Boolean), securityFindings, qualitySignals, externalSecurity: externalSecurityWithLsp, hooksBefore };
}

export async function reviewWorkingTree(model?: string, options: LocalReviewOptions = {}): Promise<Analysis> {
  const started = Date.now();
  const workingTree = await buildWorkingTreeReviewContext(options);
  const { context, criteria, policy, retrieval, changes, knowledge, scopePaths, securityFindings, qualitySignals, externalSecurity, hooksBefore } = workingTree;
  const providerName = (options.provider || policy.provider || process.env.MERGEPROOF_PROVIDER || "openai").toLowerCase();
  const selectedModel = model || policy.model || (providerName === "anthropic" ? process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514" : process.env.OPENAI_MODEL || "gpt-5.6");
  const provider = createModelProvider(selectedModel, providerName as Parameters<typeof createModelProvider>[1]);
  if (options.savePrompts || process.env.MERGEPROOF_SAVE_PROMPTS === "true") {
    await recordPrompt(workingTree.repositoryRoot, { action: "review", model: provider.name, ...renderAnalysisPrompts(context, criteria) });
  }
  const retrievalTrace = { enabled: true, indexedChunks: retrieval.indexedChunks, selectedChunks: retrieval.chunks.length, ...(retrieval.indexCommitSha ? { indexCommitSha: retrieval.indexCommitSha } : {}) };
  const result = await provider.analyze(context, criteria, AbortSignal.timeout(45_000));
  const analysis = validateAnalysis(result, context, criteria, provider.name, Date.now() - started, retrievalTrace, policy.minCitationsPerCriterion ?? 1, securityFindings, qualitySignals);
  const hooksAfter = await runHooks(workingTree.repositoryRoot, "afterReview", options.hooks);
  const hooks = { enabled: hooksBefore.enabled || hooksAfter.enabled, before: hooksBefore.before, after: hooksAfter.after, failed: [...hooksBefore.failed, ...hooksAfter.failed] };
  const gated = hooks.failed.length ? { ...analysis, decision: analysis.decision === "ready" ? "needs-evidence" as const : analysis.decision } : analysis;
  const withScope = { ...gated, suggestedReviewers: context.suggestedReviewers, trace: { ...gated.trace, scope: "working-tree" as const, reviewType: options.reviewType ?? "all", ...(options.base || options.baseCommit ? { reviewBase: options.baseCommit || options.base } : {}), workingTreeDigest: changes.digest, externalSecurity: { tools: externalSecurity.tools, unavailable: externalSecurity.unavailable }, knowledge: { enabled: true, matchedFacts: knowledge.length }, reviewEffort: context.reviewEffort, reviewProfile: context.reviewProfile, suggestedReviewers: context.suggestedReviewers?.length, reviewPaths: scopePaths, agent: options.agent, hooks } };
  const completed = { ...withScope, trace: { ...withScope.trace, attestation: attestAnalysis(withScope) } };
  try {
    await recordAuditEvent(workingTree.repositoryRoot, { action: "review", target: context.ref.url, decision: completed.decision, model: completed.trace.model, headSha: completed.trace.headSha, attestation: completed.trace.attestation?.digest, elapsedMs: completed.trace.elapsedMs });
  } catch {
    // Audit persistence must not turn a completed review into a runtime failure.
  }
  return completed;
}
