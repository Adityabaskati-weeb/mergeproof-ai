import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseGithubCommentCommand, processGithubWebhookPayload, verifyGithubWebhookSignature } from "./webhook";

describe("GitHub webhook boundary", () => {
  it("verifies the GitHub sha256 signature", () => {
    const body = JSON.stringify({ action: "opened" });
    const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(verifyGithubWebhookSignature(body, signature, "secret")).toBe(true);
    expect(verifyGithubWebhookSignature(body, signature, "wrong")).toBe(false);
  });

  it("ignores unrelated event types without invoking a model", async () => {
    await expect(processGithubWebhookPayload({}, { event: "push" })).resolves.toEqual({ accepted: true, ignored: true, reason: "unsupported_event" });
  });

  it("requires an explicit natural-language request and checkout for comment editing", async () => {
    await expect(processGithubWebhookPayload({ issue: { html_url: "https://github.com/acme/widget/issues/42", pull_request: {} }, comment: { body: "/mergeproof implement" } }, { event: "issue_comment" })).resolves.toMatchObject({ accepted: false, reason: "missing_implementation_request" });
    await expect(processGithubWebhookPayload({ issue: { html_url: "https://github.com/acme/widget/issues/42", pull_request: {} }, comment: { body: "/mergeproof implement add a retry" } }, { event: "issue_comment" })).resolves.toMatchObject({ accepted: false, reason: "implementation_requires_repo_checkout" });
  });

  it("parses CodeRabbit-compatible command aliases without invoking integrations", () => {
    expect(parseGithubCommentCommand("/mergeproof generate unit tests")).toEqual({ command: "generate unit tests", instruction: "" });
    expect(parseGithubCommentCommand("/mergeproof autofix stacked pr")).toEqual({ command: "autofix stacked pr", instruction: "" });
    expect(parseGithubCommentCommand("/mergeproof run api-contract")).toEqual({ command: "run", instruction: "api-contract" });
    expect(parseGithubCommentCommand("plain comment")).toBeUndefined();
  });
});
