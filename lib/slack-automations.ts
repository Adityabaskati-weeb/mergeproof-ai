import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";

export type SlackAutomationAction = "review" | "investigate" | "walkthrough" | "docstrings" | "plan" | "fix" | "simplify" | "tests" | "consensus" | "learn";
export type SlackAutomation = {
  id: string;
  action: SlackAutomationAction;
  contains?: string[];
  channelIds?: string[];
  authorIds?: string[];
  topLevelOnly?: boolean;
};
export type SlackAutomationEvent = { type?: string; text?: string; channel?: string; user?: string; thread_ts?: string; ts?: string };

const MAX_AUTOMATIONS = 50;

function validAction(value: unknown): value is SlackAutomationAction {
  return value === "review" || value === "investigate" || value === "walkthrough" || value === "docstrings" || value === "plan" || value === "fix" || value === "simplify" || value === "tests" || value === "consensus" || value === "learn";
}

export async function loadSlackAutomations(root: string): Promise<SlackAutomation[]> {
  try {
    const value = JSON.parse(await fs.readFile(join(resolve(root), ".mergeproof", "automations.json"), "utf8")) as { automations?: unknown };
    if (!Array.isArray(value.automations)) return [];
    return value.automations.slice(0, MAX_AUTOMATIONS).flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const automation = candidate as Record<string, unknown>;
      if (typeof automation.id !== "string" || !validAction(automation.action)) return [];
      const list = (field: string) => Array.isArray(automation[field]) ? automation[field].filter((entry): entry is string => typeof entry === "string").slice(0, 50) : undefined;
      return [{ id: automation.id.slice(0, 100), action: automation.action, contains: list("contains"), channelIds: list("channelIds"), authorIds: list("authorIds"), topLevelOnly: automation.topLevelOnly !== false }];
    });
  } catch {
    return [];
  }
}

export function matchSlackAutomation(automations: SlackAutomation[], event: SlackAutomationEvent): SlackAutomation | undefined {
  if (!event.text || event.type === "message" && event.thread_ts && event.thread_ts !== event.ts) return undefined;
  return automations.find((automation) => {
    if (automation.topLevelOnly !== false && event.thread_ts && event.thread_ts !== event.ts) return false;
    if (automation.channelIds?.length && (!event.channel || !automation.channelIds.includes(event.channel))) return false;
    if (automation.authorIds?.length && (!event.user || !automation.authorIds.includes(event.user))) return false;
    const text = event.text!.toLowerCase();
    return !automation.contains?.length || automation.contains.every((needle) => text.includes(needle.toLowerCase()));
  });
}
