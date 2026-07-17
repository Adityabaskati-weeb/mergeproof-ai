import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { loadPolicy, type MergeProofPolicy } from "./policy";
import { loadRecipes } from "./recipes";

const CONFIG_PATH = ".mergeproof/config.json";

export const DEFAULT_CONFIGURATION: MergeProofPolicy = {
  provider: "openai",
  model: "gpt-5.6",
  effort: "medium",
  retrievalTopK: 8,
  minCitationsPerCriterion: 1,
};

export type ConfigurationSnapshot = {
  path: string;
  exists: boolean;
  policy: MergeProofPolicy;
  instructionFiles: string[];
  recipes: string[];
  customChecks: string[];
};

async function exists(path: string): Promise<boolean> {
  try { await fs.access(path); return true; } catch { return false; }
}

export async function readMergeProofConfiguration(root: string): Promise<ConfigurationSnapshot> {
  const repositoryRoot = resolve(root);
  const path = join(repositoryRoot, CONFIG_PATH);
  let policy: MergeProofPolicy = {};
  try { policy = await loadPolicy(repositoryRoot); } catch { /* Optional policy uses analyzer defaults. */ }
  const instructionCandidates = [
    ".mergeproof/instructions.md",
    ".github/copilot-instructions.md",
    "AGENTS.md",
    "CLAUDE.md",
    ".cursorrules",
  ];
  const instructionFiles: string[] = [];
  for (const relativePath of instructionCandidates) if (await exists(join(repositoryRoot, relativePath))) instructionFiles.push(relativePath);
  const recipes = await loadRecipes(repositoryRoot);
  return { path: CONFIG_PATH, exists: await exists(path), policy, instructionFiles, recipes: recipes.map((recipe) => recipe.name), customChecks: (policy.customChecks ?? []).map((check) => check.name) };
}

export async function generateMergeProofConfiguration(root: string, force = false): Promise<{ created: boolean; path: string; policy: MergeProofPolicy }> {
  const repositoryRoot = resolve(root);
  const path = join(repositoryRoot, CONFIG_PATH);
  if (!force && await exists(path)) return { created: false, path: CONFIG_PATH, policy: JSON.parse(await fs.readFile(path, "utf8")) as MergeProofPolicy };
  await fs.mkdir(join(repositoryRoot, ".mergeproof"), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify(DEFAULT_CONFIGURATION, null, 2)}\n`, "utf8");
  return { created: true, path: CONFIG_PATH, policy: DEFAULT_CONFIGURATION };
}

export function renderConfiguration(snapshot: ConfigurationSnapshot): string {
  return [
    "## MergeProof configuration",
    "",
    "Policy file: " + snapshot.path + " (" + (snapshot.exists ? "present" : "using defaults") + ")",
    "Provider: " + (snapshot.policy.provider || DEFAULT_CONFIGURATION.provider),
    "Model: " + (snapshot.policy.model || DEFAULT_CONFIGURATION.model),
    "Effort: " + (snapshot.policy.effort || DEFAULT_CONFIGURATION.effort),
    "Retrieval top-k: " + (snapshot.policy.retrievalTopK ?? DEFAULT_CONFIGURATION.retrievalTopK),
    "Minimum citations per criterion: " + (snapshot.policy.minCitationsPerCriterion ?? DEFAULT_CONFIGURATION.minCitationsPerCriterion),
    "Instruction files: " + (snapshot.instructionFiles.length ? snapshot.instructionFiles.join(", ") : "none"),
    "Recipes: " + (snapshot.recipes.length ? snapshot.recipes.join(", ") : "none"),
    "Custom checks: " + (snapshot.customChecks.length ? snapshot.customChecks.join(", ") : "none"),
  ].join("\n");
}
