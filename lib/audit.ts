import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type AuditEvent = {
  id: string;
  recordedAt: string;
  action: "analyze" | "review" | "consensus" | "plan" | "fix" | "simplify" | "tests" | "autofix";
  target: string;
  decision?: string;
  model?: string;
  headSha?: string;
  attestation?: string;
};

const MAX_EVENTS = 500;

function auditPath(root: string): string {
  return join(resolve(root), ".mergeproof", "audit.jsonl");
}

export async function recordAuditEvent(root: string, event: Omit<AuditEvent, "id" | "recordedAt">): Promise<AuditEvent> {
  await mkdir(resolve(root, ".mergeproof"), { recursive: true });
  const value: AuditEvent = { ...event, id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, recordedAt: new Date().toISOString() };
  await appendFile(auditPath(root), `${JSON.stringify(value)}\n`, "utf8");
  return value;
}

export async function readAuditEvents(root: string, limit = 50): Promise<AuditEvent[]> {
  try {
    const lines = (await readFile(auditPath(root), "utf8")).split(/\r?\n/).filter(Boolean).slice(-MAX_EVENTS);
    return lines.flatMap((line) => {
      try {
        const value = JSON.parse(line) as AuditEvent;
        return typeof value.id === "string" && typeof value.action === "string" && typeof value.target === "string" ? [value] : [];
      } catch { return []; }
    }).slice(-Math.max(1, Math.min(limit, MAX_EVENTS))).reverse();
  } catch {
    return [];
  }
}
