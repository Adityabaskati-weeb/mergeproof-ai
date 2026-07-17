import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./implementation-agent", () => ({ runImplementationAgent: vi.fn() }));
import { runImplementationAgent } from "./implementation-agent";
import { runAutopilot } from "./autopilot";

const mockedImplementation = vi.mocked(runImplementationAgent);

function git(root: string, args: string[]): void { execFileSync("git", args, { cwd: root, stdio: "ignore" }); }

describe("bounded autopilot", () => {
  beforeEach(() => mockedImplementation.mockReset());

  it("applies only a converged, verified, re-reviewed patch", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-autopilot-"));
    await writeFile(join(root, "note.txt"), "before\n", "utf8");
    git(root, ["init"]);
    git(root, ["config", "user.email", "test@example.com"]);
    git(root, ["config", "user.name", "MergeProof Test"]);
    git(root, ["add", "note.txt"]);
    git(root, ["commit", "-m", "initial"]);
    mockedImplementation.mockResolvedValue({ summary: "Verified change", patch: "--- a/note.txt\n+++ b/note.txt\n@@ -1 +1 @@\n-before\n+after\n", trace: { model: "test:model", request: "update the note", headSha: "test-head", changedPaths: ["note.txt"], evidenceSources: 1, indexedChunks: 0, sandboxed: true, appliedToSandbox: true, appliedToCheckout: false, verified: true, reReviewDecision: "ready", reReviewPassed: true, reReviewUnsupportedClaims: 0 } });
    const result = await runAutopilot("update the note", "test-model", { repoPath: root, verify: "npm run build", maxIterations: 3, apply: true });
    expect(result.trace.converged).toBe(true);
    expect(result.trace.appliedToCheckout).toBe(true);
    expect((await readFile(join(root, "note.txt"), "utf8")).replace(/\r\n/g, "\n")).toBe("after\n");
    expect(mockedImplementation).toHaveBeenCalledTimes(1);
  });
});
