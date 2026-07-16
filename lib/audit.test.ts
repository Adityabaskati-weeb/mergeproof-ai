import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAuditEvents, recordAuditEvent } from "./audit";

describe("audit trail", () => {
  it("stores bounded metadata without source content", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-audit-"));
    await import("node:fs/promises").then(({ mkdir }) => mkdir(join(root, ".mergeproof"), { recursive: true }));
    await recordAuditEvent(root, { action: "analyze", target: "https://github.com/acme/app/pull/1", decision: "ready", model: "gpt-5.6", attestation: "abc" });
    const events = await readAuditEvents(root);
    expect(events).toHaveLength(1);
    expect(events[0].attestation).toBe("abc");
  });
});
