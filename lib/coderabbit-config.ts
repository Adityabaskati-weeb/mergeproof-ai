import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import type { CustomCheck } from "./types";
import type { MergeProofPolicy } from "./policy";

const MAX_BYTES = 200_000;

export type CoderabbitMigration = {
  sourcePath: string;
  policy: MergeProofPolicy;
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
    const mode = lines.slice(index + 1, index + 5).find((candidate) => /^\s+mode:\s*/.test(candidate));
    const modeValue = mode ? scalar(mode.replace(/^\s+mode:\s*/, "")) : "warning";
    checks.push({ name: `CodeRabbit pre-merge: ${name}`, instructions: `Run the ${name} pre-merge check and treat its configured mode (${modeValue}) as review evidence.` });
  }
  return checks.slice(0, 20);
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
      const profileValue = findValue(reviews, "profile");
      const profile = profileValue === "quiet" || profileValue === "chill" || profileValue === "assertive" ? profileValue : undefined;
      const pathFilters = readList(reviews, "path_filters");
      const linkedRepositories = readList(knowledge, "linked_repositories");
      const instructions = [
        ...(pathFilters.length ? [`Apply these CodeRabbit review path filters when interpreting findings: ${pathFilters.join(", ")}.`] : []),
        ...pathInstructions(reviews),
        ...(linkedRepositories.length ? [`Use these CodeRabbit linked repositories as optional related context: ${linkedRepositories.join(", ")}.`] : []),
      ];
      const customChecks = preMergeChecks(lines);
      const requestChanges = findValue(reviews, "request_changes_workflow");
      const highLevelSummary = findValue(reviews, "high_level_summary");
      const policy: MergeProofPolicy = {
        ...(profile ? { profile } : {}),
        ...(pathFilters.length ? { pathFilters } : {}),
        ...(requestChanges ? { requestChangesWorkflow: booleanValue(requestChanges) } : {}),
        ...(highLevelSummary ? { highLevelSummary: booleanValue(highLevelSummary) } : {}),
        ...(instructions.length ? { instructions: instructions.join("\n") } : {}),
        ...(customChecks.length ? { customChecks } : {}),
        compatibility: { source: "coderabbit", importedAt: new Date().toISOString() },
      };
      const unsupported = ["auto_review", "chat", "early_access", "knowledge_base.web_search", "mcp", "code_generation"].filter((key) => content.includes(`${key}:`));
      return { sourcePath: name, policy, warnings: ["Migration uses a bounded YAML subset; review the generated JSON before committing it."], unsupported };
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
  return { created: true, path: ".mergeproof/config.json", migration };
}
