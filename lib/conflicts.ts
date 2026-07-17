import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createModelProvider, type ModelFix } from "./models";
import { validatePatchPaths } from "./fix";
import type { PullRequestContext } from "./github";

export type ConflictHunk = { startLine: number; current: string; incoming: string };
export type ConflictFile = { path: string; url: string; content: string; hunks: ConflictHunk[] };
export type ConflictReport = { repository: string; headSha: string; files: ConflictFile[]; conflictCount: number };
export type ConflictResolution = ModelFix & { trace: { model: string; headSha: string; changedPaths: string[]; applied: boolean } };

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

export function parseConflictMarkers(content: string): ConflictHunk[] {
  const lines = content.split(/\r?\n/);
  const hunks: ConflictHunk[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith("<<<<<<<")) continue;
    const startLine = index + 1;
    const current: string[] = [];
    const incoming: string[] = [];
    index += 1;
    while (index < lines.length && !lines[index].startsWith("=======")) current.push(lines[index++]);
    if (index >= lines.length) break;
    index += 1;
    while (index < lines.length && !lines[index].startsWith(">>>>>>>")) incoming.push(lines[index++]);
    hunks.push({ startLine, current: current.join("\n"), incoming: incoming.join("\n") });
  }
  return hunks;
}

export async function inspectConflicts(root: string): Promise<ConflictReport> {
  const repositoryRoot = resolve(root);
  const headSha = git(repositoryRoot, ["rev-parse", "HEAD"]).trim();
  const paths = git(repositoryRoot, ["diff", "--name-only", "--diff-filter=U", "-z"]).split("\0").filter(Boolean).map((path) => path.replace(/\\/g, "/"));
  const files: ConflictFile[] = [];
  for (const path of paths) {
    const content = await readFile(join(repositoryRoot, path), "utf8");
    files.push({ path, url: pathToFileURL(join(repositoryRoot, path)).toString(), content: content.slice(0, 1_000_000), hunks: parseConflictMarkers(content) });
  }
  return { repository: basename(repositoryRoot), headSha, files, conflictCount: files.reduce((count, file) => count + file.hunks.length, 0) };
}

function conflictContext(report: ConflictReport, criteria: string[]): PullRequestContext {
  const ref = { owner: "local", repo: report.repository, number: 0, url: pathToFileURL(report.repository).toString() };
  const files = report.files.map((file) => ({ path: file.path, patch: `diff --git a/${file.path} b/${file.path}\n--- a/${file.path}\n+++ b/${file.path}\n@@ -1 +1 @@\n${file.content.split(/\r?\n/).map((line) => `+${line}`).join("\n")}`, status: "conflicted", additions: file.content.split(/\r?\n/).length, deletions: 0, url: file.url }));
  return { ref, title: `Merge conflict resolution: ${report.repository}`, body: criteria.join("\n"), headSha: `conflicts:${report.headSha}`, baseSha: report.headSha, files, checks: [], commits: [], discussion: [], sources: new Set([ref.url, ...files.map((file) => file.url)]), repositoryEvidence: [], issues: [] };
}

export async function resolveConflicts(root: string, model?: string, options: { provider?: string; criteria?: string[]; apply?: boolean } = {}): Promise<ConflictResolution> {
  const report = await inspectConflicts(root);
  if (!report.files.length || !report.conflictCount) throw new Error("No active Git merge conflicts were found.");
  const criteria = options.criteria?.filter(Boolean).length ? options.criteria!.filter(Boolean) : ["Every active merge conflict is resolved without changing unrelated behavior."];
  const providerName = (options.provider || process.env.MERGEPROOF_PROVIDER || "openai").toLowerCase();
  const selectedModel = model || process.env.OPENAI_MODEL || "gpt-5.6";
  const provider = createModelProvider(selectedModel, providerName as Parameters<typeof createModelProvider>[1]);
  const result = await provider.resolve(conflictContext(report, criteria), criteria, AbortSignal.timeout(45_000));
  const patch = result.patch.replace(/^```(?:diff|patch)?\s*/i, "").replace(/\s*```$/, "").trim();
  const changedPaths = patch ? validatePatchPaths(patch) : [];
  const conflictPaths = new Set(report.files.map((file) => file.path));
  if (changedPaths.some((path) => !conflictPaths.has(path))) throw new Error("The conflict resolution patch changes a file that was not conflicted.");
  let applied = false;
  if (options.apply) {
    if (!patch) throw new Error("The model did not produce a resolution patch.");
    execFileSync("git", ["apply", "--3way", "--whitespace=error"], { cwd: resolve(root), input: patch, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    execFileSync("git", ["add", "--", ...changedPaths], { cwd: resolve(root), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const remaining = await inspectConflicts(root);
    if (remaining.conflictCount) throw new Error(`Resolution left ${remaining.conflictCount} active conflict hunk(s).`);
    applied = true;
  }
  return { summary: result.summary, patch, trace: { model: provider.name, headSha: report.headSha, changedPaths, applied } };
}
