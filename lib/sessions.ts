import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";

const MAX_TURNS = 100;
const MAX_TEXT = 12_000;

export type SessionTurn = {
  type: "turn";
  sessionId: string;
  createdAt: string;
  action: string;
  request: string;
  outcome: "success" | "error";
  summary: string;
  trace?: Record<string, unknown>;
};

export type SessionRecord = {
  id: string;
  repository: string;
  createdAt: string;
  updatedAt: string;
  turns: SessionTurn[];
};

function sessionsDirectory(repository: string): string {
  return join(resolve(repository), ".mergeproof", "sessions");
}

function safeSessionId(value: string): string {
  const id = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id)) throw new Error("Session IDs must contain only letters, numbers, '.', '_', or '-'.");
  return id;
}

function sessionFile(repository: string, id: string): string {
  return join(sessionsDirectory(repository), `${safeSessionId(id)}.jsonl`);
}

function trimText(value: string): string {
  return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}\n[truncated]` : value;
}

export async function openSession(repository: string, requestedId?: string): Promise<SessionRecord> {
  const id = requestedId ? safeSessionId(requestedId) : `session-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const existing = await readSession(repository, id);
  if (existing) return existing;
  const now = new Date().toISOString();
  await mkdir(sessionsDirectory(repository), { recursive: true });
  const meta = { type: "session", id, repository: resolve(repository), createdAt: now };
  await appendFile(sessionFile(repository, id), `${JSON.stringify(meta)}\n`, "utf8");
  return { id, repository: resolve(repository), createdAt: now, updatedAt: now, turns: [] };
}

export async function appendSessionTurn(repository: string, id: string, turn: Omit<SessionTurn, "type" | "sessionId" | "createdAt">): Promise<SessionTurn> {
  const session = await readSession(repository, id);
  if (!session) throw new Error(`Session not found: ${id}`);
  if (session.turns.length >= MAX_TURNS) throw new Error(`Session ${id} reached the ${MAX_TURNS}-turn limit. Start a new session.`);
  const record: SessionTurn = { type: "turn", sessionId: session.id, createdAt: new Date().toISOString(), action: turn.action, request: trimText(turn.request), outcome: turn.outcome, summary: trimText(turn.summary), ...(turn.trace ? { trace: turn.trace } : {}) };
  await appendFile(sessionFile(repository, id), `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

export async function readSession(repository: string, id: string): Promise<SessionRecord | undefined> {
  let content: string;
  try { content = await readFile(sessionFile(repository, id), "utf8"); }
  catch { return undefined; }
  const records = content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  const meta = records.find((record) => record.type === "session");
  if (!meta || typeof meta.id !== "string" || typeof meta.repository !== "string" || typeof meta.createdAt !== "string") return undefined;
  const turns = records.filter((record) => record.type === "turn") as unknown as SessionTurn[];
  return { id: meta.id, repository: meta.repository, createdAt: meta.createdAt, updatedAt: (turns.at(-1)?.createdAt ?? meta.createdAt), turns };
}

export async function listSessions(repository: string, limit = 20): Promise<SessionRecord[]> {
  let files: string[];
  try { files = await readdir(sessionsDirectory(repository)); }
  catch { return []; }
  const sessions = (await Promise.all(files.filter((file) => file.endsWith(".jsonl")).map((file) => readSession(repository, file.slice(0, -6))))).filter((session): session is SessionRecord => Boolean(session));
  return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, Math.max(1, Math.min(100, limit)));
}

