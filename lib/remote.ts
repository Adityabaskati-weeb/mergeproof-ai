import { createHmac } from "node:crypto";

export type RemoteAction = "ask" | "plan" | "review";
export type RemoteTurnOptions = { secret: string; sessionId?: string; model?: string; provider?: string; agent?: string; endpoint?: string; timeoutMs?: number };
export type RemoteDelegationAction = "start" | "status" | "cancel";
export type RemoteDelegationOptions = { secret: string; endpoint?: string; model?: string; provider?: string; agent?: string; verify?: string; maxIterations?: number; apply?: boolean; timeoutMs?: number };

export function remoteSessionHeaders(body: string, secret: string, timestamp = Math.floor(Date.now() / 1_000).toString()): Record<string, string> {
  if (!secret.trim()) throw new Error("A remote session secret is required.");
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return { "content-type": "application/json", "x-mergeproof-signature": `sha256=${signature}`, "x-mergeproof-timestamp": timestamp };
}

function endpoint(endpoint: string, path: string): string {
  const url = new URL(endpoint);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Remote endpoint must use http or https.");
  if (!url.pathname.endsWith(path)) url.pathname = `${url.pathname.replace(/\/$/, "")}${path}`;
  return url.toString();
}

export async function requestRemoteTurn(action: RemoteAction, request: string, options: RemoteTurnOptions): Promise<unknown> {
  if (!request.trim() || request.length > 16_000) throw new Error("Remote request must be non-empty and at most 16,000 characters.");
  const body = JSON.stringify({ action, request, ...(options.sessionId ? { sessionId: options.sessionId } : {}), ...(options.model ? { model: options.model } : {}), ...(options.provider ? { provider: options.provider } : {}), ...(options.agent ? { agent: options.agent } : {}) });
  const response = await fetch(endpoint(options.endpoint ?? process.env.MERGEPROOF_REMOTE_URL ?? "http://127.0.0.1:8787", "/session/turn"), { method: "POST", headers: remoteSessionHeaders(body, options.secret), body, signal: AbortSignal.timeout(options.timeoutMs ?? 60_000) });
  const text = await response.text();
  let value: unknown;
  try { value = JSON.parse(text) as unknown; } catch { value = { raw: text }; }
  if (!response.ok) throw new Error(`Remote session request failed (${response.status}): ${typeof value === "object" && value && "error" in value ? String((value as { error: unknown }).error) : text.slice(0, 500)}`);
  return value;
}

export async function requestRemoteDelegation(action: RemoteDelegationAction, requestOrId: string, options: RemoteDelegationOptions): Promise<unknown> {
  const value = requestOrId.trim();
  if (!value || value.length > 12_000) throw new Error("Remote delegation request or ID must be non-empty and at most 12,000 characters.");
  if (action === "start" && !options.verify) throw new Error("Remote delegation start requires an allowlisted verification command.");
  const body = JSON.stringify({ action, ...(action === "start" ? { request: value } : { delegationId: value }), ...(options.model ? { model: options.model } : {}), ...(options.provider ? { provider: options.provider } : {}), ...(options.agent ? { agent: options.agent } : {}), ...(options.verify ? { verify: options.verify } : {}), ...(options.maxIterations ? { maxIterations: options.maxIterations } : {}), ...(options.apply ? { apply: true } : {}) });
  const response = await fetch(endpoint(options.endpoint ?? process.env.MERGEPROOF_REMOTE_URL ?? "http://127.0.0.1:8787", "/delegate"), { method: "POST", headers: remoteSessionHeaders(body, options.secret), body, signal: AbortSignal.timeout(options.timeoutMs ?? 60_000) });
  const text = await response.text();
  let result: unknown;
  try { result = JSON.parse(text) as unknown; } catch { result = { raw: text }; }
  if (!response.ok) throw new Error(`Remote delegation request failed (${response.status}): ${typeof result === "object" && result && "error" in result ? String((result as { error: unknown }).error) : text.slice(0, 500)}`);
  return result;
}
