import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendSessionTurn, cleanupSessions, compactSession, deleteAllSessions, deleteSession, forkSession, listSessions, openSession, pruneSessions, readSession, renameSession, renderSessionHtml, renderSessionMarkdown, sessionCheckpoints, sessionFiles } from "./sessions";

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

  it("forks and deletes sessions without changing the source transcript", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-session-lifecycle-"));
    const source = await openSession(root, "source");
    await appendSessionTurn(root, source.id, { action: "plan", request: "Plan the change", outcome: "success", summary: "A bounded plan." });
    const fork = await forkSession(root, source.id, "forked");
    expect(fork.id).toBe("forked");
    expect(fork.turns).toHaveLength(1);
    expect(fork.turns[0].sessionId).toBe("forked");
    expect(renderSessionMarkdown(fork)).toContain("# MergeProof session forked");
    const renamed = await renameSession(root, fork.id, "Release review");
    expect(renamed.name).toBe("Release review");
    expect(renderSessionMarkdown(renamed)).toContain("Release review");
    expect(await sessionFiles(root, renamed.id)).toHaveLength(1);
    expect(await deleteSession(root, source.id)).toBe(true);
    expect(await readSession(root, source.id)).toBeUndefined();
    expect(await deleteAllSessions(root)).toBe(1);
    expect(await listSessions(root)).toHaveLength(0);
  });

  it("renders a self-contained escaped HTML share export", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-session-html-"));
    try {
      const session = await openSession(root, "shareable");
      await appendSessionTurn(root, session.id, { action: "ask", request: "<script>alert(1)</script>", outcome: "success", summary: "Evidence-backed answer" });
      const html = renderSessionHtml((await readSession(root, session.id))!);
      expect(html).toContain("<!doctype html>");
      expect(html).toContain("Evidence-backed answer");
      expect(html).not.toContain("<script>alert(1)");
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prunes by recency and cleans up old sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-session-cleanup-"));
    const first = await openSession(root, "first");
    await openSession(root, "second");
    expect(await pruneSessions(root, 1)).toBe(1);
    expect((await listSessions(root)).length).toBe(1);
    expect((await readSession(root, first.id)) === undefined || (await readSession(root, "second")) === undefined).toBe(true);
    expect(await cleanupSessions(root, 0)).toBe(1);
  });

  it("compacts old turns into an inspectable archive and checkpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-session-compaction-"));
    try {
      const session = await openSession(root, "long-lived");
      for (const request of ["one", "two", "three"]) await appendSessionTurn(root, session.id, { action: "ask", request, outcome: "success", summary: `Answer ${request}` });
      const compacted = await compactSession(root, session.id, 1);
      expect(compacted.turns).toHaveLength(1);
      expect(compacted.checkpoints).toHaveLength(1);
      expect(compacted.checkpoints[0].archivedTurns).toBe(2);
      expect(await sessionCheckpoints(root, session.id)).toHaveLength(1);
      expect(await sessionFiles(root, session.id)).toHaveLength(2);
      expect(renderSessionMarkdown(compacted)).toContain("## Checkpoints");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
