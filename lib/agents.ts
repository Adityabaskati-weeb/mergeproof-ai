import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";

export type AgentProfile = { name: string; path: string; instructions: string };

function validateName(name: string): string {
  const normalized = name.trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(normalized)) throw new Error("Agent profile names may contain only letters, numbers, hyphens, and underscores.");
  return normalized;
}

export async function loadAgentProfile(root: string, name?: string): Promise<AgentProfile | undefined> {
  if (!name) return undefined;
  const safeName = validateName(name);
  const repositoryRoot = resolve(root);
  const candidates = [
    [join(repositoryRoot, ".mergeproof", "agents", `${safeName}.md`), `.mergeproof/agents/${safeName}.md`],
    [join(repositoryRoot, ".github", "agents", `${safeName}.md`), `.github/agents/${safeName}.md`],
    [join(repositoryRoot, ".github", "agents", `${safeName}.agent.md`), `.github/agents/${safeName}.agent.md`],
  ] as const;
  for (const [path, label] of candidates) {
    try {
      return { name: safeName, path: label, instructions: (await fs.readFile(path, "utf8")).slice(0, 20_000) };
    } catch {
      // Try the next supported repository convention.
    }
  }
  throw new Error(`Agent profile '${safeName}' was not found in .mergeproof/agents or .github/agents.`);
}

export function combineInstructions(base: string | undefined, profile: AgentProfile | undefined): string | undefined {
  const sections = [base ? `## Repository instructions\n${base}` : "", profile ? `## Agent profile: ${profile.name}\n${profile.instructions}` : ""].filter(Boolean);
  return sections.length ? sections.join("\n\n").slice(0, 40_000) : undefined;
}
