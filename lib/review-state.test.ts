import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readReviewState, reviewSuppression, updateReviewState } from "./review-state";

describe("review state", () => {
  it("persists repository pause and per-PR ignore state", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-state-"));
    expect(await reviewSuppression(root, "https://github.com/acme/app/pull/1")).toEqual({ suppressed: false });
    await updateReviewState(root, { ignorePullRequest: "https://github.com/acme/app/pull/1/" });
    expect(await reviewSuppression(root, "https://github.com/acme/app/pull/1")).toEqual({ suppressed: true, reason: "ignored" });
    await updateReviewState(root, { paused: true, reason: "release freeze" });
    expect(await reviewSuppression(root, "https://github.com/acme/app/pull/2")).toEqual({ suppressed: true, reason: "paused" });
    expect((await readReviewState(root)).reason).toBe("release freeze");
    expect(await readFile(join(root, ".mergeproof", "review-state.json"), "utf8")).toContain("\"paused\": true");
    await updateReviewState(root, { paused: false, unignorePullRequest: "https://github.com/acme/app/pull/1" });
    expect(await reviewSuppression(root, "https://github.com/acme/app/pull/1")).toEqual({ suppressed: false });
  });
});
