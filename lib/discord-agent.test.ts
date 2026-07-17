import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseDiscordCommand, verifyDiscordRequestSignature } from "./discord-agent";

describe("Discord agent boundary", () => {
  it("verifies Discord Ed25519 signatures", () => {
    const keys = generateKeyPairSync("ed25519");
    const der = keys.publicKey.export({ format: "der", type: "spki" }) as Buffer;
    const publicKey = der.subarray(-32).toString("hex");
    const body = JSON.stringify({ type: 2 });
    const timestamp = Math.floor(Date.now() / 1_000).toString();
    const signature = sign(null, Buffer.from(`${timestamp}${body}`), keys.privateKey).toString("hex");
    expect(verifyDiscordRequestSignature(body, timestamp, signature, publicKey)).toBe(true);
    expect(verifyDiscordRequestSignature(body, timestamp, `${signature.slice(0, -2)}00`, publicKey)).toBe(false);
  });

  it("maps a Discord slash command to the governed command parser", () => {
    expect(parseDiscordCommand({ type: 1 }).ping).toBe(true);
    expect(parseDiscordCommand({ type: 2, data: { name: "mergeproof", options: [{ name: "text", value: "review https://github.com/acme/app/pull/1" }] } }).command).toMatchObject({ action: "review", prUrl: "https://github.com/acme/app/pull/1" });
  });
});
