import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { runAutopilot, type AutopilotRun } from "./autopilot";
import type { VerificationCommand } from "./local-agent";

export type DelegationStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type DelegationOptions = { repoPath: string; request: string; verify: VerificationCommand; model?: string; provider?: string; agent?: string; maxIterations?: number; apply?: boolean };
export type DelegationRecord = {
  id: string;
  repository: string;
  request: string;
  verify: VerificationCommand;
  model?: string;
  provider?: string;
  agent?: string;
  maxIterations: number;
  apply: boolean;
  status: DelegationStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  pid?: number;
  initialHeadSha?: string;
  resultPath: string;
  logPath: string;
  proofPath: string;
  error?: string;
};

export type DelegationProof = {
  algorithm: "sha256";
  digest: string;
  delegationId: string;
  request: string;
  repository: string;
  initialHeadSha?: string;
  model: string;
  verification: VerificationCommand;
  converged: boolean;
  appliedToCheckout: boolean;
  changedPaths: string[];
  attempts: number;
  patchSha256: string;
  generatedAt: string;
};

export type DelegationResultArtifact = {
  delegationId: string;
  status: DelegationStatus;
  completedAt: string;
  run?: AutopilotRun;
  proof?: DelegationProof;
  error?: string;
};

const MAX_REQUEST_LENGTH = 12_000;
const MAX_DELEGATIONS = 100;
const MAX_LOG_BYTES = 2_000_000;

function delegationDirectory(repository: string): string {
  return join(resolve(repository), ".mergeproof", "delegations");
}

function safeId(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id)) throw new Error("Delegation IDs must contain only letters, numbers, '.', '_', or '-'.");
  return id;
}

function recordPath(repository: string, id: string): string { return join(delegationDirectory(repository), `${safeId(id)}.json`); }

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function invocation(): { command: string; args: string[] } {
  if ((process as NodeJS.Process & { pkg?: unknown }).pkg) return { command: process.execPath, args: [] };
  const tsEntry = process.argv.slice(1).find((value) => /[\\/]bin[\\/]mergeproof\.ts$/.test(value));
  if (tsEntry) return { command: process.execPath, args: [resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs"), resolve(tsEntry)] };
  return { command: process.execPath, args: [resolve(process.argv[1] ?? "")] };
}

export function createDelegationRecord(options: DelegationOptions, requestedId?: string): DelegationRecord {
  const request = options.request?.trim();
  if (!request) throw new Error("Delegation request must not be empty.");
  if (request.length > MAX_REQUEST_LENGTH) throw new Error(`Delegation request exceeds the ${MAX_REQUEST_LENGTH} character limit.`);
  const id = safeId(requestedId ?? `delegate-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`);
  const directory = delegationDirectory(options.repoPath);
  return { id, repository: resolve(options.repoPath), request, verify: options.verify, ...(options.model ? { model: options.model } : {}), ...(options.provider ? { provider: options.provider } : {}), ...(options.agent ? { agent: options.agent } : {}), maxIterations: Math.max(1, Math.min(5, Math.floor(options.maxIterations ?? 3))), apply: options.apply === true, status: "queued", createdAt: new Date().toISOString(), resultPath: join(directory, `${id}.result.json`), logPath: join(directory, `${id}.log`), proofPath: join(directory, `${id}.proof.json`) };
}

export async function writeDelegation(record: DelegationRecord): Promise<DelegationRecord> {
  await mkdir(delegationDirectory(record.repository), { recursive: true });
  await writeFile(recordPath(record.repository, record.id), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

export async function readDelegation(repository: string, id: string): Promise<DelegationRecord | undefined> {
  try {
    const value = JSON.parse(await readFile(recordPath(repository, id), "utf8")) as DelegationRecord;
    if (!value || value.id !== id || !value.repository || !value.request || !value.verify) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

export async function listDelegations(repository: string, limit = 20): Promise<DelegationRecord[]> {
  let files: string[];
  try { files = await readdir(delegationDirectory(repository)); } catch { return []; }
  const records = (await Promise.all(files.filter((file) => file.endsWith(".json") && !file.endsWith(".result.json") && !file.endsWith(".proof.json")).map((file) => readDelegation(repository, file.slice(0, -5))))).filter((record): record is DelegationRecord => Boolean(record));
  return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, Math.max(1, Math.min(MAX_DELEGATIONS, limit)));
}

function proofFor(record: DelegationRecord, run: AutopilotRun): DelegationProof {
  const patchSha256 = createHash("sha256").update(run.patch).digest("hex");
  const unsigned = { delegationId: record.id, request: record.request, repository: record.repository, ...(record.initialHeadSha ? { initialHeadSha: record.initialHeadSha } : {}), model: run.trace.model, verification: record.verify, converged: run.trace.converged, appliedToCheckout: run.trace.appliedToCheckout, changedPaths: run.trace.changedPaths, attempts: run.trace.iterations, patchSha256, generatedAt: new Date().toISOString() } satisfies Omit<DelegationProof, "algorithm" | "digest">;
  const digest = createHash("sha256").update(JSON.stringify(unsigned)).digest("hex");
  return { algorithm: "sha256", digest, ...unsigned };
}

async function writeResult(record: DelegationRecord, status: DelegationStatus, run?: AutopilotRun, error?: string): Promise<void> {
  const proof = run ? proofFor(record, run) : undefined;
  const result: DelegationResultArtifact = { delegationId: record.id, status, completedAt: new Date().toISOString(), ...(run ? { run } : {}), ...(proof ? { proof } : {}), ...(error ? { error } : {}) };
  await writeFile(record.resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  if (proof) await writeFile(record.proofPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
}

async function boundLog(path: string): Promise<void> {
  try {
    const content = await readFile(path);
    if (content.byteLength > MAX_LOG_BYTES) await writeFile(path, Buffer.concat([content.subarray(0, MAX_LOG_BYTES), Buffer.from("\n[log truncated]\n")]));
  } catch { /* The worker may fail before opening its log. */ }
}

export async function runDelegationWorker(repository: string, id: string): Promise<DelegationRecord | undefined> {
  const queued = await readDelegation(repository, id);
  if (!queued || queued.status !== "queued") return queued;
  let initialHeadSha: string;
  try {
    initialHeadSha = git(queued.repository, ["rev-parse", "HEAD"]);
  } catch (error) {
    const failed = { ...queued, status: "failed" as const, finishedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "Delegation requires a Git checkout." };
    await writeDelegation(failed);
    await writeResult(failed, failed.status, undefined, failed.error);
    return failed;
  }
  const running = { ...queued, status: "running" as const, startedAt: new Date().toISOString(), initialHeadSha, pid: process.pid };
  await writeDelegation(running);
  await appendFile(running.logPath, `${new Date().toISOString()} delegation started at ${initialHeadSha}\n`, "utf8");
  try {
    const run = await runAutopilot(running.request, running.model, { repoPath: running.repository, provider: running.provider, agent: running.agent, verify: running.verify, maxIterations: running.maxIterations, apply: running.apply });
    const latest = await readDelegation(repository, id);
    if (latest?.status === "cancelled") {
      await writeResult(latest, "cancelled", run, latest.error);
      return latest;
    }
    const finished = { ...running, status: run.trace.converged ? "succeeded" as const : "failed" as const, finishedAt: new Date().toISOString(), ...(run.trace.converged ? {} : { error: "Delegation completed without a verified converged patch." }) };
    await writeDelegation(finished);
    await appendFile(finished.logPath, `${finished.finishedAt} delegation ${finished.status}; attempts=${run.trace.iterations}; patch=${run.trace.changedPaths.join(",") || "none"}\n`, "utf8");
    await writeResult(finished, finished.status, run, finished.error);
    return finished;
  } catch (error) {
    const failed = { ...running, status: "failed" as const, finishedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "Delegation failed." };
    await writeDelegation(failed);
    await appendFile(failed.logPath, `${failed.finishedAt} delegation failed: ${failed.error}\n`, "utf8");
    await writeResult(failed, failed.status, undefined, failed.error);
    return failed;
  } finally {
    await boundLog(running.logPath);
  }
}

export async function startDelegation(options: DelegationOptions, background = true): Promise<DelegationRecord> {
  const record = await writeDelegation(createDelegationRecord(options));
  if (!background) {
    const result = await runDelegationWorker(record.repository, record.id);
    if (!result) throw new Error(`Delegation worker could not load ${record.id}.`);
    return result;
  }
  const run = invocation();
  const child = spawn(run.command, [...run.args, "__delegate-worker", record.id], { cwd: record.repository, detached: true, stdio: "ignore", windowsHide: true });
  const running = { ...record, pid: child.pid };
  await writeDelegation(running);
  child.unref();
  return running;
}

export async function cancelDelegation(repository: string, id: string): Promise<DelegationRecord | undefined> {
  const current = await readDelegation(repository, id);
  if (!current) return undefined;
  if (current.status === "succeeded" || current.status === "failed" || current.status === "cancelled") return current;
  const cancelled = { ...current, status: "cancelled" as const, finishedAt: new Date().toISOString(), error: "Cancelled by the operator." };
  await writeDelegation(cancelled);
  if (current.pid) try { process.kill(current.pid); } catch { /* worker already exited */ }
  await writeResult(cancelled, "cancelled", undefined, cancelled.error);
  return cancelled;
}

export async function readDelegationResult(repository: string, id: string): Promise<DelegationResultArtifact | undefined> {
  const record = await readDelegation(repository, id);
  if (!record) return undefined;
  try { return JSON.parse(await readFile(record.resultPath, "utf8")) as DelegationResultArtifact; } catch { return undefined; }
}
