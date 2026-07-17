import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { remoteSessionHeaders } from "./remote";
import { parseGithubCommentCommand, processGithubWebhookPayload, startGithubWebhookServer, verifyGithubWebhookSignature, verifyRemoteSessionSignature } from "./webhook";

describe("GitHub webhook boundary", () => {
  it("verifies the GitHub sha256 signature", () => {
    const body = JSON.stringify({ action: "opened" });
    const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(verifyGithubWebhookSignature(body, signature, "secret")).toBe(true);
    expect(verifyGithubWebhookSignature(body, signature, "wrong")).toBe(false);
  });

  it("verifies fresh signed read-only remote session turns", () => {
    const body = JSON.stringify({ action: "ask", request: "What changed?" });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", "remote-secret").update(`${timestamp}.${body}`).digest("hex");
    expect(verifyRemoteSessionSignature(body, signature, timestamp, "remote-secret")).toBe(true);
    expect(verifyRemoteSessionSignature(body, signature, String(Number(timestamp) - 301), "remote-secret")).toBe(false);
    expect(verifyRemoteSessionSignature(body, "sha256=bad", timestamp, "remote-secret")).toBe(false);
  });

  it("rejects a signed remote delegation before starting a worker when verification is unsafe", async () => {
    const server = startGithubWebhookServer({ remoteSessionSecret: "remote-secret", repoPath: process.cwd(), port: 0 });
    try {
      await new Promise<void>((resolve) => server.once("listening", () => resolve()));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP address.");
      const body = JSON.stringify({ action: "start", request: "Add a test", verify: "npm run arbitrary-command" });
      const timestamp = String(Math.floor(Date.now() / 1_000));
      const headers = { ...remoteSessionHeaders(body, "remote-secret", timestamp), "x-mergeproof-timestamp": timestamp };
      const response = await fetch(`http://127.0.0.1:${address.port}/delegate`, { method: "POST", headers, body });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining("verify must be one of") });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
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

  it("enforces imported automatic review policy before fetching a PR", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-webhook-"));
    try {
      await mkdir(join(root, ".mergeproof"), { recursive: true });
      await writeFile(join(root, ".mergeproof", "config.json"), JSON.stringify({ autoReview: false, ignoreTitleKeywords: ["wip"], autoIncrementalReview: false }), "utf8");
      const basePayload = { action: "opened", pull_request: { html_url: "https://github.com/acme/widget/pull/42", title: "WIP: draft", body: "", commits: 1 } };
      await expect(processGithubWebhookPayload(basePayload, { event: "pull_request", repoPath: root })).resolves.toMatchObject({ ignored: true, reason: "review_auto_disabled" });
      await writeFile(join(root, ".mergeproof", "config.json"), JSON.stringify({ autoReview: true, ignoreTitleKeywords: ["wip"] }), "utf8");
      await expect(processGithubWebhookPayload(basePayload, { event: "pull_request", repoPath: root })).resolves.toMatchObject({ ignored: true, reason: "review_title_excluded" });
      await writeFile(join(root, ".mergeproof", "config.json"), JSON.stringify({ autoReview: true, autoIncrementalReview: false }), "utf8");
      await expect(processGithubWebhookPayload({ ...basePayload, action: "synchronize" }, { event: "pull_request", repoPath: root })).resolves.toMatchObject({ ignored: true, reason: "review_incremental_disabled" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
