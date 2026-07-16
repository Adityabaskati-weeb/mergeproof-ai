import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readRepositoryMemory, recordReviewMemory } from "./memory";
import type { Analysis } from "./types";

describe("review memory", () => {
  it("records and retrieves repository-scoped decisions", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "mergeproof-memory-"));
    const analysis: Analysis = { decision: "needs-evidence", contract: { promise: "", code: "", tests: "", release: "" }, rows: [{ criterion: "Retries twice", evidence: "Missing test", state: "warn", citations: [] }], securityFindings: [], trace: { fetchedSources: 1, citedSources: 0, unsupportedClaims: 0, model: "test", elapsedMs: 1, headSha: "abc123" } };
    await recordReviewMemory(root, { owner: "acme", repo: "payments", number: 1, url: "https://github.com/acme/payments/pull/1" }, "https://github.com/acme/payments/pull/1", "Retry policy", ["Retries twice"], analysis);
    const entries = await readRepositoryMemory(root, "acme/payments", "retry");
    expect(entries).toHaveLength(1);
    expect(entries[0].decision).toBe("needs-evidence");
    await fs.rm(root, { recursive: true, force: true });
  });
});
