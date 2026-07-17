import { promises as fs } from "node:fs";
import { join, relative, resolve } from "node:path";

const MAX_SKILLS = 100;
const MAX_BYTES = 200_000;
const SEARCH_ROOTS = ["skills", ".github/skills", ".claude/skills", ".agents/skills", ".codex/skills"];

export type SkillSurface = {
  name: string;
  path: string;
  description: string;
  bytes: number;
  valid: boolean;
  issues: string[];
};

async function collectSkillFiles(root: string, directory: string, depth: number, output: string[]): Promise<void> {
  if (output.length >= MAX_SKILLS || depth > 4) return;
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (output.length >= MAX_SKILLS) return;
    const path = join(directory, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === "skill.md") output.push(path);
    else if (entry.isDirectory() && !entry.name.startsWith(".")) await collectSkillFiles(root, path, depth + 1, output);
  }
}

function parseSkill(name: string, path: string, content: string, bytes: number): SkillSurface {
  const lines = content.split(/\r?\n/).slice(0, 40);
  const declaredName = lines.find((line) => /^name:\s*/i.test(line))?.replace(/^name:\s*/i, "").trim().replace(/^['\"]|['\"]$/g, "") ?? "";
  const description = lines.find((line) => /^description:\s*/i.test(line))?.replace(/^description:\s*/i, "").trim().replace(/^['\"]|['\"]$/g, "") ?? "";
  const issues: string[] = [];
  if (!content.trim()) issues.push("SKILL.md is empty.");
  if (!declaredName) issues.push("Missing a name field in the skill front matter.");
  if (declaredName && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(declaredName)) issues.push("The declared skill name is unsafe.");
  if (bytes > MAX_BYTES) issues.push(`SKILL.md exceeds the ${MAX_BYTES}-byte limit.`);
  return { name, path, description: description.slice(0, 500), bytes, valid: issues.length === 0, issues };
}

export async function discoverSkills(root: string): Promise<SkillSurface[]> {
  const repositoryRoot = resolve(root);
  const paths: string[] = [];
  for (const searchRoot of SEARCH_ROOTS) await collectSkillFiles(repositoryRoot, join(repositoryRoot, searchRoot), 0, paths);
  const skills: SkillSurface[] = [];
  for (const path of paths) {
    try {
      const content = await fs.readFile(path, "utf8");
      const stat = await fs.stat(path);
      const relativeDirectory = relative(repositoryRoot, path.slice(0, -"SKILL.md".length)).replace(/\\/g, "/").replace(/\/$/, "");
      skills.push(parseSkill(relativeDirectory || "skill", path, content, stat.size));
    } catch (error) {
      skills.push({ name: relative(repositoryRoot, path).replace(/\\/g, "/"), path, description: "", bytes: 0, valid: false, issues: [error instanceof Error ? error.message : "Unable to read skill."] });
    }
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

export async function readSkill(root: string, name: string): Promise<{ skill: SkillSurface; content: string }> {
  const requested = name.trim().replace(/\\/g, "/");
  if (!requested) throw new Error("A skill name is required.");
  const skill = (await discoverSkills(root)).find((candidate) => candidate.name === requested || candidate.name.endsWith(`/${requested}`));
  if (!skill) throw new Error(`Skill not found: ${name}`);
  const content = await fs.readFile(skill.path, "utf8");
  return { skill, content };
}
