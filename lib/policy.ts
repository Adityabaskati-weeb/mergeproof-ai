import { promises as fs } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { CustomCheck, ReviewEffort, ReviewProfile } from "./types";

export type MergeProofPolicy = { provider?: string; model?: string; effort?: ReviewEffort; profile?: ReviewProfile; retrievalTopK?: number; minCitationsPerCriterion?: number; instructions?: string; customChecks?: CustomCheck[]; pathFilters?: string[]; requestChangesWorkflow?: boolean; highLevelSummary?: boolean; autoReview?: boolean; autoReviewDescriptionKeyword?: string; autoIncrementalReview?: boolean; autoPauseAfterReviewedCommits?: number; ignoreTitleKeywords?: string[]; reviewLabels?: string[]; includeDrafts?: boolean; baseBranches?: string[]; ignoreUsernames?: string[]; compatibility?: { source: string; importedAt: string }; extends?: string | string[] };

type PolicyFile = MergeProofPolicy & { extends?: string | string[] };

async function readPolicyFile(path: string, stack: string[] = []): Promise<PolicyFile> {
  const resolvedPath = resolve(path);
  if (stack.includes(resolvedPath) || stack.length >= 3) return {};
  try {
    const value = JSON.parse(await fs.readFile(resolvedPath, "utf8")) as PolicyFile;
    if (!value || typeof value !== "object") return {};
    const parents = typeof value.extends === "string" ? [value.extends] : Array.isArray(value.extends) ? value.extends.filter((entry): entry is string => typeof entry === "string") : [];
    const inherited = await Promise.all(parents.slice(0, 5).map((parent) => readPolicyFile(resolve(resolvePathDirectory(resolvedPath), parent), [...stack, resolvedPath])));
    const mergedChecks = inherited.flatMap((policy) => policy.customChecks ?? []);
    return { ...inherited.reduce<PolicyFile>((merged, policy) => ({ ...merged, ...policy }), {}), ...value, ...(mergedChecks.length || value.customChecks?.length ? { customChecks: [...mergedChecks, ...(value.customChecks ?? [])] } : {}), extends: value.extends };
  } catch {
    return {};
  }
}

function resolvePathDirectory(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
}

async function loadCustomChecks(repositoryRoot: string): Promise<CustomCheck[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(join(repositoryRoot, ".mergeproof", "checks.json"), "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is { name?: unknown; instructions?: unknown } => Boolean(value) && typeof value === "object")
      .map((value) => ({ name: typeof value.name === "string" ? value.name.trim() : "", instructions: typeof value.instructions === "string" ? value.instructions.trim() : "" }))
      .filter((value) => value.name.length > 0 && value.instructions.length > 0 && value.name.length <= 200 && value.instructions.length <= 4_000)
      .slice(0, 20);
  } catch {
    return [];
  }
}

async function collectInstructionFiles(root: string, directory: string, suffix: string, output: Array<[string, string]> = [], depth = 0): Promise<Array<[string, string]>> {
  if (depth > 4 || output.length >= 20) return output;
  try {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (output.length >= 20) break;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await collectInstructionFiles(root, path, suffix, output, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(suffix)) output.push([path, relative(root, path).replace(/\\/g, "/")]);
    }
  } catch {
    // Optional instruction directories are ignored when absent or unreadable.
  }
  return output;
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.trim().replace(/\\/g, "/");
  let expression = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*" && normalized[index + 1] === "*") {
      if (normalized[index + 2] === "/") {
        expression += "(?:.*/)?";
        index += 2;
      } else {
        expression += ".*";
        index += 1;
      }
    } else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${expression}$`, "i");
}

export function filterPathsByPolicy<T extends { path: string }>(paths: T[], patterns: string[] | undefined): T[] {
  const filters = (patterns ?? []).map((pattern) => pattern.trim().replace(/\\/g, "/")).filter(Boolean);
  if (!filters.length) return paths;
  const includes = filters.filter((pattern) => !pattern.startsWith("!"));
  const excludes = filters.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1));
  return paths.filter((entry) => {
    const path = entry.path.replace(/\\/g, "/");
    const included = includes.length === 0 || includes.some((pattern) => globToRegExp(pattern).test(path));
    const excluded = excludes.some((pattern) => globToRegExp(pattern).test(path));
    return included && !excluded;
  });
}

function appliesToPaths(content: string, changedPaths: string[]): boolean {
  if (!changedPaths.length) return true;
  const frontMatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const applyTo = frontMatter?.[1].match(/^applyTo:\s*["']?(.+?)["']?\s*$/m)?.[1];
  if (!applyTo || applyTo.trim() === "**") return true;
  const patterns = applyTo.split(",").map((pattern) => pattern.trim()).filter(Boolean);
  return changedPaths.some((path) => patterns.some((pattern) => globToRegExp(pattern).test(path.replace(/\\/g, "/"))));
}

export async function loadPolicy(root?: string, changedPaths: string[] = []): Promise<MergeProofPolicy> {
  if (!root) return {};
  const repositoryRoot = resolve(root);
  const localPolicyPath = join(repositoryRoot, ".mergeproof", "config.json");
  const centralPath = process.env.MERGEPROOF_CENTRAL_CONFIG?.trim();
  const centralPolicy = centralPath ? await readPolicyFile(centralPath) : {};
  const localPolicy = await readPolicyFile(localPolicyPath);
  const policy: MergeProofPolicy = { ...centralPolicy, ...localPolicy, ...(centralPolicy.customChecks || localPolicy.customChecks ? { customChecks: [...(centralPolicy.customChecks ?? []), ...(localPolicy.customChecks ?? [])] } : {}) };
  const configuredChecks = await loadCustomChecks(repositoryRoot);
  const inlineChecks = Array.isArray(policy.customChecks) ? policy.customChecks : [];
  const customChecks = [...configuredChecks, ...inlineChecks]
    .filter((check): check is CustomCheck => Boolean(check) && typeof check.name === "string" && typeof check.instructions === "string")
    .map((check) => ({ name: check.name.trim(), instructions: check.instructions.trim() }))
    .filter((check) => check.name && check.instructions && check.name.length <= 200 && check.instructions.length <= 4_000)
    .filter((check, index, values) => values.findIndex((candidate) => candidate.name.toLowerCase() === check.name.toLowerCase()) === index)
    .slice(0, 20);
  if (customChecks.length) policy.customChecks = customChecks;
  const instructionFiles = [
    [join(repositoryRoot, ".mergeproof", "instructions.md"), ".mergeproof/instructions.md"],
    [join(repositoryRoot, ".github", "copilot-instructions.md"), ".github/copilot-instructions.md"],
    [join(repositoryRoot, "AGENTS.md"), "AGENTS.md"],
    [join(repositoryRoot, "CLAUDE.md"), "CLAUDE.md"],
    [join(repositoryRoot, ".cursorrules"), ".cursorrules"],
  ] as const;
  const sections: string[] = [];
  for (const [path, label] of instructionFiles) {
    try {
      const instructions = await fs.readFile(path, "utf8");
      sections.push(`## ${label}\n${instructions.slice(0, 12000)}`);
    } catch {
      // Instruction files are optional.
    }
  }
  const discovered = await collectInstructionFiles(repositoryRoot, join(repositoryRoot, ".github", "instructions"), ".instructions.md");
  discovered.push(...await collectInstructionFiles(repositoryRoot, join(repositoryRoot, ".github", "skills"), "SKILL.md"));
  for (const [path, label] of discovered) {
    try {
      const instructions = await fs.readFile(path, "utf8");
      if (label.startsWith(".github/instructions/") && !appliesToPaths(instructions, changedPaths)) continue;
      sections.push(`## ${label}\n${instructions.slice(0, 12000)}`);
    } catch {
      // Discovered instruction files can disappear during a concurrent checkout.
    }
  }
  if (sections.length) policy.instructions = sections.join("\n\n").slice(0, 30000);
  return policy;
}
