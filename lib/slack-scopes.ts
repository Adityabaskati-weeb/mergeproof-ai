import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import type { SlackCommand } from "./slack-agent";

export type SlackScope = { name: string; channelIds?: string[]; userIds?: string[]; actions?: SlackCommand["action"][]; maxRequestsPerHour?: number };
export type SlackScopeConfig = { default?: "allow" | "deny"; scopes?: SlackScope[] };

export async function loadSlackScopes(root: string): Promise<SlackScopeConfig | undefined> {
  try {
    const value = JSON.parse(await fs.readFile(join(resolve(root), ".mergeproof", "slack-scopes.json"), "utf8")) as SlackScopeConfig;
    if (!value || typeof value !== "object" || !Array.isArray(value.scopes)) return undefined;
    return { default: value.default === "deny" ? "deny" : "allow", scopes: value.scopes.filter((scope) => Boolean(scope) && typeof scope.name === "string").slice(0, 50).map((scope) => ({ ...scope, ...(typeof scope.maxRequestsPerHour === "number" && Number.isFinite(scope.maxRequestsPerHour) && scope.maxRequestsPerHour > 0 ? { maxRequestsPerHour: Math.min(10_000, Math.floor(scope.maxRequestsPerHour)) } : {}) })) };
  } catch {
    return undefined;
  }
}

type SlackUsage = { scope: string; channelId?: string; userId?: string; action: SlackCommand["action"]; recordedAt: string };

async function readUsage(root: string): Promise<SlackUsage[]> {
  try {
    return (await fs.readFile(join(resolve(root), ".mergeproof", "slack-scope-usage.jsonl"), "utf8")).split(/\r?\n/).filter(Boolean).slice(-5_000).flatMap((line) => {
      try {
        const value = JSON.parse(line) as SlackUsage;
        return typeof value.scope === "string" && typeof value.action === "string" && typeof value.recordedAt === "string" ? [value] : [];
      } catch { return []; }
    });
  } catch {
    return [];
  }
}

async function recordUsage(root: string, usage: SlackUsage): Promise<void> {
  const path = join(resolve(root), ".mergeproof", "slack-scope-usage.jsonl");
  await fs.mkdir(join(resolve(root), ".mergeproof"), { recursive: true });
  const cutoff = Date.now() - 24 * 60 * 60 * 1_000;
  const entries = (await readUsage(root)).filter((entry) => Date.parse(entry.recordedAt) >= cutoff);
  entries.push(usage);
  await fs.writeFile(path, `${entries.slice(-5_000).map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
}

export async function assertSlackScope(root: string, command: SlackCommand, identity: { channelId?: string; userId?: string }): Promise<void> {
  const config = await loadSlackScopes(root);
  if (!config) return;
  const matching = (config.scopes ?? []).filter((scope) => {
    const channelMatches = !scope.channelIds?.length || Boolean(identity.channelId && scope.channelIds.includes(identity.channelId));
    const userMatches = !scope.userIds?.length || Boolean(identity.userId && scope.userIds.includes(identity.userId));
    const actionMatches = !scope.actions?.length || scope.actions.includes(command.action);
    return channelMatches && userMatches && actionMatches;
  });
  if (!matching.length && config.default === "deny") throw new Error(`Slack scope denied action ${command.action} for this channel or user.`);
  const selected = matching[0];
  if (!selected) return;
  if (selected.maxRequestsPerHour) {
    const cutoff = Date.now() - 60 * 60 * 1_000;
    const usage = (await readUsage(root)).filter((entry) => entry.scope === selected.name && Date.parse(entry.recordedAt) >= cutoff).length;
    if (usage >= selected.maxRequestsPerHour) throw new Error(`Slack scope ${selected.name} exceeded its hourly request budget.`);
  }
  await recordUsage(root, { scope: selected.name, channelId: identity.channelId, userId: identity.userId, action: command.action, recordedAt: new Date().toISOString() });
}
