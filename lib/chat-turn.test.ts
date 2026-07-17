import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readSession } from "./sessions";

vi.mock("./ask", () => ({
  askRepository: vi.fn(async () => ({ answer: "The answer is grounded.", trace: { model: "test:model", headSha: "head", evidenceSources: 2, indexedChunks: 3, elapsedMs: 1, readOnly: true } })),
}));

describe("session-backed chat turns", () => {
  it("persists a machine-readable ask turn and returns its session ID", async () => {
    const { runChatTurn } = await import("./chat-turn");
    const root = await mkdtemp(join(tmpdir(), "mergeproof-chat-turn-"));
    const result = await runChatTurn("ask", "How does auth work?", { repoPath: root, sessionId: "desktop" });
    expect(result.sessionId).toBe("desktop");
    expect((result.output as { answer: string }).answer).toBe("The answer is grounded.");
    expect((await readSession(root, "desktop"))?.turns[0].outcome).toBe("success");
  });
});

