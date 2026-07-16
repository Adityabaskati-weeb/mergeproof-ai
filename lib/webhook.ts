import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { analyzePullRequest } from "./analyze";
import { publishPullRequestCheck } from "./github-publish";
import { publishPullRequestComment, publishPullRequestReview } from "./github-review";
import { createGithubIssueFromAnalysis } from "./github-issues";
import { planPullRequest } from "./plan";
import { processSlackCommand, processSlackEvent, verifySlackRequestSignature } from "./slack-agent";
import { processProviderWebhookPayload, verifyProviderWebhookSignature, type ProviderWebhook } from "./provider-webhook";
import type { Analysis } from "./types";

const REVIEW_ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review"]);

export type GithubWebhookOptions = {
  secret?: string;
  host?: string;
  port?: number;
  model?: string;
  provider?: string;
  repoPath?: string;
  publishReview?: boolean;
  slackSigningSecret?: string;
  slackBotToken?: string;
  gitlabWebhookSecret?: string;
  bitbucketWebhookSecret?: string;
  azureDevopsWebhookSecret?: string;
  log?: (message: string) => void;
};

export type GithubWebhookResult = { accepted: boolean; ignored?: boolean; reason?: string; prUrl?: string; analysis?: Analysis };

export function verifyGithubWebhookSignature(body: string, signature: string | undefined, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function processGithubWebhookPayload(payload: unknown, options: Pick<GithubWebhookOptions, "model" | "provider" | "repoPath" | "publishReview" | "log"> & { event?: string }): Promise<GithubWebhookResult> {
  if (!payload || typeof payload !== "object") return { accepted: false, reason: "invalid_payload" };
  const value = payload as { action?: string; pull_request?: { html_url?: string }; issue?: { html_url?: string; pull_request?: unknown }; comment?: { body?: string } };
  if (options.event === "issue_comment") {
    const command = value.comment?.body?.match(/^\s*\/mergeproof\s+(review|plan|issue)\b/im)?.[1]?.toLowerCase();
    const issueUrl = value.issue?.html_url?.replace("/issues/", "/pull/");
    if (!command) return { accepted: true, ignored: true, reason: "no_mergeproof_command" };
    if (!value.issue?.pull_request || !issueUrl) return { accepted: true, ignored: true, reason: "comment_not_on_pull_request" };
    if (command === "plan") {
      const plan = await planPullRequest(issueUrl, options.model, options.provider);
      await publishPullRequestComment(issueUrl, `MergeProof plan\n\n${plan.summary}\n\n${plan.steps.map((step, index) => `${index + 1}. **${step.title}**: ${step.detail}`).join("\n")}`);
      options.log?.(`MergeProof planned ${issueUrl}: ${plan.steps.length} steps`);
      return { accepted: true, prUrl: issueUrl };
    }
    const analysis = await analyzePullRequest(issueUrl, options.model, { provider: options.provider, repoPath: options.repoPath, remember: true, memoryRoot: options.repoPath });
    if (command === "issue") {
      const url = await createGithubIssueFromAnalysis(issueUrl, analysis);
      await publishPullRequestComment(issueUrl, `MergeProof created a follow-up issue: ${url}`);
      options.log?.(`MergeProof created ${url} from ${issueUrl}`);
      return { accepted: true, prUrl: issueUrl, analysis };
    }
    await publishPullRequestCheck(issueUrl, analysis);
    if (options.publishReview) await publishPullRequestReview(issueUrl, analysis);
    options.log?.(`MergeProof reviewed ${issueUrl}: ${analysis.decision}`);
    return { accepted: true, prUrl: issueUrl, analysis };
  }
  if (options.event !== "pull_request") return { accepted: true, ignored: true, reason: "unsupported_event" };
  if (!value.action || !REVIEW_ACTIONS.has(value.action)) return { accepted: true, ignored: true, reason: "unsupported_action" };
  const prUrl = value.pull_request?.html_url;
  if (!prUrl) return { accepted: false, reason: "missing_pull_request_url" };
  const analysis = await analyzePullRequest(prUrl, options.model, { provider: options.provider, repoPath: options.repoPath, remember: true, memoryRoot: options.repoPath });
  await publishPullRequestCheck(prUrl, analysis);
  if (options.publishReview) await publishPullRequestReview(prUrl, analysis);
  options.log?.(`MergeProof reviewed ${prUrl}: ${analysis.decision}`);
  return { accepted: true, prUrl, analysis };
}

function respond(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 2_000_000) throw new Error("Webhook payload exceeds 2 MB.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function startGithubWebhookServer(options: GithubWebhookOptions): Server {
  if (!options.secret && !options.slackSigningSecret && !options.gitlabWebhookSecret && !options.bitbucketWebhookSecret && !options.azureDevopsWebhookSecret) throw new Error("At least one webhook signing secret is required.");
  const server = createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/slack/commands") {
      try {
        const body = await readBody(request);
        const timestamp = request.headers["x-slack-request-timestamp"];
        const signature = request.headers["x-slack-signature"];
        if (!options.slackSigningSecret || typeof timestamp !== "string" || typeof signature !== "string" || !verifySlackRequestSignature(body, timestamp, signature, options.slackSigningSecret)) {
          respond(response, 401, { error: "Invalid Slack signature" });
          return;
        }
        respond(response, 200, { response_type: "ephemeral", text: "MergeProof is reviewing the request. Results will be posted here." });
        void processSlackCommand(body, { signingSecret: options.slackSigningSecret, botToken: options.slackBotToken, repoPath: options.repoPath, model: options.model, provider: options.provider, log: options.log }).catch((error) => options.log?.(`MergeProof Slack command failed: ${error instanceof Error ? error.message : "unknown error"}`));
      } catch (error) {
        respond(response, 400, { error: error instanceof Error ? error.message : "Invalid Slack request" });
      }
      return;
    }
    if (request.method === "POST" && request.url === "/slack/events") {
      try {
        const body = await readBody(request);
        const timestamp = request.headers["x-slack-request-timestamp"];
        const signature = request.headers["x-slack-signature"];
        if (!options.slackSigningSecret || typeof timestamp !== "string" || typeof signature !== "string" || !verifySlackRequestSignature(body, timestamp, signature, options.slackSigningSecret)) {
          respond(response, 401, { error: "Invalid Slack signature" });
          return;
        }
        const payload = JSON.parse(body) as { type?: string; challenge?: string };
        if (payload.type === "url_verification" && payload.challenge) {
          respond(response, 200, { challenge: payload.challenge });
          return;
        }
        respond(response, 200, { ok: true });
        void processSlackEvent(payload, { signingSecret: options.slackSigningSecret, botToken: options.slackBotToken, repoPath: options.repoPath, model: options.model, provider: options.provider, log: options.log }).catch((error) => options.log?.(`MergeProof Slack event failed: ${error instanceof Error ? error.message : "unknown error"}`));
      } catch (error) {
        respond(response, 400, { error: error instanceof Error ? error.message : "Invalid Slack event" });
      }
      return;
    }
    const providerRoutes: Array<{ path: string; provider: ProviderWebhook; secret: string | undefined }> = [
      { path: "/gitlab/webhook", provider: "gitlab", secret: options.gitlabWebhookSecret },
      { path: "/bitbucket/webhook", provider: "bitbucket", secret: options.bitbucketWebhookSecret },
      { path: "/azure-devops/webhook", provider: "azure-devops", secret: options.azureDevopsWebhookSecret },
    ];
    const providerRoute = providerRoutes.find((candidate) => request.url === candidate.path);
    if (request.method === "POST" && providerRoute) {
      try {
        const body = await readBody(request);
        if (!providerRoute.secret || !verifyProviderWebhookSignature(providerRoute.provider, body, request.headers, providerRoute.secret)) {
          respond(response, 401, { error: "Invalid provider webhook signature" });
          return;
        }
        const payload = JSON.parse(body) as unknown;
        const event = typeof request.headers["x-event-key"] === "string" ? request.headers["x-event-key"] : typeof request.headers["x-azure-event-type"] === "string" ? request.headers["x-azure-event-type"] : undefined;
        respond(response, 202, { accepted: true });
        void processProviderWebhookPayload(providerRoute.provider, payload, { ...options, event }).catch((error) => options.log?.(`MergeProof ${providerRoute.provider} webhook failed: ${error instanceof Error ? error.message : "unknown error"}`));
      } catch (error) {
        respond(response, 400, { error: error instanceof Error ? error.message : "Invalid provider webhook request" });
      }
      return;
    }
    if (request.method !== "POST" || request.url !== "/github/webhook") {
      respond(response, 404, { error: "Not found" });
      return;
    }
    try {
      const body = await readBody(request);
      const signature = request.headers["x-hub-signature-256"];
      if (!verifyGithubWebhookSignature(body, typeof signature === "string" ? signature : undefined, options.secret ?? "")) {
        respond(response, 401, { error: "Invalid webhook signature" });
        return;
      }
      const payload = JSON.parse(body) as unknown;
      const event = typeof request.headers["x-github-event"] === "string" ? request.headers["x-github-event"] : undefined;
      respond(response, 202, { accepted: true });
      void processGithubWebhookPayload(payload, { ...options, event }).catch((error) => options.log?.(`MergeProof webhook failed: ${error instanceof Error ? error.message : "unknown error"}`));
    } catch (error) {
      respond(response, 400, { error: error instanceof Error ? error.message : "Invalid webhook request" });
    }
  });
  server.listen(options.port ?? Number(process.env.MERGEPROOF_WEBHOOK_PORT || 8787), options.host ?? process.env.MERGEPROOF_WEBHOOK_HOST ?? "127.0.0.1");
  return server;
}
