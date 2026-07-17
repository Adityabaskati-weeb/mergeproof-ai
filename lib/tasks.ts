import { createHash, randomUUID } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";

export const TASK_ACTIONS = ["review", "research", "ask", "benchmark", "doctor"] as const;
export type TaskAction = typeof TASK_ACTIONS[number];
export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type TaskRecord = {
  id: string;
  repository: string;
  action: TaskAction;
  args: string[];
  status: TaskStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  pid?: number;
  exitCode?: number | null;
  logPath: string;
  resultPath: string;
  error?: string;
};

export type TaskResultArtifact = {
  taskId: string;
  action: TaskAction;
  status: TaskStatus;
  exitCode?: number | null;
  completedAt: string;
  logPath: string;
  outputBytes: number;
  outputSha256: string;
  error?: string;
};

const MAX_TASKS = 100;
const MAX_LOG_BYTES = 2_000_000;

function tasksDirectory(repository: string): string {
  return join(resolve(repository), ".mergeproof", "tasks");
}

function safeTaskId(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id)) throw new Error("Task IDs must contain only letters, numbers, '.', '_', or '-'.");
  return id;
}

function taskFile(repository: string, id: string): string {
  return join(tasksDirectory(repository), `${safeTaskId(id)}.json`);
}

export function isTaskAction(value: string): value is TaskAction {
  return (TASK_ACTIONS as readonly string[]).includes(value);
}

export function createTaskRecord(repository: string, action: TaskAction, args: string[], requestedId?: string): TaskRecord {
  const id = safeTaskId(requestedId ?? `task-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`);
  const logPath = join(tasksDirectory(repository), `${id}.log`);
  return { id, repository: resolve(repository), action, args: [...args], status: "queued", createdAt: new Date().toISOString(), logPath, resultPath: join(tasksDirectory(repository), `${id}.result.json`) };
}

export async function writeTask(task: TaskRecord): Promise<TaskRecord> {
  await mkdir(tasksDirectory(task.repository), { recursive: true });
  await writeFile(taskFile(task.repository, task.id), `${JSON.stringify(task, null, 2)}\n`, "utf8");
  return task;
}

export async function readTask(repository: string, id: string): Promise<TaskRecord | undefined> {
  try {
    const value = JSON.parse(await readFile(taskFile(repository, id), "utf8")) as TaskRecord;
    if (!value || value.id !== id || !isTaskAction(value.action) || !Array.isArray(value.args)) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

export async function listTasks(repository: string, limit = 20): Promise<TaskRecord[]> {
  let files: string[];
  try { files = await readdir(tasksDirectory(repository)); } catch { return []; }
  const tasks = (await Promise.all(files.filter((file) => file.endsWith(".json")).map((file) => readTask(repository, file.slice(0, -5))))).filter((task): task is TaskRecord => Boolean(task));
  return tasks.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, Math.max(1, Math.min(MAX_TASKS, limit)));
}

function cliInvocation(): { command: string; args: string[] } {
  if ((process as NodeJS.Process & { pkg?: unknown }).pkg) return { command: process.execPath, args: [] };
  const tsEntry = process.argv.slice(1).find((value) => /[\\/]bin[\\/]mergeproof\.ts$/.test(value));
  if (tsEntry) return { command: process.execPath, args: [resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs"), resolve(tsEntry)] };
  const entry = resolve(process.argv[1] ?? "");
  return { command: process.execPath, args: [entry] };
}

export async function startTask(repository: string, action: TaskAction, args: string[], background = true): Promise<TaskRecord> {
  const task = await writeTask(createTaskRecord(repository, action, args));
  if (!background) {
    const result = await runTaskWorker(task.repository, task.id);
    if (!result) throw new Error(`Task worker could not load ${task.id}.`);
    return result;
  }
  const invocation = cliInvocation();
  const child = spawn(invocation.command, [...invocation.args, "__task-worker", task.id], { cwd: task.repository, detached: true, stdio: "ignore", windowsHide: true });
  const running = { ...task, pid: child.pid };
  await writeTask(running);
  child.unref();
  return running;
}

async function boundedLogPath(path: string): Promise<void> {
  try {
    const content = await readFile(path);
    if (content.byteLength > MAX_LOG_BYTES) await writeFile(path, Buffer.concat([content.subarray(0, MAX_LOG_BYTES), Buffer.from("\n[log truncated]\n")]))
  } catch { /* The action may fail before opening its log. */ }
}

async function writeResultArtifact(task: TaskRecord, status: TaskStatus, exitCode: number | null | undefined, error?: string): Promise<void> {
  let output = Buffer.alloc(0);
  try {
    output = await readFile(task.logPath);
  } catch { /* A queued task can be cancelled before its log is opened. */ }
  try {
    const artifact: TaskResultArtifact = {
      taskId: task.id,
      action: task.action,
      status,
      ...(exitCode === undefined ? {} : { exitCode }),
      completedAt: new Date().toISOString(),
      logPath: task.logPath,
      outputBytes: output.byteLength,
      outputSha256: createHash("sha256").update(output).digest("hex"),
      ...(error ? { error } : {}),
    };
    await writeFile(task.resultPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  } catch { /* Result persistence must not mask the task's actual exit status. */ }
}

export async function runTaskWorker(repository: string, id: string): Promise<TaskRecord | undefined> {
  const queued = await readTask(repository, id);
  if (!queued || queued.status !== "queued") return queued;
  const started = { ...queued, status: "running" as const, startedAt: new Date().toISOString(), pid: process.pid };
  await writeTask(started);
  const invocation = cliInvocation();
  const logFd = openSync(started.logPath, "a");
  const child = spawn(invocation.command, [...invocation.args, started.action, ...started.args], { cwd: started.repository, stdio: ["ignore", logFd, logFd], windowsHide: true });
  const forwardSignal = () => { if (child.pid) try { process.kill(child.pid); } catch { /* already exited */ } };
  process.once("SIGTERM", forwardSignal);
  process.once("SIGINT", forwardSignal);
  const exitCode = await new Promise<number | null>((resolveExit) => child.once("close", (code) => resolveExit(code)));
  process.removeListener("SIGTERM", forwardSignal);
  process.removeListener("SIGINT", forwardSignal);
  closeSync(logFd);
  await boundedLogPath(started.logPath);
  const latest = await readTask(started.repository, id);
  if (latest?.status === "cancelled") {
    await writeResultArtifact(latest, "cancelled", exitCode, latest.error);
    return latest;
  }
  const finished = { ...started, status: exitCode === 0 ? "succeeded" as const : "failed" as const, finishedAt: new Date().toISOString(), exitCode, ...(exitCode === 0 ? {} : { error: `Action exited with code ${exitCode ?? "unknown"}.` }) };
  await writeTask(finished);
  await writeResultArtifact(finished, finished.status, exitCode, finished.error);
  return finished;
}

export async function cancelTask(repository: string, id: string): Promise<TaskRecord | undefined> {
  const current = await readTask(repository, id);
  if (!current) return undefined;
  if (current.status === "succeeded" || current.status === "failed" || current.status === "cancelled") return current;
  const cancelled = { ...current, status: "cancelled" as const, finishedAt: new Date().toISOString(), error: "Cancelled by the operator." };
  await writeTask(cancelled);
  if (current.pid) try { process.kill(current.pid); } catch { /* worker already exited */ }
  await writeResultArtifact(cancelled, "cancelled", cancelled.exitCode, cancelled.error);
  return cancelled;
}

export async function pruneTasks(repository: string, olderThanDays = 30): Promise<number> {
  if (!Number.isFinite(olderThanDays) || olderThanDays < 0) throw new Error("Task cleanup days must be a non-negative number.");
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1_000;
  const tasks = await listTasks(repository, MAX_TASKS);
  let removed = 0;
  for (const task of tasks) {
    if (!task.finishedAt || Date.parse(task.finishedAt) >= cutoff) continue;
    await unlink(taskFile(repository, task.id)).catch(() => undefined);
    await unlink(task.logPath).catch(() => undefined);
    await unlink(task.resultPath).catch(() => undefined);
    removed += 1;
  }
  return removed;
}
