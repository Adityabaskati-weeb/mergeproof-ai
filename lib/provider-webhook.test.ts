import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractProviderChangeRequestUrl, providerWebhookAction, verifyProviderWebhookSignature } from "./provider-webhook";

describe("provider webhook boundary", () => {
  it("extracts provider change-request URLs and actions", () => {
    expect(extractProviderChangeRequestUrl("gitlab", { object_attributes: { url: "https://gitlab.com/acme/payments/-/merge_requests/7", action: "open" } })).toBe("https://gitlab.com/acme/payments/-/merge_requests/7");
    expect(providerWebhookAction("gitlab", { object_attributes: { action: "update" } })).toBe("update");
    expect(extractProviderChangeRequestUrl("bitbucket", { pullrequest: { links: { html: { href: "https://bitbucket.org/acme/payments/pull-requests/9" } } } })).toBe("https://bitbucket.org/acme/payments/pull-requests/9");
    expect(extractProviderChangeRequestUrl("azure-devops", { resource: { _links: { web: { href: "https://dev.azure.com/acme/payments/_git/api/pullrequest/11" } } } })).toContain("pullrequest/11");
  });

  it("verifies token and HMAC provider signatures", () => {
    const body = JSON.stringify({ event: "change" });
    const signature = createHmac("sha256", "secret").update(body).digest("hex");
    expect(verifyProviderWebhookSignature("gitlab", body, { "x-gitlab-token": "secret" }, "secret")).toBe(true);
    expect(verifyProviderWebhookSignature("bitbucket", body, { "x-hub-signature": signature }, "secret")).toBe(true);
    expect(verifyProviderWebhookSignature("azure-devops", body, { "x-azure-signature": `sha256=${signature}` }, "secret")).toBe(true);
    expect(verifyProviderWebhookSignature("bitbucket", body, { "x-hub-signature": signature }, "wrong")).toBe(false);
  });
});
