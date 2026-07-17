import { describe, expect, it } from "vitest";
import { remoteSessionHeaders, requestRemoteDelegation } from "./remote";
import { verifyRemoteSessionSignature } from "./webhook";

describe("signed remote session client", () => {
  it("creates a fresh HMAC header accepted by the remote boundary", () => {
    const body = JSON.stringify({ action: "ask", request: "How does auth work?" });
    const timestamp = "1760000000";
    const headers = remoteSessionHeaders(body, "test-secret", timestamp);
    expect(verifyRemoteSessionSignature(body, headers["x-mergeproof-signature"], timestamp, "test-secret", 1760000000 * 1_000)).toBe(true);
  });

  it("requires an allowlisted verification command before remote delegation starts", async () => {
    await expect(requestRemoteDelegation("start", "Add a focused test", { secret: "test-secret" })).rejects.toThrow("verification command");
  });

  it("signs delegation lifecycle payloads with the same HMAC boundary", async () => {
    const originalFetch = globalThis.fetch;
    let captured = "";
    let capturedHeaders: Headers | undefined;
    globalThis.fetch = (async (_input, init) => {
      captured = String(init?.body ?? "");
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      await expect(requestRemoteDelegation("start", "Add a focused test", { secret: "test-secret", verify: "npm test" })).resolves.toEqual({ accepted: true });
      expect(verifyRemoteSessionSignature(captured, capturedHeaders?.get("x-mergeproof-signature") ?? undefined, capturedHeaders?.get("x-mergeproof-timestamp") ?? undefined, "test-secret")).toBe(true);
      expect(JSON.parse(captured)).toMatchObject({ action: "start", request: "Add a focused test", verify: "npm test" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
