import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendSessionTurn, openSession } from "./sessions";
import { renderSearchResults, searchWorkspace } from "./search";

describe("local timeline search", () => {
  it("searches bounded session history without a model or network", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-search-"));
    try {
      const session = await openSession(root, "auth-review");
      await appendSessionTurn(root, session.id, { action: "ask", request: "How does webhook authentication work?", outcome: "success", summary: "It verifies the HMAC signature." });
      const hits = await searchWorkspace(root, "HMAC");
      expect(hits).toHaveLength(1);
      expect(renderSearchResults("HMAC", hits)).toContain("auth-review");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
