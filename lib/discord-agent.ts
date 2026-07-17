import { createPublicKey, verify } from "node:crypto";
import { parseSlackCommand, runSlackCommand, type SlackAgentOptions, type SlackCommand } from "./slack-agent";

export type DiscordAgentOptions = Omit<SlackAgentOptions, "signingSecret"> & { publicKey: string };
type DiscordInteractionPayload = { type?: number; application_id?: string; token?: string; data?: { name?: string; options?: unknown[] } };

function discordPublicKey(value: string): ReturnType<typeof createPublicKey> {
  const raw = Buffer.from(value.trim(), "hex");
  if (raw.length !== 32) throw new Error("Discord public key must be a 32-byte hexadecimal value.");
  return createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]), format: "der", type: "spki" });
}

export function verifyDiscordRequestSignature(body: string, timestamp: string | undefined, signature: string | undefined, publicKey: string): boolean {
  if (!timestamp || !signature || !publicKey) return false;
  try {
    return verify(null, Buffer.from(`${timestamp}${body}`), discordPublicKey(publicKey), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

function optionValue(options: unknown, name: string): string | undefined {
  if (!Array.isArray(options)) return undefined;
  const option = options.find((value) => Boolean(value) && typeof value === "object" && (value as { name?: unknown }).name === name) as { value?: unknown } | undefined;
  return typeof option?.value === "string" ? option.value : undefined;
}

export function parseDiscordCommand(payload: unknown): { command?: SlackCommand; ping: boolean } {
  if (!payload || typeof payload !== "object") return { ping: false };
  const value = payload as { type?: number; data?: { name?: string; options?: unknown[] } };
  if (value.type === 1) return { ping: true };
  if (value.type !== 2 || value.data?.name !== "mergeproof") return { ping: false };
  const text = optionValue(value.data.options, "text") ?? [optionValue(value.data.options, "action"), optionValue(value.data.options, "url")].filter(Boolean).join(" ");
  return { ping: false, command: text ? parseSlackCommand(text) : undefined };
}

export async function processDiscordInteraction(payload: unknown, options: DiscordAgentOptions): Promise<string> {
  const parsed = parseDiscordCommand(payload);
  if (parsed.ping) return "Discord interaction acknowledged.";
  if (!parsed.command) throw new Error("Use /mergeproof with an action and a public change-request URL.");
  let result: string;
  try {
    result = await runSlackCommand(parsed.command, { ...options, signingSecret: "discord-interaction" });
  } catch (error) {
    result = `MergeProof failed: ${error instanceof Error ? error.message : "unknown error"}`;
    options.log?.(result);
  }
  const interaction = payload as DiscordInteractionPayload;
  if (!interaction.application_id || !interaction.token) throw new Error("Discord interaction did not include a follow-up token.");
  const response = await fetch(`https://discord.com/api/v10/webhooks/${encodeURIComponent(interaction.application_id)}/${encodeURIComponent(interaction.token)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: result.slice(0, 2_000) }) });
  if (!response.ok) throw new Error(`Discord follow-up publication failed with HTTP ${response.status}.`);
  return result;
}
