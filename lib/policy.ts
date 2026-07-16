import { promises as fs } from "node:fs";
import { join, relative, resolve } from "node:path";

export type MergeProofPolicy = { provider?: string; model?: string; retrievalTopK?: number; minCitationsPerCriterion?: number; instructions?: string };

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

export async function loadPolicy(root?: string): Promise<MergeProofPolicy> {
  if (!root) return {};
  const repositoryRoot = resolve(root);
  let policy: MergeProofPolicy = {};
  try {
    policy = JSON.parse(await fs.readFile(join(repositoryRoot, ".mergeproof", "config.json"), "utf8")) as MergeProofPolicy;
  } catch {
    // Policy is optional; defaults keep the analyzer usable in any checkout.
  }
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
      sections.push(`## ${label}\n${instructions.slice(0, 12000)}`);
    } catch {
      // Discovered instruction files can disappear during a concurrent checkout.
    }
  }
  if (sections.length) policy.instructions = sections.join("\n\n").slice(0, 30000);
  return policy;
}
