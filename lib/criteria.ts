import type { PullRequestContext } from "./github";

export type CriteriaResult = { criteria: string[]; section: string | null };

export function extractAcceptanceCriteria(body: string): CriteriaResult {
  const lines = body.split(/\r?\n/);
  const headings = /^(?:#{1,6})\s*(acceptance criteria|requirements|what changed)\s*:?$/i;
  const values: string[] = [];
  let active = false;
  let section: string | null = null;
  for (const line of lines) {
    const heading = line.match(headings);
    if (heading) { active = true; section = heading[1]; continue; }
    if (active && /^#{1,6}\s+/.test(line)) break;
    if (!active) continue;
    const value = line.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "").trim();
    if (value) values.push(value);
  }
  return { criteria: [...new Set(values)], section };
}

export function contextForCriteria(context: PullRequestContext, criteria: string[]) {
  return { title: context.title, body: context.body, criteria, files: context.files, checks: context.checks, headSha: context.headSha };
}
