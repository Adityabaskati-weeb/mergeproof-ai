import { describe, expect, it } from "vitest";
import { buildReviewReport, renderReviewReportCsv, renderReviewReportMarkdown } from "./report";

describe("review reports", () => {
  it("aggregates activity, calibration, and export rows", () => {
    const report = buildReviewReport([
      { id: "a", recordedAt: "2026-07-16T00:00:00.000Z", action: "analyze", target: "https://github.com/acme/app/pull/1", decision: "ready", model: "gpt-5.6", attestation: "sha" },
      { id: "b", recordedAt: "2026-07-16T00:00:00.000Z", action: "review", target: "https://github.com/acme/app/pull/1", decision: "needs-evidence", model: "gpt-5.6" },
    ], [{ id: "o", recordedAt: "2026-07-16T00:00:00.000Z", repository: "acme/app", target: "https://github.com/acme/app/pull/1", label: "merged", predictedDecision: "ready" }], { repository: "acme/app" });
    expect(report).toMatchObject({ repository: "acme/app", reviews: { total: 2, attested: 1, targets: 1 }, outcomes: { total: 1 } });
    expect(renderReviewReportMarkdown(report)).toContain("Ready calibration");
    expect(renderReviewReportCsv([], [{ id: "o", recordedAt: "2026-07-16T00:00:00.000Z", repository: "acme/app", target: "t", label: "merged" }])).toContain("outcome");
  });
});
