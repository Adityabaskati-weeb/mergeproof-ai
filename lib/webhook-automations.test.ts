import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { matchWebhookAutomation, verifyWebhookAutomationSignature, type WebhookAutomation } from "./webhook-automations";

const automation: WebhookAutomation = { id: "incident-review", action: "review", event: "incident.created", field: "data.service", equals: "payments", urlField: "data.prUrl" };

describe("custom webhook automations", () => {
  it("matches event and nested payload fields", () => {
    expect(matchWebhookAutomation([automation], { data: { service: "payments" } }, "incident.created")).toBe(automation);
    expect(matchWebhookAutomation([automation], { data: { service: "search" } }, "incident.created")).toBeUndefined();
    expect(matchWebhookAutomation([automation], { data: { service: "payments" } }, "incident.closed")).toBeUndefined();
  });

  it("verifies signed webhook bodies", () => {
    const body = JSON.stringify({ event: "incident.created" });
    const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
    expect(verifyWebhookAutomationSignature(body, signature, "secret")).toBe(true);
    expect(verifyWebhookAutomationSignature(body, signature, "wrong")).toBe(false);
  });
});
