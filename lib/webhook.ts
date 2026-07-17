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
import { processWebhookAutomationPayload, verifyWebhookAutomationSignature } from "./webhook-automations";
import { renderWalkthroughMarkdown } from "./walkthrough";
import { checkReviewAutoPause, markReviewCompleted, reviewSuppression, updateReviewState } from "./review-state";
import { generateDocstringsPullRequest } from "./docstrings";
import { runRecipeInstruction } from "./recipes";
import { VERIFICATION_COMMANDS, type VerificationCommand } from "./local-agent";
import { parsePullRequestUrl } from "./github";
import { readReviewMemory } from "./memory";
import { recordOutcome } from "./outcomes";
import { readMergeProofConfiguration, renderConfiguration } from "./configuration";
import { generateMergeProofConfiguration } from "./configuration";
import { generateTestsPullRequest } from "./tests";
import { fetchGithubReviewThreads, resolveGithubReviewThreads } from "./github-threads";
import { autofixPullRequest } from "./autofix";
import { runRecipe } from "./recipes";
import { processDiscordInteraction, verifyDiscordRequestSignature } from "./discord-agent";
import { runChatTurn, type ChatTurnAction } from "./chat-turn";
import { assertPermission } from "./permissions";
import { loadPolicy } from "./policy";

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
  discordPublicKey?: string;
  gitlabWebhookSecret?: string;
  bitbucketWebhookSecret?: string;
  azureDevopsWebhookSecret?: string;
  automationWebhookSecret?: string;
  remoteSessionSecret?: string;
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

export function verifyRemoteSessionSignature(body: string, signature: string | undefined, timestamp: string | undefined, secret: string, now = Date.now()): boolean {
  if (!signature || !timestamp || !secret) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(now - seconds * 1000) > 300_000) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const actual = signature.replace(/^sha256=/, "");
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

const COMMENT_COMMANDS = "full review|review|generate sequence diagram|sequence diagram|entity relationship diagram|generate erd|erd|generate unit tests|unit tests|generate docstrings|docstrings|plan|issue|summary|diagram|implement|generate configuration|configuration|resolve|autofix stacked pr|autofix|run|help|pause|resume|ignore|unignore";

export function parseGithubCommentCommand(body: string | undefined): { command: string; instruction: string } | undefined {
  const match = body?.match(new RegExp(`^\\s*\\/mergeproof\\s+(${COMMENT_COMMANDS})\\b([^\\r\\n]*)`, "im"));
  if (!match) return undefined;
  return { command: match[1].toLowerCase(), instruction: match[2]?.trim() ?? "" };
}

export async function processGithubWebhookPayload(payload: unknown, options: Pick<GithubWebhookOptions, "model" | "provider" | "repoPath" | "publishReview" | "log"> & { event?: string }): Promise<GithubWebhookResult> {
  if (!payload || typeof payload !== "object") return { accepted: false, reason: "invalid_payload" };
  const value = payload as { action?: string; pull_request?: { html_url?: string; merged?: boolean; commits?: number; title?: string; body?: string; draft?: boolean; user?: { login?: string }; base?: { ref?: string }; labels?: Array<{ name?: string }> }; issue?: { html_url?: string; pull_request?: unknown }; comment?: { body?: string } };
  if (options.event === "issue_comment") {
    const parsedCommand = parseGithubCommentCommand(value.comment?.body);
    const command = parsedCommand?.command;
    const instruction = parsedCommand?.instruction ?? "";
    const issueUrl = value.issue?.html_url?.replace("/issues/", "/pull/");
    if (!command) return { accepted: true, ignored: true, reason: "no_mergeproof_command" };
    if (!value.issue?.pull_request || !issueUrl) return { accepted: true, ignored: true, reason: "comment_not_on_pull_request" };
    const stateRoot = options.repoPath || process.cwd();
    if (command === "pause" || command === "resume") {
      const state = await updateReviewState(stateRoot, { paused: command === "pause", reason: command === "pause" ? "Paused by GitHub command." : "Resumed by GitHub command." });
      await publishPullRequestComment(issueUrl, `MergeProof automatic reviews are now **${state.paused ? "paused" : "resumed"}** for this repository.`);
      return { accepted: true, prUrl: issueUrl };
    }
    if (command === "ignore" || command === "unignore") {
      const state = await updateReviewState(stateRoot, command === "ignore" ? { ignorePullRequest: issueUrl, reason: "Ignored by GitHub command." } : { unignorePullRequest: issueUrl, reason: "Unignored by GitHub command." });
      await publishPullRequestComment(issueUrl, `MergeProof automatic review for this PR is now **${state.ignoredPullRequests.includes(issueUrl) ? "ignored" : "enabled"}**.`);
      return { accepted: true, prUrl: issueUrl };
    }
    if (command === "help") {
      await publishPullRequestComment(issueUrl, "## MergeProof commands\n\n- `/mergeproof review` or `/mergeproof full review` - run the evidence gate\n- `/mergeproof summary` - publish the cited walkthrough and change stack\n- `/mergeproof diagram` or `/mergeproof generate sequence diagram` - publish the evidence-derived Mermaid change flow\n- `/mergeproof erd` or `/mergeproof entity relationship diagram` - publish the evidence-derived schema impact diagram\n- `/mergeproof docstrings` or `/mergeproof generate docstrings` - publish a documentation-only patch suggestion\n- `/mergeproof generate unit tests` - publish a test-only patch suggestion\n- `/mergeproof plan` - publish a cited implementation plan\n- `/mergeproof implement <request>` - create a separate verified PR from an explicit natural-language request\n- `/mergeproof autofix` or `/mergeproof autofix stacked pr` - verify review-thread fixes in a sandbox and optionally open a separate PR\n- `/mergeproof run <recipe>` - execute a configured finishing-touch recipe in a separate verified PR\n- `/mergeproof configuration` or `/mergeproof generate configuration` - inspect or create the repository policy\n- `/mergeproof resolve` - resolve current review threads explicitly requested by the comment\n- `/mergeproof issue` - create a follow-up GitHub issue\n- `/mergeproof pause` or `/mergeproof resume` - control automatic reviews\n- `/mergeproof ignore` or `/mergeproof unignore` - control this PR's automatic reviews\n\nMergeProof never edits the source branch or merges a pull request from a comment.");
      return { accepted: true, prUrl: issueUrl };
    }
    if (command === "configuration" || command === "generate configuration") {
      if (command === "generate configuration") {
        const generated = await generateMergeProofConfiguration(stateRoot);
        await publishPullRequestComment(issueUrl, `MergeProof configuration ${generated.created ? "created" : "already exists"} at .mergeproof/config.json.`);
        return { accepted: true, prUrl: issueUrl };
      }
      const snapshot = await readMergeProofConfiguration(options.repoPath || process.cwd());
      await publishPullRequestComment(issueUrl, renderConfiguration(snapshot));
      options.log?.(`MergeProof published configuration for ${issueUrl}`);
      return { accepted: true, prUrl: issueUrl };
    }
    if (command === "resolve") {
      const ref = parsePullRequestUrl(issueUrl);
      const report = await fetchGithubReviewThreads(ref);
      const unresolved = report.threads.filter((thread) => !thread.isResolved && !thread.isOutdated);
      const resolved = await resolveGithubReviewThreads(ref);
      await publishPullRequestComment(issueUrl, `## MergeProof resolved review threads\n\nResolved ${resolved.length} of ${unresolved.length} current unresolved thread(s).`);
      return { accepted: true, prUrl: issueUrl };
    }
    if (command === "generate unit tests" || command === "unit tests") {
      const suggestion = await generateTestsPullRequest(issueUrl, options.model, { provider: options.provider, repoPath: options.repoPath });
      await publishPullRequestComment(issueUrl, `## MergeProof unit-test suggestion\n\n${suggestion.summary}\n\nChanged paths: ${suggestion.trace.changedPaths.join(", ") || "none"}\n\nTest patch:\n${suggestion.patch || "No test patch was proposed."}`);
      options.log?.(`MergeProof published unit-test suggestion for ${issueUrl}`);
      return { accepted: true, prUrl: issueUrl };
    }
    if (command === "autofix" || command === "autofix stacked pr") {
      if (!options.repoPath) return { accepted: false, reason: "autofix_requires_repo_checkout", prUrl: issueUrl };
      const verifyValue = process.env.MERGEPROOF_COMMENT_AUTOFIX_VERIFY as VerificationCommand | undefined;
      if (verifyValue && !VERIFICATION_COMMANDS.includes(verifyValue)) return { accepted: false, reason: "invalid_comment_autofix_verification_command", prUrl: issueUrl };
      const stacked = command === "autofix stacked pr";
      const result = await autofixPullRequest(issueUrl, options.model, { provider: options.provider, repoPath: options.repoPath, verify: verifyValue, reReview: true, ...(stacked ? { createPr: true, stackedPr: true } : {}) });
      await publishPullRequestComment(issueUrl, `## MergeProof autofix\n\n${result.summary}\n\nChanged paths: ${result.trace.changedPaths.join(", ") || "none"}\n\nVerification: ${result.trace.verified ? "passed" : "failed"}${result.trace.pullRequestUrl ? `\\n\\nHandoff PR: ${result.trace.pullRequestUrl}` : ""}`);
      options.log?.(`MergeProof published autofix for ${issueUrl}`);
      return { accepted: true, prUrl: issueUrl };
    }
    if (command === "run") {
      if (!instruction) return { accepted: false, reason: "missing_recipe_name", prUrl: issueUrl };
      if (!options.repoPath) return { accepted: false, reason: "recipe_requires_repo_checkout", prUrl: issueUrl };
      const verifyValue = process.env.MERGEPROOF_COMMENT_RECIPE_VERIFY as VerificationCommand | undefined;
      if (verifyValue && !VERIFICATION_COMMANDS.includes(verifyValue)) return { accepted: false, reason: "invalid_comment_recipe_verification_command", prUrl: issueUrl };
      const result = await runRecipe(issueUrl, instruction, options.model, { provider: options.provider, repoPath: options.repoPath, verify: verifyValue, apply: true, createPr: true, reReview: true });
      await publishPullRequestComment(issueUrl, `## MergeProof recipe handoff\n\n${result.summary}\n\nRecipe: ${result.recipe.name}\n\nChanged paths: ${result.trace.changedPaths.join(", ") || "none"}\n\nVerification: ${result.trace.verified ? "passed" : "failed"}\n\nHandoff PR: ${result.trace.pullRequestUrl ?? "none"}`);
      options.log?.(`MergeProof ran recipe ${result.recipe.name} for ${issueUrl}`);
      return { accepted: true, prUrl: issueUrl };
    }
    if (command === "implement") {
      if (!instruction) return { accepted: false, reason: "missing_implementation_request", prUrl: issueUrl };
      if (!options.repoPath) return { accepted: false, reason: "implementation_requires_repo_checkout", prUrl: issueUrl };
      const verifyValue = process.env.MERGEPROOF_COMMENT_AGENT_VERIFY as VerificationCommand | undefined;
      if (verifyValue && !VERIFICATION_COMMANDS.includes(verifyValue)) return { accepted: false, reason: "invalid_comment_agent_verification_command", prUrl: issueUrl };
      const result = await runRecipeInstruction(issueUrl, { name: "comment-edit", description: instruction.slice(0, 160), instructions: instruction.slice(0, 12_000) }, options.model, { provider: options.provider, repoPath: options.repoPath, createPr: true, apply: true, reReview: true, ...(verifyValue ? { verify: verifyValue } : {}) });
      const destination = result.trace.pullRequestUrl ?? "no PR created";
      await publishPullRequestComment(issueUrl, `## MergeProof implementation handoff\n\n${result.summary}\n\nChanged paths: ${result.trace.changedPaths.join(", ") || "none"}\n\nVerification: ${result.trace.verified ? "passed" : "failed"}\n\nHandoff PR: ${destination}`);
      options.log?.(`MergeProof implemented a requested change for ${issueUrl}: ${destination}`);
      return { accepted: true, prUrl: issueUrl };
    }
    if (command === "plan") {
      const plan = await planPullRequest(issueUrl, options.model, options.provider);
      await publishPullRequestComment(issueUrl, `MergeProof plan\n\n${plan.summary}\n\n${plan.steps.map((step, index) => `${index + 1}. **${step.title}**: ${step.detail}`).join("\n")}`);
      options.log?.(`MergeProof planned ${issueUrl}: ${plan.steps.length} steps`);
      return { accepted: true, prUrl: issueUrl };
    }
    const publicationPolicy = await loadPolicy(stateRoot);
    const analysis = await analyzePullRequest(issueUrl, options.model, { provider: options.provider, repoPath: options.repoPath, remember: true, memoryRoot: options.repoPath });
    if (command === "summary" || command === "diagram" || command === "sequence diagram" || command === "generate sequence diagram" || command === "erd" || command === "generate erd" || command === "entity relationship diagram") {
      const walkthrough = analysis.walkthrough;
      if (!walkthrough) return { accepted: false, reason: "walkthrough_unavailable", prUrl: issueUrl, analysis };
      if (command === "erd" || command === "generate erd" || command === "entity relationship diagram") {
        const entities = walkthrough.entityEvidence.length ? `\n\n${walkthrough.entityEvidence.map((entity) => `- **${entity.name}** from \`${entity.source}\` [evidence](${entity.citation.url})`).join("\n")}` : "\n\nNo schema/model entities were detected in the fetched change evidence.";
        await publishPullRequestComment(issueUrl, `## MergeProof schema impact\n\n\`\`\`mermaid\n${walkthrough.entityRelationshipDiagram}\n\`\`\`${entities}`);
        options.log?.(`MergeProof published ${command} for ${issueUrl}`);
        return { accepted: true, prUrl: issueUrl, analysis };
      }
      const diagramCommand = command === "diagram" || command === "sequence diagram" || command === "generate sequence diagram";
      const body = diagramCommand ? `## MergeProof change flow\n\n\`\`\`mermaid\n${walkthrough.sequenceDiagram}\n\`\`\`\n\nEvidence citations: ${walkthrough.citations.length}` : renderWalkthroughMarkdown(walkthrough, analysis.decision);
      await publishPullRequestComment(issueUrl, body);
      options.log?.(`MergeProof published ${command} for ${issueUrl}`);
      return { accepted: true, prUrl: issueUrl, analysis };
    }
    if (command === "docstrings" || command === "generate docstrings") {
      const suggestion = await generateDocstringsPullRequest(issueUrl, options.model, { provider: options.provider, repoPath: options.repoPath });
      await publishPullRequestComment(issueUrl, `## MergeProof docstrings suggestion\n\n${suggestion.summary}\n\nChanged paths: ${suggestion.trace.changedPaths.join(", ") || "none"}\n\n\`\`\`diff\n${suggestion.patch || "No documentation patch was proposed."}\n\`\`\``);
      options.log?.(`MergeProof published docstring suggestion for ${issueUrl}`);
      return { accepted: true, prUrl: issueUrl };
    }
    if (command === "issue") {
      const url = await createGithubIssueFromAnalysis(issueUrl, analysis);
      await publishPullRequestComment(issueUrl, `MergeProof created a follow-up issue: ${url}`);
      options.log?.(`MergeProof created ${url} from ${issueUrl}`);
      return { accepted: true, prUrl: issueUrl, analysis };
    }
    await publishPullRequestCheck(issueUrl, analysis, { mode: analysis.trace.reviewMode });
    if (options.publishReview && analysis.trace.reviewMode !== "shadow") await publishPullRequestReview(issueUrl, analysis, { requestChangesWorkflow: publicationPolicy.requestChangesWorkflow, highLevelSummary: publicationPolicy.highLevelSummary });
    options.log?.(`MergeProof reviewed ${issueUrl}: ${analysis.decision}`);
    return { accepted: true, prUrl: issueUrl, analysis };
  }
  if (options.event !== "pull_request") return { accepted: true, ignored: true, reason: "unsupported_event" };
  if (value.action === "closed" && value.pull_request?.html_url) {
    const root = options.repoPath || process.cwd();
    const ref = parsePullRequestUrl(value.pull_request.html_url);
    const memory = await readReviewMemory(root, ref, "", 500);
    const analysisEntry = memory.find((entry) => entry.prUrl.replace(/\/$/, "") === ref.url);
    const outcome = await recordOutcome(root, ref, ref.url, value.pull_request.merged === true ? "merged" : "closed-unmerged", analysisEntry ? { predictedDecision: analysisEntry.decision, headSha: analysisEntry.headSha, attestation: undefined } : {});
    options.log?.(`MergeProof recorded ${outcome.label} for ${ref.url}`);
    return { accepted: true, prUrl: ref.url };
  }
  if (!value.action || !REVIEW_ACTIONS.has(value.action)) return { accepted: true, ignored: true, reason: "unsupported_action" };
  const prUrl = value.pull_request?.html_url;
  if (!prUrl) return { accepted: false, reason: "missing_pull_request_url" };
  const stateRoot = options.repoPath || process.cwd();
  const policy = await loadPolicy(stateRoot);
  const title = value.pull_request?.title ?? "";
  const body = value.pull_request?.body ?? "";
  const author = value.pull_request?.user?.login ?? "";
  const baseBranch = value.pull_request?.base?.ref ?? "";
  const labels = new Set((value.pull_request?.labels ?? []).flatMap((label) => typeof label.name === "string" ? [label.name.toLowerCase()] : []));
  if (policy.autoReview === false && !(policy.autoReviewDescriptionKeyword && body.toLowerCase().includes(policy.autoReviewDescriptionKeyword.toLowerCase()))) return { accepted: true, ignored: true, reason: "review_auto_disabled" };
  if (value.pull_request?.draft && policy.includeDrafts !== true) return { accepted: true, ignored: true, reason: "review_draft_excluded" };
  if (value.action === "synchronize" && policy.autoIncrementalReview === false) return { accepted: true, ignored: true, reason: "review_incremental_disabled" };
  if (policy.ignoreTitleKeywords?.some((keyword) => keyword && title.toLowerCase().includes(keyword.toLowerCase()))) return { accepted: true, ignored: true, reason: "review_title_excluded" };
  if (policy.ignoreUsernames?.some((username) => username.toLowerCase() === author.toLowerCase())) return { accepted: true, ignored: true, reason: "review_author_excluded" };
  if (policy.baseBranches?.length && !policy.baseBranches.some((pattern) => { try { return new RegExp(pattern).test(baseBranch); } catch { return pattern === baseBranch; } })) return { accepted: true, ignored: true, reason: "review_base_branch_excluded" };
  const positiveLabels = (policy.reviewLabels ?? []).filter((label) => !label.startsWith("!")).map((label) => label.toLowerCase());
  const negativeLabels = (policy.reviewLabels ?? []).filter((label) => label.startsWith("!")).map((label) => label.slice(1).toLowerCase());
  if (positiveLabels.length && !positiveLabels.some((label) => labels.has(label))) return { accepted: true, ignored: true, reason: "review_label_not_matched" };
  if (negativeLabels.some((label) => labels.has(label))) return { accepted: true, ignored: true, reason: "review_label_excluded" };
  if (policy.autoPauseAfterReviewedCommits !== undefined) await updateReviewState(stateRoot, { autoPauseAfterReviewedCommits: policy.autoPauseAfterReviewedCommits, reason: "Loaded automatic review policy." });
  const autoPause = await checkReviewAutoPause(stateRoot, prUrl, value.pull_request?.commits ?? 0);
  if (autoPause.suppressed) return { accepted: true, ignored: true, reason: `review_${autoPause.reason}` };
  const suppression = await reviewSuppression(stateRoot, prUrl);
  if (suppression.suppressed) return { accepted: true, ignored: true, reason: `review_${suppression.reason}` };
  const analysis = await analyzePullRequest(prUrl, options.model, { provider: options.provider, repoPath: options.repoPath, remember: true, memoryRoot: options.repoPath });
  await publishPullRequestCheck(prUrl, analysis, { mode: analysis.trace.reviewMode });
  if (options.publishReview && analysis.trace.reviewMode !== "shadow") await publishPullRequestReview(prUrl, analysis, { requestChangesWorkflow: policy.requestChangesWorkflow, highLevelSummary: policy.highLevelSummary });
  await markReviewCompleted(stateRoot, prUrl, value.pull_request?.commits ?? 0);
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
  if (!options.secret && !options.slackSigningSecret && !options.discordPublicKey && !options.gitlabWebhookSecret && !options.bitbucketWebhookSecret && !options.azureDevopsWebhookSecret && !options.automationWebhookSecret && !options.remoteSessionSecret) throw new Error("At least one webhook signing secret is required.");
  const server = createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/session/turn") {
      try {
        const body = await readBody(request);
        const signature = request.headers["x-mergeproof-signature"];
        const timestamp = request.headers["x-mergeproof-timestamp"];
        if (!options.remoteSessionSecret || typeof signature !== "string" || typeof timestamp !== "string" || !verifyRemoteSessionSignature(body, signature, timestamp, options.remoteSessionSecret)) {
          respond(response, 401, { error: "Invalid remote session signature" });
          return;
        }
        if (!options.repoPath) {
          respond(response, 400, { error: "A repository checkout is required for remote session turns." });
          return;
        }
        await assertPermission(options.repoPath, "remote");
        const payload = JSON.parse(body) as { action?: unknown; request?: unknown; sessionId?: unknown; model?: unknown; provider?: unknown; agent?: unknown };
        const action = payload.action;
        if (action !== "ask" && action !== "plan" && action !== "review") {
          respond(response, 400, { error: "Remote session turns allow only ask, plan, or review." });
          return;
        }
        if (typeof payload.request !== "string" || !payload.request.trim() || payload.request.length > 16_000) {
          respond(response, 400, { error: "request must be a non-empty string of at most 16,000 characters." });
          return;
        }
        const result = await runChatTurn(action as ChatTurnAction, payload.request, { repoPath: options.repoPath, sessionId: typeof payload.sessionId === "string" ? payload.sessionId : undefined, model: options.model ?? (typeof payload.model === "string" ? payload.model : undefined), provider: options.provider ?? (typeof payload.provider === "string" ? payload.provider : undefined), agent: typeof payload.agent === "string" ? payload.agent : undefined });
        respond(response, 200, result);
      } catch (error) {
        respond(response, 400, { error: error instanceof Error ? error.message : "Invalid remote session request" });
      }
      return;
    }
    if (request.method === "POST" && request.url === "/automation/webhook") {
      try {
        const body = await readBody(request);
        const signature = request.headers["x-mergeproof-signature"];
        if (!options.automationWebhookSecret || typeof signature !== "string" || !verifyWebhookAutomationSignature(body, signature, options.automationWebhookSecret)) {
          respond(response, 401, { error: "Invalid automation webhook signature" });
          return;
        }
        const payload = JSON.parse(body) as unknown;
        const event = typeof request.headers["x-mergeproof-event"] === "string" ? request.headers["x-mergeproof-event"] : undefined;
        respond(response, 202, { accepted: true });
        void processWebhookAutomationPayload(payload, { root: options.repoPath || process.cwd(), event, model: options.model, provider: options.provider }).then((result) => options.log?.(`MergeProof automation result: ${result.text ?? result.reason ?? "ignored"}`)).catch((error) => options.log?.(`MergeProof automation webhook failed: ${error instanceof Error ? error.message : "unknown error"}`));
      } catch (error) {
        respond(response, 400, { error: error instanceof Error ? error.message : "Invalid automation webhook request" });
      }
      return;
    }
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
    if (request.method === "POST" && request.url === "/discord/interactions") {
      try {
        const body = await readBody(request);
        const timestamp = request.headers["x-signature-timestamp"];
        const signature = request.headers["x-signature-ed25519"];
        if (!options.discordPublicKey || typeof timestamp !== "string" || typeof signature !== "string" || !verifyDiscordRequestSignature(body, timestamp, signature, options.discordPublicKey)) {
          respond(response, 401, { error: "Invalid Discord signature" });
          return;
        }
        const payload = JSON.parse(body) as { type?: number };
        if (payload.type === 1) {
          respond(response, 200, { type: 1 });
          return;
        }
        respond(response, 200, { type: 5, data: { content: "MergeProof is reviewing the request. Results will follow here." } });
        void processDiscordInteraction(payload, { publicKey: options.discordPublicKey, repoPath: options.repoPath, model: options.model, provider: options.provider, log: options.log }).then((text) => options.log?.(`MergeProof Discord interaction result: ${text}`)).catch((error) => options.log?.(`MergeProof Discord interaction failed: ${error instanceof Error ? error.message : "unknown error"}`));
      } catch (error) {
        respond(response, 400, { error: error instanceof Error ? error.message : "Invalid Discord interaction" });
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
