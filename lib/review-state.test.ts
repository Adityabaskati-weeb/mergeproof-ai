import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkReviewAutoPause, markReviewCompleted, readReviewState, reviewSuppression, updateReviewState } from "./review-state";

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

  it("auto-pauses after the configured number of new commits and resumes explicitly", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-state-auto-"));
    try {
      await updateReviewState(root, { autoPauseAfterReviewedCommits: 2 });
      await markReviewCompleted(root, "https://github.com/acme/widget/pull/1", 3);
      expect(await checkReviewAutoPause(root, "https://github.com/acme/widget/pull/1", 4)).toEqual({ suppressed: false });
      expect(await checkReviewAutoPause(root, "https://github.com/acme/widget/pull/1", 5)).toEqual({ suppressed: true, reason: "auto-paused" });
      expect((await reviewSuppression(root, "https://github.com/acme/widget/pull/1")).reason).toBe("auto-paused");
      await updateReviewState(root, { paused: false });
      expect((await reviewSuppression(root, "https://github.com/acme/widget/pull/1")).suppressed).toBe(false);
      expect(await checkReviewAutoPause(root, "https://github.com/acme/widget/pull/1", 6)).toEqual({ suppressed: false });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
