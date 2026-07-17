import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendSessionTurn, listSessions, openSession, readSession } from "./sessions";

describe("persistent chat sessions", () => {
  it("creates, appends, resumes, and lists an inspectable JSONL session", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-session-"));
    const created = await openSession(root, "demo");
    await appendSessionTurn(root, created.id, { action: "ask", request: "How does auth work?", outcome: "success", summary: "It uses a token.", trace: { model: "test" } });
    const resumed = await openSession(root, created.id);
    expect(resumed.turns).toHaveLength(1);
    expect((await readSession(root, created.id))?.turns[0].trace).toEqual({ model: "test" });
    expect((await listSessions(root))[0].id).toBe("demo");
    expect((await readFile(join(root, ".mergeproof", "sessions", "demo.jsonl"), "utf8")).split(/\r?\n/).filter(Boolean)).toHaveLength(2);
  });
});

