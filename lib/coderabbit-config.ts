import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import type { CustomCheck, PostMergeAction } from "./types";
import type { MergeProofPolicy } from "./policy";

const MAX_BYTES = 200_000;

export type CoderabbitMigration = {
  sourcePath: string;
  policy: MergeProofPolicy;
  recipes: Array<{ name: string; description: string; instructions: string; paths?: string[] }>;
  warnings: string[];
  unsupported: string[];
};

function scalar(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function booleanValue(value: string): boolean | undefined {
  const normalized = scalar(value).toLowerCase();
  if (normalized === "true" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "no") return false;
  return undefined;
}

function section(lines: string[], name: string): string[] {
  const start = lines.findIndex((line) => /^\s*\w[\w-]*:\s*$/.test(line) && line.trim().slice(0, -1) === name);
  if (start < 0) return [];
  const baseIndent = lines[start].search(/\S|$/);
  return lines.slice(start + 1).filter((line) => !line.trim() || line.search(/\S|$/) > baseIndent);
}

function findValue(lines: string[], key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = lines.find((line) => new RegExp(`^\\s*${escaped}:\\s*[^#].*$`).test(line));
  return match ? scalar(match.slice(match.indexOf(":") + 1).split(" #", 1)[0]) : undefined;
}

function readList(lines: string[], key: string): string[] {
  const start = lines.findIndex((line) => new RegExp(`^\\s*${key}:\\s*$`).test(line));
  if (start < 0) return [];
  const indent = lines[start].search(/\S|$/);
  const values: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (line.search(/\S|$/) <= indent) break;
    const value = line.trim().match(/^-\s*(.+)$/)?.[1];
    if (value) values.push(scalar(value));
  }
  return values.slice(0, 50);
}

function pathInstructions(lines: string[]): string[] {
  const output: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*-\s*path:\s*/.test(lines[index])) continue;
    const path = scalar(lines[index].replace(/^\s*-\s*path:\s*/, ""));
    const nextIndex = lines.slice(index + 1, index + 20).findIndex((line) => /^\s*instructions:\s*/.test(line));
    const instructionIndex = nextIndex < 0 ? -1 : index + 1 + nextIndex;
    const next = instructionIndex >= 0 ? lines[instructionIndex] : "";
    let instructions = next ? scalar(next.replace(/^\s*instructions:\s*/, "")) : "";
    if (instructions === "|" || instructions === ">" || instructions === "|-" || instructions === ">-") {
      const instructionIndent = next.search(/\S|$/);
      const block: string[] = [];
      for (const line of lines.slice(instructionIndex + 1)) {
        if (line.trim() && line.search(/\S|$/) <= instructionIndent) break;
        block.push(line);
      }
      const nonEmptyIndents = block.filter((line) => line.trim()).map((line) => line.search(/\S|$/));
      const commonIndent = nonEmptyIndents.length ? Math.min(...nonEmptyIndents) : instructionIndent + 2;
      instructions = block.map((line) => line.length >= commonIndent ? line.slice(commonIndent) : "").join("\n").trim();
    }
    if (path && instructions && instructions !== "|") output.push(`For paths matching ${path}: ${instructions}`);
  }
  return output;
}

function preMergeChecks(lines: string[]): CustomCheck[] {
  const checks: CustomCheck[] = [];
  const start = lines.findIndex((line) => /^\s*pre_merge_checks:\s*$/.test(line));
  if (start < 0) return checks;
  const base = lines[start].search(/\S|$/);
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && line.search(/\S|$/) <= base) break;
    const name = line.match(/^\s{2,}([\w-]+):\s*$/)?.[1];
    if (!name) continue;
    if (name === "custom_checks") continue;
    const mode = lines.slice(index + 1, index + 5).find((candidate) => /^\s+mode:\s*/.test(candidate));
    const modeValue = mode ? scalar(mode.replace(/^\s+mode:\s*/, "")) : "warning";
    const normalizedMode = modeValue === "off" || modeValue === "warning" || modeValue === "error" ? modeValue : "warning";
    checks.push({ name: `CodeRabbit pre-merge: ${name}`, instructions: `Run the ${name} pre-merge check and treat its configured mode (${modeValue}) as review evidence.`, mode: normalizedMode });
  }
  return checks.slice(0, 20);
}

function customPreMergeChecks(lines: string[]): CustomCheck[] {
  const start = lines.findIndex((line) => /^\s*custom_checks:\s*$/.test(line));
  if (start < 0) return [];
  const base = lines[start].search(/\S|$/);
  const checks: CustomCheck[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const item = lines[index].match(/^(\s*)-\s*mode:\s*(.+?)\s*$/);
    if (!item) {
      if (lines[index].trim() && lines[index].search(/\S|$/) <= base) break;
      continue;
    }
    const itemIndent = item[1].length;
    let name = "";
    let instructions = "";
    const modeValue = scalar(item[2]);
    for (let fieldIndex = index + 1; fieldIndex < lines.length; fieldIndex += 1) {
      const field = lines[fieldIndex];
      if (field.trim() && field.search(/\S|$/) <= itemIndent) break;
      const match = field.match(/^\s+(name|instructions):\s*(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      let value = scalar(rawValue);
      if (value === "|" || value === ">" || value === "|-" || value === ">-") {
        const fieldIndent = field.search(/\S|$/);
        const block: string[] = [];
        for (const blockLine of lines.slice(fieldIndex + 1)) {
          if (blockLine.trim() && blockLine.search(/\S|$/) <= fieldIndent) break;
          block.push(blockLine);
        }
        const indents = block.filter((blockLine) => blockLine.trim()).map((blockLine) => blockLine.search(/\S|$/));
        const commonIndent = indents.length ? Math.min(...indents) : fieldIndent + 2;
        value = block.map((blockLine) => blockLine.length >= commonIndent ? blockLine.slice(commonIndent) : "").join("\n").trim();
      }
      if (key === "name") name = value;
      if (key === "instructions") instructions = value;
    }
    if (name && instructions) {
      const mode = modeValue === "off" || modeValue === "warning" || modeValue === "error" ? modeValue : "warning";
      checks.push({ name, instructions, mode });
    }
  }
  return checks.slice(0, 20);
}

function linkedRepositoryGuidance(lines: string[]): string[] {
  const entries: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const repository = lines[index].match(/^\s*-\s*repository:\s*(.+?)\s*$/)?.[1];
    if (!repository) continue;
    const instruction = lines.slice(index + 1, index + 10).find((line) => /^\s*instructions:\s*/.test(line));
    const guidance = instruction ? scalar(instruction.replace(/^\s*instructions:\s*/, "")) : "";
    entries.push(`Use related repository ${scalar(repository)} as optional context${guidance ? `: ${guidance}` : "."}`);
  }
  return entries.slice(0, 20);
}

function customRecipes(lines: string[]): CoderabbitMigration["recipes"] {
  const start = lines.findIndex((line) => /^\s*custom:\s*$/.test(line));
  if (start < 0) return [];
  const base = lines[start].search(/\S|$/);
  const recipes: CoderabbitMigration["recipes"] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && line.search(/\S|$/) <= base) break;
    const item = line.match(/^(\s*)-\s*name:\s*(.+?)\s*$/);
    if (!item) continue;
    const itemIndent = item[1].length;
    const recipe = { name: scalar(item[2]), description: "CodeRabbit finishing-touch recipe", instructions: "", paths: [] as string[] };
    for (let fieldIndex = index + 1; fieldIndex < lines.length; fieldIndex += 1) {
      const field = lines[fieldIndex];
      if (field.trim() && field.search(/\S|$/) <= itemIndent) break;
      const fieldMatch = field.match(/^\s+(description|instructions|paths):\s*(.*)$/);
      if (!fieldMatch) continue;
      const [, key, rawValue] = fieldMatch;
      if (key === "paths") {
        recipe.paths = readList(lines.slice(fieldIndex), "paths");
        continue;
      }
      let value = scalar(rawValue);
      if (value === "|" || value === ">" || value === "|-" || value === ">-") {
        const fieldIndent = field.search(/\S|$/);
        const block: string[] = [];
        for (const blockLine of lines.slice(fieldIndex + 1)) {
          if (blockLine.trim() && blockLine.search(/\S|$/) <= fieldIndent) break;
          block.push(blockLine);
        }
        const indents = block.filter((blockLine) => blockLine.trim()).map((blockLine) => blockLine.search(/\S|$/));
        const commonIndent = indents.length ? Math.min(...indents) : fieldIndent + 2;
        value = block.map((blockLine) => blockLine.length >= commonIndent ? blockLine.slice(commonIndent) : "").join("\n").trim();
      }
      if (key === "description") recipe.description = value;
      if (key === "instructions") recipe.instructions = value;
    }
    if (/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(recipe.name) && recipe.instructions) recipes.push({ name: recipe.name, description: recipe.description.slice(0, 500), instructions: recipe.instructions.slice(0, 20_000), ...(recipe.paths.length ? { paths: recipe.paths.slice(0, 50) } : {}) });
  }
  return recipes.slice(0, 20);
}

function postMergeActions(lines: string[]): PostMergeAction[] {
  const start = lines.findIndex((line) => /^\s*post_merge_actions:\s*$/.test(line));
  if (start < 0) return [];
  const base = lines[start].search(/\S|$/);
  const actions: PostMergeAction[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const item = lines[index].match(/^(\s*)-\s*name:\s*(.+?)\s*$/);
    if (!item) { if (lines[index].trim() && lines[index].search(/\S|$/) <= base) break; continue; }
    const itemIndent = item[1].length;
    let enabled = true;
    let prompt = "";
    for (let fieldIndex = index + 1; fieldIndex < lines.length; fieldIndex += 1) {
      const field = lines[fieldIndex];
      if (field.trim() && field.search(/\S|$/) <= itemIndent) break;
      const match = field.match(/^\s+(enabled|prompt):\s*(.*)$/);
      if (!match) continue;
      if (match[1] === "enabled") enabled = booleanValue(match[2]) !== false;
      if (match[1] === "prompt") {
        prompt = scalar(match[2]);
        if (["|", ">", "|-", ">-"].includes(prompt)) {
          const indent = field.search(/\S|$/);
          const block: string[] = [];
          for (const blockLine of lines.slice(fieldIndex + 1)) {
            if (blockLine.trim() && blockLine.search(/\S|$/) <= indent) break;
            block.push(blockLine);
          }
          const indents = block.filter((blockLine) => blockLine.trim()).map((blockLine) => blockLine.search(/\S|$/));
          const commonIndent = indents.length ? Math.min(...indents) : indent + 2;
          prompt = block.map((blockLine) => blockLine.length >= commonIndent ? blockLine.slice(commonIndent) : "").join("\n").trim();
        }
      }
    }
    const name = scalar(item[2]);
    if (name && prompt) actions.push({ name, prompt, ...(enabled ? {} : { enabled: false }) });
  }
  return actions.slice(0, 20);
}

export async function readCoderabbitConfiguration(root: string): Promise<CoderabbitMigration | undefined> {
  const repositoryRoot = resolve(root);
  for (const name of [".coderabbit.yaml", ".coderabbit.yml"]) {
    const sourcePath = join(repositoryRoot, name);
    try {
      const content = await fs.readFile(sourcePath, "utf8");
      if (Buffer.byteLength(content, "utf8") > MAX_BYTES) throw new Error(`${name} exceeds the ${MAX_BYTES}-byte migration limit.`);
      const lines = content.split(/\r?\n/);
      const reviews = section(lines, "reviews");
      const knowledge = section(lines, "knowledge_base");
      const finishingTouches = section(reviews, "finishing_touches");
      const autoReview = section(reviews, "auto_review");
      const profileValue = findValue(reviews, "profile");
      const profile = profileValue === "quiet" || profileValue === "chill" || profileValue === "assertive" ? profileValue : undefined;
      const pathFilters = readList(reviews, "path_filters");
      const linkedRepositories = [...readList(knowledge, "linked_repositories").filter((value) => !value.startsWith("repository:")), ...linkedRepositoryGuidance(lines)];
      const instructions = [
        ...(pathFilters.length ? [`Apply these CodeRabbit review path filters when interpreting findings: ${pathFilters.join(", ")}.`] : []),
        ...pathInstructions(reviews),
        ...(linkedRepositories.length ? [`Use these CodeRabbit linked repositories as optional related context: ${linkedRepositories.join(", ")}.`] : []),
      ];
      const customChecks = [...preMergeChecks(lines), ...customPreMergeChecks(lines)].slice(0, 20);
      const recipes = customRecipes(finishingTouches);
      const mergeActions = postMergeActions(lines);
      const requestChanges = findValue(reviews, "request_changes_workflow");
      const highLevelSummary = findValue(reviews, "high_level_summary");
      const autoReviewEnabled = findValue(autoReview, "enabled");
      const autoIncrementalReview = findValue(autoReview, "auto_incremental_review");
      const autoPauseAfter = findValue(autoReview, "auto_pause_after_reviewed_commits");
      const descriptionKeyword = findValue(autoReview, "description_keyword");
      const ignoreTitleKeywords = readList(autoReview, "ignore_title_keywords");
      const reviewLabels = readList(autoReview, "labels");
      const drafts = findValue(reviews, "drafts");
      const baseBranches = readList(reviews, "base_branches");
      const ignoreUsernames = readList(reviews, "ignore_usernames");
      const policy: MergeProofPolicy = {
        ...(profile ? { profile } : {}),
        ...(pathFilters.length ? { pathFilters } : {}),
        ...(requestChanges ? { requestChangesWorkflow: booleanValue(requestChanges) } : {}),
        ...(highLevelSummary ? { highLevelSummary: booleanValue(highLevelSummary) } : {}),
        ...(autoReviewEnabled ? { autoReview: booleanValue(autoReviewEnabled) } : {}),
        ...(descriptionKeyword ? { autoReviewDescriptionKeyword: scalar(descriptionKeyword) } : {}),
        ...(autoIncrementalReview ? { autoIncrementalReview: booleanValue(autoIncrementalReview) } : {}),
        ...(autoPauseAfter && Number.isInteger(Number(autoPauseAfter)) && Number(autoPauseAfter) >= 0 ? { autoPauseAfterReviewedCommits: Number(autoPauseAfter) } : {}),
        ...(ignoreTitleKeywords.length ? { ignoreTitleKeywords } : {}),
        ...(reviewLabels.length ? { reviewLabels } : {}),
        ...(drafts ? { includeDrafts: booleanValue(drafts) } : {}),
        ...(baseBranches.length ? { baseBranches } : {}),
        ...(ignoreUsernames.length ? { ignoreUsernames } : {}),
        ...(instructions.length ? { instructions: instructions.join("\n") } : {}),
        ...(customChecks.length ? { customChecks } : {}),
        ...(mergeActions.length ? { postMergeActions: mergeActions } : {}),
        compatibility: { source: "coderabbit", importedAt: new Date().toISOString() },
      };
      const unsupported = ["chat", "early_access", "knowledge_base.web_search", "mcp", "code_generation"].filter((key) => content.includes(`${key}:`));
      return { sourcePath: name, policy, recipes, warnings: ["Migration uses a bounded YAML subset; review the generated JSON before committing it."], unsupported };
    } catch (error) {
      if (error instanceof Error && error.message.includes("migration limit")) throw error;
    }
  }
  return undefined;
}

export async function importCoderabbitConfiguration(root: string, force = false): Promise<{ created: boolean; path: string; migration: CoderabbitMigration }> {
  const repositoryRoot = resolve(root);
  const migration = await readCoderabbitConfiguration(repositoryRoot);
  if (!migration) throw new Error("No .coderabbit.yaml or .coderabbit.yml was found.");
  const path = join(repositoryRoot, ".mergeproof", "config.json");
  try {
    await fs.access(path);
    if (!force) return { created: false, path: ".mergeproof/config.json", migration };
  } catch {
    // The target is absent and can be created.
  }
  await fs.mkdir(join(repositoryRoot, ".mergeproof"), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify(migration.policy, null, 2)}\n`, "utf8");
  if (migration.recipes.length) await fs.writeFile(join(repositoryRoot, ".mergeproof", "recipes.json"), `${JSON.stringify({ recipes: migration.recipes }, null, 2)}\n`, "utf8");
  return { created: true, path: ".mergeproof/config.json", migration };
}
