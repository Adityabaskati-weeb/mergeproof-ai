import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseChangeRequestUrl } from "./change-request";
import { runSlackCommand, type SlackCommand } from "./slack-agent";

export type WebhookAutomationAction = Exclude<SlackCommand["action"], "issue" | "rate" | "learn">;
export type WebhookAutomation = {
  id: string;
  action: WebhookAutomationAction;
  event?: string;
  field?: string;
  equals?: string;
  contains?: string[];
  urlField?: string;
};

const MAX_AUTOMATIONS = 50;
const URL_PATTERN = /https:\/\/(?:github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+|gitlab\.com\/[^\s/]+\/[^\s/]+\/-\/merge_requests\/\d+|bitbucket\.org\/[^\s/]+\/[^\s/]+\/pull-requests\/\d+|dev\.azure\.com\/[^\s/]+\/[^\s/]+\/_git\/[^\s/]+\/pullrequest\/\d+)/i;

function validAction(value: unknown): value is WebhookAutomationAction {
  return value === "review" || value === "investigate" || value === "plan" || value === "fix" || value === "tests";
}

function valueAt(payload: unknown, field?: string): unknown {
  if (!field) return payload;
  return field.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, payload);
}

function strings(value: unknown, output: string[] = [], depth = 0): string[] {
  if (depth > 6 || output.length >= 100) return output;
  if (typeof value === "string") output.push(value.slice(0, 10_000));
  else if (Array.isArray(value)) value.slice(0, 50).forEach((entry) => strings(entry, output, depth + 1));
  else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).slice(0, 50).forEach((entry) => strings(entry, output, depth + 1));
  return output;
}

export async function loadWebhookAutomations(root: string): Promise<WebhookAutomation[]> {
  try {
    const value = JSON.parse(await readFile(join(resolve(root), ".mergeproof", "webhook-automations.json"), "utf8")) as { automations?: unknown };
    if (!Array.isArray(value.automations)) return [];
    return value.automations.slice(0, MAX_AUTOMATIONS).flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const item = candidate as Record<string, unknown>;
      if (typeof item.id !== "string" || !validAction(item.action)) return [];
      const contains = Array.isArray(item.contains) ? item.contains.filter((entry): entry is string => typeof entry === "string").slice(0, 20) : undefined;
      return [{ id: item.id.slice(0, 100), action: item.action, ...(typeof item.event === "string" ? { event: item.event.slice(0, 200) } : {}), ...(typeof item.field === "string" ? { field: item.field.slice(0, 200) } : {}), ...(typeof item.equals === "string" ? { equals: item.equals.slice(0, 500) } : {}), ...(contains ? { contains } : {}), ...(typeof item.urlField === "string" ? { urlField: item.urlField.slice(0, 200) } : {}) }];
    });
  } catch {
    return [];
  }
}

export function matchWebhookAutomation(automations: WebhookAutomation[], payload: unknown, event?: string): WebhookAutomation | undefined {
  return automations.find((automation) => {
    if (automation.event && automation.event !== event) return false;
    const target = valueAt(payload, automation.field);
    const text = strings(target).join("\n").toLowerCase();
    if (automation.equals && text !== automation.equals.toLowerCase()) return false;
    if (automation.contains?.some((needle) => !text.includes(needle.toLowerCase()))) return false;
    return true;
  });
}

function inferWebhookEvent(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;
  return typeof record.event === "string" ? record.event : typeof record.type === "string" ? record.type : undefined;
}

export function extractChangeRequestUrl(payload: unknown, field?: string): string | undefined {
  const match = strings(valueAt(payload, field)).join("\n").match(URL_PATTERN)?.[0]?.replace(/[),.;]+$/, "");
  if (!match) return undefined;
  try { parseChangeRequestUrl(match); return match; } catch { return undefined; }
}

export function verifyWebhookAutomationSignature(body: string, signature: string | undefined, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const actual = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

export async function processWebhookAutomationPayload(payload: unknown, options: { root: string; event?: string; model?: string; provider?: string }): Promise<{ accepted: boolean; ignored?: boolean; reason?: string; text?: string; prUrl?: string }> {
  const automations = await loadWebhookAutomations(options.root);
  const automation = matchWebhookAutomation(automations, payload, options.event ?? inferWebhookEvent(payload));
  if (!automation) return { accepted: true, ignored: true, reason: "no_matching_automation" };
  const prUrl = extractChangeRequestUrl(payload, automation.urlField);
  if (!prUrl) return { accepted: true, ignored: true, reason: "missing_change_request_url" };
  const text = await runSlackCommand({ action: automation.action, prUrl }, { signingSecret: "webhook", model: options.model, provider: options.provider, repoPath: options.root });
  return { accepted: true, prUrl, text };
}
