import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";

export type MergeProofPolicy = { provider?: string; model?: string; retrievalTopK?: number; minCitationsPerCriterion?: number; instructions?: string };

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
  if (sections.length) policy.instructions = sections.join("\n\n").slice(0, 30000);
  return policy;
}
