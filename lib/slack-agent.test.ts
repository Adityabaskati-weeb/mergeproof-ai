import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseSlackCommand, verifySlackRequestSignature } from "./slack-agent";

describe("Slack agent boundary", () => {
  it("parses explicit provider-neutral review, plan, investigate, and issue commands", () => {
    expect(parseSlackCommand("review https://github.com/acme/payments/pull/42")).toEqual({ action: "review", prUrl: "https://github.com/acme/payments/pull/42" });
    expect(parseSlackCommand("plan https://github.com/acme/payments/pull/42")).toEqual({ action: "plan", prUrl: "https://github.com/acme/payments/pull/42" });
    expect(parseSlackCommand("investigate https://gitlab.com/acme/payments/-/merge_requests/7")).toEqual({ action: "investigate", prUrl: "https://gitlab.com/acme/payments/-/merge_requests/7" });
    expect(parseSlackCommand("review https://bitbucket.org/acme/payments/pull-requests/9")).toEqual({ action: "review", prUrl: "https://bitbucket.org/acme/payments/pull-requests/9" });
    expect(parseSlackCommand("hello")).toBeUndefined();
  });

  it("verifies Slack signatures and rejects stale requests", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = "text=review%20https%3A%2F%2Fgithub.com%2Facme%2Fpayments%2Fpull%2F42";
    const signature = `v0=${createHmac("sha256", "secret").update(`v0:${timestamp}:${body}`).digest("hex")}`;
    expect(verifySlackRequestSignature(body, timestamp, signature, "secret")).toBe(true);
    expect(verifySlackRequestSignature(body, String(Number(timestamp) - 600), signature, "secret")).toBe(false);
  });
});
