import { describe, expect, it } from "vitest";
import { remoteSessionHeaders } from "./remote";
import { verifyRemoteSessionSignature } from "./webhook";

describe("signed remote session client", () => {
  it("creates a fresh HMAC header accepted by the remote boundary", () => {
    const body = JSON.stringify({ action: "ask", request: "How does auth work?" });
    const timestamp = "1760000000";
    const headers = remoteSessionHeaders(body, "test-secret", timestamp);
    expect(verifyRemoteSessionSignature(body, headers["x-mergeproof-signature"], timestamp, "test-secret", 1760000000 * 1_000)).toBe(true);
  });
});
