import { appendFile, mkdir, readFile, readdir, unlink } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
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
  name?: string;
  createdAt: string;
  updatedAt: string;
  turns: SessionTurn[];
  checkpoints: SessionCheckpoint[];
};

type SessionUpdate = { type: "session-update"; sessionId: string; updatedAt: string; name?: string };
export type SessionCheckpoint = { type: "session-compaction"; sessionId: string; createdAt: string; archivedTurns: number; retainedTurns: number; digest: string; archivePath: string };

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

function archiveFile(repository: string, id: string): string {
  return join(sessionsDirectory(repository), `${safeSessionId(id)}.archive.jsonl`);
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
  return { id, repository: resolve(repository), createdAt: now, updatedAt: now, turns: [], checkpoints: [] };
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
  const updates = records.filter((record) => record.type === "session-update") as unknown as SessionUpdate[];
  const checkpoints = records.filter((record) => record.type === "session-compaction") as unknown as SessionCheckpoint[];
  const latest = updates.at(-1);
  return { id: meta.id, repository: meta.repository, ...(latest?.name ? { name: latest.name } : {}), createdAt: meta.createdAt, updatedAt: (latest?.updatedAt ?? turns.at(-1)?.createdAt ?? checkpoints.at(-1)?.createdAt ?? meta.createdAt), turns, checkpoints };
}

export async function listSessions(repository: string, limit = 20): Promise<SessionRecord[]> {
  let files: string[];
  try { files = await readdir(sessionsDirectory(repository)); }
  catch { return []; }
  const sessions = (await Promise.all(files.filter((file) => file.endsWith(".jsonl")).map((file) => readSession(repository, file.slice(0, -6))))).filter((session): session is SessionRecord => Boolean(session));
  return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, Math.max(1, Math.min(100, limit)));
}

export async function deleteSession(repository: string, id: string): Promise<boolean> {
  try {
    await unlink(sessionFile(repository, id));
    return true;
  } catch {
    return false;
  }
}

export async function deleteAllSessions(repository: string): Promise<number> {
  const sessions = await listSessions(repository, 100);
  let deleted = 0;
  for (const session of sessions) if (await deleteSession(repository, session.id)) deleted += 1;
  return deleted;
}

export async function forkSession(repository: string, sourceId: string, requestedId?: string): Promise<SessionRecord> {
  const source = await readSession(repository, sourceId);
  if (!source) throw new Error(`Session not found: ${sourceId}`);
  const id = safeSessionId(requestedId ?? `session-fork-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`);
  if (await readSession(repository, id)) throw new Error(`Session already exists: ${id}`);
  const createdAt = new Date().toISOString();
  await mkdir(sessionsDirectory(repository), { recursive: true });
  await appendFile(sessionFile(repository, id), `${JSON.stringify({ type: "session", id, repository: resolve(repository), ...(source.name ? { name: source.name } : {}), createdAt })}\n`, "utf8");
  for (const turn of source.turns) {
    await appendFile(sessionFile(repository, id), `${JSON.stringify({ ...turn, sessionId: id })}\n`, "utf8");
  }
  const result = await readSession(repository, id);
  if (!result) throw new Error(`Failed to fork session: ${sourceId}`);
  return result;
}

export function renderSessionMarkdown(session: SessionRecord): string {
  const turns = session.turns.map((turn, index) => [`## Turn ${index + 1}: ${turn.action}`, `- Created: ${turn.createdAt}`, `- Outcome: ${turn.outcome}`, "", `### Request`, "", turn.request, "", `### Summary`, "", turn.summary].join("\n")).join("\n\n");
  const checkpoints = session.checkpoints.map((checkpoint) => `- ${checkpoint.createdAt}: archived ${checkpoint.archivedTurns} turn(s), retained ${checkpoint.retainedTurns}, digest ${checkpoint.digest.slice(0, 12)}`).join("\n");
  return [`# MergeProof session ${session.name ? `${session.name} (${session.id})` : session.id}`, "", `Repository: ${session.repository}`, `Created: ${session.createdAt}`, `Updated: ${session.updatedAt}`, "", checkpoints ? `## Checkpoints\n${checkpoints}\n` : "", turns || "No turns recorded.", ""].join("\n");
}

export async function compactSession(repository: string, id: string, keep = 20): Promise<SessionRecord> {
  if (!Number.isFinite(keep) || keep < 1 || keep > MAX_TURNS) throw new Error(`Session compaction keep must be between 1 and ${MAX_TURNS}.`);
  const session = await readSession(repository, id);
  if (!session) throw new Error(`Session not found: ${id}`);
  if (session.turns.length <= keep) return session;
  const archived = session.turns.slice(0, -Math.floor(keep));
  const retained = session.turns.slice(-Math.floor(keep));
  const archivePath = archiveFile(repository, id);
  const digest = createHash("sha256").update(JSON.stringify(archived)).digest("hex");
  await mkdir(sessionsDirectory(repository), { recursive: true });
  await appendFile(archivePath, archived.map((turn) => JSON.stringify({ ...turn, archivedAt: new Date().toISOString() })).join("\n") + "\n", "utf8");
  const checkpoint: SessionCheckpoint = { type: "session-compaction", sessionId: id, createdAt: new Date().toISOString(), archivedTurns: archived.length, retainedTurns: retained.length, digest, archivePath };
  const source = JSON.parse(await readFile(sessionFile(repository, id), "utf8").then((value) => `[${value.trim().split(/\r?\n/).join(",")}]`)) as Array<Record<string, unknown>>;
  const metadata = source.filter((record) => record.type === "session" || record.type === "session-update");
  await writeFile(sessionFile(repository, id), `${[...metadata, checkpoint, ...retained].map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
  const compacted = await readSession(repository, id);
  if (!compacted) throw new Error(`Failed to compact session: ${id}`);
  return compacted;
}

export async function sessionCheckpoints(repository: string, id: string): Promise<SessionCheckpoint[]> {
  const session = await readSession(repository, id);
  return session?.checkpoints ?? [];
}

export async function renameSession(repository: string, id: string, name: string): Promise<SessionRecord> {
  const session = await readSession(repository, id);
  if (!session) throw new Error(`Session not found: ${id}`);
  const cleanName = name.trim().slice(0, 120);
  if (!cleanName) throw new Error("Session name cannot be empty.");
  const update: SessionUpdate = { type: "session-update", sessionId: id, updatedAt: new Date().toISOString(), name: cleanName };
  await appendFile(sessionFile(repository, id), `${JSON.stringify(update)}\n`, "utf8");
  const renamed = await readSession(repository, id);
  if (!renamed) throw new Error(`Failed to rename session: ${id}`);
  return renamed;
}

export async function pruneSessions(repository: string, keep = 20): Promise<number> {
  const sessions = await listSessions(repository, 100);
  let deleted = 0;
  for (const session of sessions.slice(Math.max(0, Math.min(100, keep)))) if (await deleteSession(repository, session.id)) deleted += 1;
  return deleted;
}

export async function cleanupSessions(repository: string, olderThanDays = 30): Promise<number> {
  if (!Number.isFinite(olderThanDays) || olderThanDays < 0) throw new Error("Session cleanup days must be a non-negative number.");
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1_000;
  const sessions = await listSessions(repository, 100);
  let deleted = 0;
  for (const session of sessions) if (Date.parse(session.updatedAt) < cutoff && await deleteSession(repository, session.id)) deleted += 1;
  return deleted;
}

export async function sessionFiles(repository: string, id: string): Promise<string[]> {
  const session = await readSession(repository, id);
  if (!session) return [];
  const files = [sessionFile(repository, id)];
  try { await readFile(archiveFile(repository, id), "utf8"); files.push(archiveFile(repository, id)); } catch { /* no compaction archive */ }
  return files;
}
