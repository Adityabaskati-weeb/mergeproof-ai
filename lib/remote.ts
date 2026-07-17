import { createHmac } from "node:crypto";

export type RemoteAction = "ask" | "plan" | "review";
export type RemoteTurnOptions = { secret: string; sessionId?: string; model?: string; provider?: string; agent?: string; endpoint?: string; timeoutMs?: number };

export function remoteSessionHeaders(body: string, secret: string, timestamp = Math.floor(Date.now() / 1_000).toString()): Record<string, string> {
  if (!secret.trim()) throw new Error("A remote session secret is required.");
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return { "content-type": "application/json", "x-mergeproof-signature": `sha256=${signature}`, "x-mergeproof-timestamp": timestamp };
}

function sessionEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Remote endpoint must use http or https.");
  if (!url.pathname.endsWith("/session/turn")) url.pathname = `${url.pathname.replace(/\/$/, "")}/session/turn`;
  return url.toString();
}

export async function requestRemoteTurn(action: RemoteAction, request: string, options: RemoteTurnOptions): Promise<unknown> {
  if (!request.trim() || request.length > 16_000) throw new Error("Remote request must be non-empty and at most 16,000 characters.");
  const body = JSON.stringify({ action, request, ...(options.sessionId ? { sessionId: options.sessionId } : {}), ...(options.model ? { model: options.model } : {}), ...(options.provider ? { provider: options.provider } : {}), ...(options.agent ? { agent: options.agent } : {}) });
  const response = await fetch(sessionEndpoint(options.endpoint ?? process.env.MERGEPROOF_REMOTE_URL ?? "http://127.0.0.1:8787"), { method: "POST", headers: remoteSessionHeaders(body, options.secret), body, signal: AbortSignal.timeout(options.timeoutMs ?? 60_000) });
  const text = await response.text();
  let value: unknown;
  try { value = JSON.parse(text) as unknown; } catch { value = { raw: text }; }
  if (!response.ok) throw new Error(`Remote session request failed (${response.status}): ${typeof value === "object" && value && "error" in value ? String((value as { error: unknown }).error) : text.slice(0, 500)}`);
  return value;
}
