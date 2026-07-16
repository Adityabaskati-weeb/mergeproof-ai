import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";

export type ReviewerRule = { paths: string[]; reviewers: string[] };

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, "");
}

function matches(pattern: string, path: string): boolean {
  const normalizedPattern = normalizePath(pattern).replace(/\*\*/g, "*");
  const normalizedPath = normalizePath(path);
  if (normalizedPattern === "*") return true;
  if (normalizedPattern.endsWith("/*")) return normalizedPath.startsWith(normalizedPattern.slice(0, -1));
  if (normalizedPattern.startsWith("*")) return normalizedPath.endsWith(normalizedPattern.slice(1));
  return normalizedPath === normalizedPattern || normalizedPath.startsWith(`${normalizedPattern}/`);
}

async function readJsonRules(root: string): Promise<ReviewerRule[]> {
  try {
    const value = JSON.parse(await fs.readFile(join(root, ".mergeproof", "reviewers.json"), "utf8")) as { rules?: unknown };
    if (!Array.isArray(value.rules)) return [];
    return value.rules.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const item = candidate as Record<string, unknown>;
      const paths = Array.isArray(item.paths) ? item.paths.filter((path): path is string => typeof path === "string") : [];
      const reviewers = Array.isArray(item.reviewers) ? item.reviewers.filter((reviewer): reviewer is string => typeof reviewer === "string") : [];
      return paths.length && reviewers.length ? [{ paths, reviewers }] : [];
    }).slice(0, 100);
  } catch {
    return [];
  }
}

async function readCodeowners(root: string): Promise<ReviewerRule[]> {
  for (const candidate of [join(root, ".github", "CODEOWNERS"), join(root, "CODEOWNERS"), join(root, "docs", "CODEOWNERS")]) {
    try {
      const rules: ReviewerRule[] = [];
      for (const line of (await fs.readFile(candidate, "utf8")).split(/\r?\n/)) {
        const tokens = line.replace(/\s+#.*$/, "").trim().split(/\s+/).filter(Boolean);
        if (tokens.length < 2 || tokens[0].startsWith("#")) continue;
        rules.push({ paths: [tokens[0]], reviewers: tokens.slice(1) });
      }
      return rules;
    } catch {
      // Try the next supported CODEOWNERS location.
    }
  }
  return [];
}

export async function suggestReviewers(root: string | undefined, paths: string[]): Promise<string[]> {
  if (!root) return [];
  const repositoryRoot = resolve(root);
  const rules = [...await readJsonRules(repositoryRoot), ...await readCodeowners(repositoryRoot)];
  const reviewers = new Set<string>();
  for (const rule of rules) {
    if (paths.some((path) => rule.paths.some((pattern) => matches(pattern, path)))) rule.reviewers.forEach((reviewer) => reviewers.add(reviewer));
  }
  return [...reviewers].slice(0, 20);
}
