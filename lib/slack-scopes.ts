import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import type { SlackCommand } from "./slack-agent";

export type SlackScope = { name: string; channelIds?: string[]; userIds?: string[]; actions?: SlackCommand["action"][] };
export type SlackScopeConfig = { default?: "allow" | "deny"; scopes?: SlackScope[] };

export async function loadSlackScopes(root: string): Promise<SlackScopeConfig | undefined> {
  try {
    const value = JSON.parse(await fs.readFile(join(resolve(root), ".mergeproof", "slack-scopes.json"), "utf8")) as SlackScopeConfig;
    if (!value || typeof value !== "object" || !Array.isArray(value.scopes)) return undefined;
    return { default: value.default === "deny" ? "deny" : "allow", scopes: value.scopes.filter((scope) => Boolean(scope) && typeof scope.name === "string").slice(0, 50) };
  } catch {
    return undefined;
  }
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
}
