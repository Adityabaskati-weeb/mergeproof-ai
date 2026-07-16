import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { processGithubWebhookPayload, verifyGithubWebhookSignature } from "./webhook";

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
});
