import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseSlackCommand, processSlackEvent, verifySlackRequestSignature } from "./slack-agent";

describe("Slack agent boundary", () => {
  it("parses explicit provider-neutral conversational commands", () => {
    expect(parseSlackCommand("review https://github.com/acme/payments/pull/42")).toEqual({ action: "review", prUrl: "https://github.com/acme/payments/pull/42" });
    expect(parseSlackCommand("plan https://github.com/acme/payments/pull/42")).toEqual({ action: "plan", prUrl: "https://github.com/acme/payments/pull/42" });
    expect(parseSlackCommand("investigate https://gitlab.com/acme/payments/-/merge_requests/7")).toEqual({ action: "investigate", prUrl: "https://gitlab.com/acme/payments/-/merge_requests/7" });
    expect(parseSlackCommand("review https://bitbucket.org/acme/payments/pull-requests/9")).toEqual({ action: "review", prUrl: "https://bitbucket.org/acme/payments/pull-requests/9" });
    expect(parseSlackCommand("<@U123> tests https://dev.azure.com/acme/payments/_git/api/pullrequest/11")).toEqual({ action: "tests", prUrl: "https://dev.azure.com/acme/payments/_git/api/pullrequest/11" });
    expect(parseSlackCommand("review", "https://github.com/acme/payments/pull/42")).toEqual({ action: "review", prUrl: "https://github.com/acme/payments/pull/42" });
    expect(parseSlackCommand("Can you review this PR? https://github.com/acme/payments/pull/42")).toEqual({ action: "review", prUrl: "https://github.com/acme/payments/pull/42" });
    expect(parseSlackCommand("What changed? https://gitlab.com/acme/payments/-/merge_requests/7")).toEqual({ action: "investigate", prUrl: "https://gitlab.com/acme/payments/-/merge_requests/7" });
    expect(parseSlackCommand("hello")).toBeUndefined();
    expect(parseSlackCommand("learn Always validate audience claims https://github.com/acme/payments/pull/42")).toEqual({ action: "learn", fact: "Always validate audience claims", prUrl: "https://github.com/acme/payments/pull/42" });
    expect(parseSlackCommand("rate")).toEqual({ action: "rate" });
    expect(parseSlackCommand("autofix https://github.com/acme/payments/pull/42")).toEqual({ action: "autofix", prUrl: "https://github.com/acme/payments/pull/42" });
  });

  it("ignores bot events without invoking tools", async () => {
    await expect(processSlackEvent({ event: { type: "message", bot_id: "B123", text: "review https://github.com/acme/payments/pull/42" } }, { signingSecret: "secret" })).resolves.toEqual({ accepted: true, ignored: true });
  });

  it("verifies Slack signatures and rejects stale requests", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = "text=review%20https%3A%2F%2Fgithub.com%2Facme%2Fpayments%2Fpull%2F42";
    const signature = `v0=${createHmac("sha256", "secret").update(`v0:${timestamp}:${body}`).digest("hex")}`;
    expect(verifySlackRequestSignature(body, timestamp, signature, "secret")).toBe(true);
    expect(verifySlackRequestSignature(body, String(Number(timestamp) - 600), signature, "secret")).toBe(false);
  });
});
