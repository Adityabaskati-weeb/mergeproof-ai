import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const MAX_RECORDS = 50;
const MAX_PROMPT_BYTES = 100_000;

export type PromptRecord = {
  id: string;
  recordedAt: string;
  action: "analyze" | "review";
  model: string;
  system: string;
  user: string;
  digest: string;
  bytes: number;
};

function promptPath(root: string): string { return join(resolve(root), ".mergeproof", "prompts.jsonl"); }

function bounded(value: string): string { return value.slice(0, MAX_PROMPT_BYTES); }

export async function recordPrompt(root: string, input: { action: PromptRecord["action"]; model: string; system: string; user: string }): Promise<PromptRecord> {
  const system = bounded(input.system);
  const user = bounded(input.user);
  const digest = createHash("sha256").update(`${system}\0${user}`).digest("hex");
  const record: PromptRecord = { id: `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, recordedAt: new Date().toISOString(), action: input.action, model: input.model.slice(0, 200), system, user, digest, bytes: Buffer.byteLength(`${system}\0${user}`, "utf8") };
  const path = promptPath(root);
  await mkdir(join(resolve(root), ".mergeproof"), { recursive: true });
  let records: PromptRecord[] = [];
  try { records = (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean).slice(-MAX_RECORDS).flatMap((line) => { try { return [JSON.parse(line) as PromptRecord]; } catch { return []; } }); } catch { /* first prompt record */ }
  records.push(record);
  await writeFile(path, `${records.slice(-MAX_RECORDS).map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
  return record;
}

export async function readPrompts(root: string, limit = 20): Promise<PromptRecord[]> {
  try {
    return (await readFile(promptPath(root), "utf8")).split(/\r?\n/).filter(Boolean).slice(-MAX_RECORDS).flatMap((line) => { try { return [JSON.parse(line) as PromptRecord]; } catch { return []; } }).slice(-Math.max(1, Math.min(MAX_RECORDS, limit))).reverse();
  } catch { return []; }
}

export function renderPromptRecord(record: PromptRecord): string {
  return [`## ${record.action} / ${record.model}`, `Recorded: ${record.recordedAt}`, `Digest: sha256:${record.digest}`, `Bytes: ${record.bytes}`, "", "### System", record.system, "", "### User", record.user].join("\n");
}
