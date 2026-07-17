import { createHmac, timingSafeEqual } from "node:crypto";
import { analyzePullRequest } from "./analyze";
import { publishChangeRequestCheck, publishChangeRequestReview } from "./change-publish";
import { loadPolicy } from "./policy";
import type { Analysis } from "./types";

export type ProviderWebhook = "gitlab" | "bitbucket" | "azure-devops";
export type ProviderWebhookOptions = { model?: string; provider?: string; repoPath?: string; publishReview?: boolean; log?: (message: string) => void };
export type ProviderWebhookResult = { accepted: boolean; ignored?: boolean; reason?: string; prUrl?: string; analysis?: Analysis };

function header(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function verifyProviderWebhookSignature(provider: ProviderWebhook, body: string, headers: Record<string, string | string[] | undefined>, secret: string): boolean {
  if (!secret) return false;
  if (provider === "gitlab") return header(headers, "x-gitlab-token") === secret;
  const signature = header(headers, provider === "bitbucket" ? "x-hub-signature" : "x-azure-signature") ?? header(headers, "x-hub-signature-256");
  if (!signature) return false;
  const prefix = signature.startsWith("sha256=") ? "sha256=" : "";
  const expected = `${prefix}${createHmac("sha256", secret).update(body).digest("hex")}`;
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function extractProviderChangeRequestUrl(provider: ProviderWebhook, payload: unknown): string | undefined {
  const value = record(payload);
  if (provider === "gitlab") {
    const attributes = record(value.object_attributes);
    return stringValue(attributes.url);
  }
  if (provider === "bitbucket") {
    const htmlLink = record(record(record(value.pullrequest).links).html);
    return stringValue(htmlLink.href);
  }
  const resource = record(value.resource);
  const webLink = record(record(resource._links).web);
  return stringValue(webLink.href) ?? stringValue(resource.url);
}

export function providerWebhookAction(provider: ProviderWebhook, payload: unknown, event?: string): string | undefined {
  const value = record(payload);
  if (provider === "gitlab") return stringValue(record(value.object_attributes).action);
  if (provider === "bitbucket") return event;
  return stringValue(value.eventType) ?? event;
}

function shouldReview(provider: ProviderWebhook, action: string | undefined): boolean {
  const normalized = action?.toLowerCase() ?? "";
  if (provider === "gitlab") return ["open", "update", "reopen"].includes(normalized);
  if (provider === "bitbucket") return ["pullrequest:created", "pullrequest:updated"].includes(normalized);
  return ["git.pullrequest.created", "git.pullrequest.updated", "git.pullrequest.reopened"].includes(normalized);
}

export async function processProviderWebhookPayload(provider: ProviderWebhook, payload: unknown, options: ProviderWebhookOptions & { event?: string }): Promise<ProviderWebhookResult> {
  const action = providerWebhookAction(provider, payload, options.event);
  if (!shouldReview(provider, action)) return { accepted: true, ignored: true, reason: "unsupported_action" };
  const prUrl = extractProviderChangeRequestUrl(provider, payload);
  if (!prUrl) return { accepted: false, reason: "missing_change_request_url" };
  const policy = await loadPolicy(options.repoPath);
  const analysis = await analyzePullRequest(prUrl, options.model, { provider: options.provider, repoPath: options.repoPath, remember: true, memoryRoot: options.repoPath });
  await publishChangeRequestCheck(prUrl, analysis, { mode: analysis.trace.reviewMode });
  if (options.publishReview && analysis.trace.reviewMode !== "shadow") await publishChangeRequestReview(prUrl, analysis, { requestChangesWorkflow: policy.requestChangesWorkflow, highLevelSummary: policy.highLevelSummary, mode: analysis.trace.reviewMode });
  options.log?.(`MergeProof reviewed ${prUrl}: ${analysis.decision}`);
  return { accepted: true, prUrl, analysis };
}
