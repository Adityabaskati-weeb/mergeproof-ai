import { createServer, type Server, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { resolve } from "node:path";
import { runChatTurn, type ChatTurnAction } from "./chat-turn";
import { readSession } from "./sessions";

type JsonRpcRequest = { jsonrpc?: unknown; id?: string | number | null; method?: unknown; params?: unknown };
type AcpMode = "ask" | "plan" | "review";
export type AcpServerOptions = { repoPath: string; model?: string; provider?: string; agent?: string; host?: string; port?: number };
export type AcpConnectionOptions = Pick<AcpServerOptions, "repoPath" | "model" | "provider" | "agent">;

const AVAILABLE_COMMANDS = [
  { name: "ask", description: "Ask a read-only repository question.", input: { hint: "question" } },
  { name: "plan", description: "Create an evidence-backed implementation plan.", input: { hint: "request" } },
  { name: "review", description: "Run the evidence gate for a pull request URL.", input: { hint: "pull request URL" } },
  { name: "session", description: "Show the current MergeProof ACP session." },
];

function response(id: string | number | null | undefined, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result });
}

function errorResponse(id: string | number | null | undefined, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

function notification(method: string, params: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", method, params });
}

function textFromPrompt(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value
    .filter((part): part is { type?: unknown; text?: unknown } => Boolean(part) && typeof part === "object")
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text))
    .join("\n")
    .trim();
}

function modeAndRequest(value: string, current: AcpMode): { mode: AcpMode; request: string } {
  const match = value.match(/^\/(ask|plan|review)\b\s*([\s\S]*)$/i);
  if (match) return { mode: match[1].toLowerCase() as AcpMode, request: match[2].trim() };
  return { mode: current, request: value };
}

function renderOutput(action: ChatTurnAction, output: Record<string, unknown>): string {
  if (action === "ask" && typeof output.answer === "string") return output.answer;
  if (action === "plan" && typeof output.summary === "string") {
    const steps = Array.isArray(output.steps) ? output.steps.map((step, index) => {
      const value = step && typeof step === "object" ? step as { title?: unknown; detail?: unknown } : {};
      return `${index + 1}. ${String(value.title ?? "Step")}: ${String(value.detail ?? "")}`;
    }).join("\n") : "";
    return [output.summary, steps].filter(Boolean).join("\n\n");
  }
  if (action === "review" && typeof output.decision === "string") {
    const rows = Array.isArray(output.rows) ? output.rows.map((row) => {
      const value = row && typeof row === "object" ? row as { state?: unknown; criterion?: unknown; evidence?: unknown } : {};
      return `${String(value.state ?? "warn").toUpperCase()}: ${String(value.criterion ?? "criterion")} - ${String(value.evidence ?? "")}`;
    }).join("\n") : "";
    return [`Decision: ${output.decision}`, rows].filter(Boolean).join("\n");
  }
  return JSON.stringify(output, null, 2);
}

function insideRepository(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root).replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
  const normalizedCandidate = resolve(candidate).replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

export function createAcpConnection(options: AcpConnectionOptions, output: Writable): (line: string) => Promise<void> {
  let initialized = false;
  const sessions = new Map<string, { mode: AcpMode; cancelled: boolean }>();
  const send = (value: string): void => { output.write(`${value}\n`); };
  const fail = (id: string | number | null | undefined, code: number, message: string): void => send(errorResponse(id, code, message));
  const requireInitialized = (request: JsonRpcRequest): boolean => {
    if (initialized) return true;
    fail(request.id, -32002, "initialize must be the first request.");
    return false;
  };
  return async (line: string): Promise<void> => {
    if (!line.trim()) return;
    let request: JsonRpcRequest;
    try { request = JSON.parse(line) as JsonRpcRequest; }
    catch { send(errorResponse(null, -32700, "Invalid JSON.")); return; }
    if (request.jsonrpc !== undefined && request.jsonrpc !== "2.0") { fail(request.id, -32600, "Only JSON-RPC 2.0 is supported."); return; }
    const method = typeof request.method === "string" ? request.method : "";
    if (method === "initialize") {
      if (initialized) { fail(request.id, -32600, "Already initialized."); return; }
      initialized = true;
      send(response(request.id, { protocolVersion: 1, agentInfo: { name: "mergeproof", title: "MergeProof", version: "0.5.0" }, agentCapabilities: { loadSession: true, promptCapabilities: { image: false, audio: false, embeddedContext: false } } }));
      return;
    }
    if (!requireInitialized(request)) return;
    if (method === "session/new") {
      const params = request.params && typeof request.params === "object" ? request.params as { cwd?: unknown } : {};
      if (typeof params.cwd === "string" && !insideRepository(options.repoPath, params.cwd)) { fail(request.id, -32602, "The session cwd must remain inside the configured repository."); return; }
      const sessionId = `mergeproof-${randomUUID()}`;
      sessions.set(sessionId, { mode: "ask", cancelled: false });
      send(response(request.id, { sessionId, modes: { currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask", description: "Read-only repository questions." }, { id: "plan", name: "Plan", description: "Evidence-backed implementation plans." }, { id: "review", name: "Review", description: "Evidence-backed pull-request reviews." }] } }));
      send(notification("session/update", { sessionId, update: { sessionUpdate: "available_commands_update", availableCommands: AVAILABLE_COMMANDS } }));
      return;
    }
    if (method === "session/load") {
      const params = request.params && typeof request.params === "object" ? request.params as { sessionId?: unknown } : {};
      if (typeof params.sessionId !== "string") { fail(request.id, -32602, "sessionId is required."); return; }
      let existing;
      try {
        existing = await readSession(options.repoPath, params.sessionId);
      } catch {
        fail(request.id, -32602, "Invalid MergeProof ACP sessionId.");
        return;
      }
      if (!existing) { fail(request.id, -32005, "MergeProof ACP session was not found in the configured repository."); return; }
      sessions.set(existing.id, { mode: "ask", cancelled: false });
      send(response(request.id, { sessionId: existing.id, modes: { currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask", description: "Read-only repository questions." }, { id: "plan", name: "Plan", description: "Evidence-backed implementation plans." }, { id: "review", name: "Review", description: "Evidence-backed pull-request reviews." }] } }));
      send(notification("session/update", { sessionId: existing.id, update: { sessionUpdate: "available_commands_update", availableCommands: AVAILABLE_COMMANDS } }));
      return;
    }
    if (method === "session/set_mode") {
      const params = request.params && typeof request.params === "object" ? request.params as { sessionId?: unknown; mode?: unknown } : {};
      const session = typeof params.sessionId === "string" ? sessions.get(params.sessionId) : undefined;
      if (!session) { fail(request.id, -32602, "Unknown sessionId."); return; }
      if (params.mode !== "ask" && params.mode !== "plan" && params.mode !== "review") { fail(request.id, -32602, "Unsupported mode. Use ask, plan, or review."); return; }
      session.mode = params.mode;
      send(response(request.id, { modeId: session.mode }));
      return;
    }
    if (method === "session/cancel") {
      const params = request.params && typeof request.params === "object" ? request.params as { sessionId?: unknown } : {};
      const session = typeof params.sessionId === "string" ? sessions.get(params.sessionId) : undefined;
      if (!session) { fail(request.id, -32602, "Unknown sessionId."); return; }
      session.cancelled = true;
      send(response(request.id, {}));
      return;
    }
    if (method === "session/prompt") {
      const params = request.params && typeof request.params === "object" ? request.params as { sessionId?: unknown; prompt?: unknown } : {};
      const session = typeof params.sessionId === "string" ? sessions.get(params.sessionId) : undefined;
      if (!session) { fail(request.id, -32602, "Unknown sessionId."); return; }
      const raw = textFromPrompt(params.prompt);
      if (!raw || raw.length > 16_000) { fail(request.id, -32602, "Prompt must be non-empty and at most 16,000 characters."); return; }
      session.cancelled = false;
      const selected = modeAndRequest(raw, session.mode);
      session.mode = selected.mode;
      if (selected.mode === "review" && !/^https?:\/\//i.test(selected.request)) { fail(request.id, -32602, "Review mode requires a pull-request URL."); return; }
      send(notification("session/update", { sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `MergeProof ${selected.mode} started.\n` } } }));
      try {
        const result = await runChatTurn(selected.mode, selected.request, { repoPath: options.repoPath, model: options.model, provider: options.provider, agent: options.agent });
        if (session.cancelled) { send(response(request.id, { stopReason: "cancelled" })); return; }
        const text = renderOutput(result.action, result.output);
        send(notification("session/update", { sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } }));
        send(response(request.id, { stopReason: "end_turn" }));
      } catch (error) {
        send(errorResponse(request.id, -32000, error instanceof Error ? error.message : "MergeProof ACP turn failed."));
      }
      return;
    }
    fail(request.id, -32601, `Unsupported ACP method: ${method || "(missing)"}`);
  };
}

async function attachAcpStream(input: Readable, output: Writable, options: AcpConnectionOptions): Promise<void> {
  const handle = createAcpConnection(options, output);
  const reader = createInterface({ input, crlfDelay: Infinity });
  for await (const line of reader) await handle(line);
}

export async function runAcpStdio(options: AcpConnectionOptions): Promise<void> {
  await attachAcpStream(process.stdin, process.stdout, options);
}

export function startAcpTcpServer(options: AcpServerOptions): Server {
  const server = createServer((socket: Socket) => { void attachAcpStream(socket, socket, options).catch((error) => socket.destroy(error instanceof Error ? error : undefined)); });
  server.listen(options.port ?? 0, options.host ?? "127.0.0.1");
  return server;
}
