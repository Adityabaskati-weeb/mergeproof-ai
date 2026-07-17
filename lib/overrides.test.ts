import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { Analysis } from "./types";
import { applyPreMergeOverrides, readPreMergeOverrides, recordPreMergeOverride } from "./overrides";

const analysis: Analysis = {
  decision: "needs-evidence",
  contract: { promise: "change", code: "code", tests: "tests", release: "release" },
  rows: [{ criterion: "API compatibility", evidence: "No compatibility artifact was attached.", state: "warn", citations: [] }],
  trace: { fetchedSources: 1, citedSources: 0, unsupportedClaims: 0, model: "test:model", elapsedMs: 1, headSha: "head", blockingFailures: 1, customCheckWarnings: 0 },
};

describe("pre-merge overrides", () => {
  it("is scoped to the exact target and head and keeps the latest check record", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-overrides-"));
    await recordPreMergeOverride(root, { target: "https://github.com/acme/app/pull/1/", headSha: "head", check: "API compatibility", by: "reviewer", reason: "Migration evidence will land in the follow-up PR." });
    await recordPreMergeOverride(root, { target: "https://github.com/acme/app/pull/1", headSha: "head", check: "API compatibility", by: "owner", reason: "Owner accepted the temporary exception." });
    expect((await readPreMergeOverrides(root, "https://github.com/acme/app/pull/1", "head"))[0]).toMatchObject({ by: "owner" });
    expect(await readPreMergeOverrides(root, "https://github.com/acme/app/pull/1", "new-head")).toEqual([]);
  });

  it("can only turn a configured custom check exception into ready", () => {
    const override = { id: "override-1", target: "https://github.com/acme/app/pull/1", headSha: "head", check: "API compatibility", by: "owner", reason: "accepted", recordedAt: new Date().toISOString() };
    const applied = applyPreMergeOverrides(analysis, [override], ["API compatibility"]);
    expect(applied.decision).toBe("ready");
    expect(applied.trace.overrides).toEqual(["API compatibility"]);
    expect(applyPreMergeOverrides(analysis, [override], ["Different check"]).decision).toBe("needs-evidence");
  });
});
