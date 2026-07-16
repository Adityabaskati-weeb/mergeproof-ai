import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";

const MEMORY_FILE = join(".mergeproof", "slack-threads.jsonl");
const MAX_BYTES = 1_000_000;
const MAX_ENTRIES = 500;

export type SlackThreadState = { key: string; prUrl: string; updatedAt: string };

function filePath(root: string): string {
  return join(resolve(root), MEMORY_FILE);
}

export async function readSlackThread(root: string, key: string): Promise<SlackThreadState | undefined> {
  try {
    const path = filePath(root);
    if ((await fs.stat(path)).size > MAX_BYTES) return undefined;
    const entries = (await fs.readFile(path, "utf8")).split(/\r?\n/).filter(Boolean).slice(-MAX_ENTRIES).flatMap((line) => {
      try {
        const value = JSON.parse(line) as SlackThreadState;
        return value.key === key && /^https:\/\//.test(value.prUrl) ? [value] : [];
      } catch {
        return [];
      }
    });
    return entries.at(-1);
  } catch {
    return undefined;
  }
}

export async function recordSlackThread(root: string, key: string, prUrl: string): Promise<void> {
  await fs.mkdir(resolve(root, ".mergeproof"), { recursive: true });
  await fs.appendFile(filePath(root), `${JSON.stringify({ key, prUrl, updatedAt: new Date().toISOString() } satisfies SlackThreadState)}\n`, "utf8");
}
