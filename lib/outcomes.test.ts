import { describe, expect, it } from "vitest";
import { summarizeOutcomes, type ReviewOutcome } from "./outcomes";

describe("review outcome calibration", () => {
  it("computes ready-decision calibration from explicit outcomes", () => {
    const base = { id: "x", recordedAt: "2026-01-01", repository: "acme/widget", target: "https://github.com/acme/widget/pull/1" };
    const outcomes: ReviewOutcome[] = [
      { ...base, id: "1", label: "merged", predictedDecision: "ready" },
      { ...base, id: "2", label: "closed-unmerged", predictedDecision: "ready" },
      { ...base, id: "3", label: "accepted", predictedDecision: "needs-evidence" },
    ];
    expect(summarizeOutcomes(outcomes)).toMatchObject({ total: 3, labels: { merged: 1, "closed-unmerged": 1, accepted: 1 }, readyCalibration: { merged: 1, notMerged: 1, total: 2, rate: 0.5 } });
  });
});
