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
  try {
    const instructions = await fs.readFile(join(repositoryRoot, ".mergeproof", "instructions.md"), "utf8");
    policy.instructions = instructions.slice(0, 20000);
  } catch {
    // Instructions are optional.
  }
  return policy;
}
