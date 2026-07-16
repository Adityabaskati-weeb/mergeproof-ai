import { describe, expect, it } from "vitest";
import { normalizeReviewEffort, retrievalTopKForEffort, reviewEffortGuidance } from "./effort";

describe("review effort", () => {
  it("normalizes supported levels and uses bounded retrieval budgets", () => {
    expect(normalizeReviewEffort("low")).toBe("low");
    expect(normalizeReviewEffort("HIGH")).toBe("high");
    expect(normalizeReviewEffort("unknown")).toBe("medium");
    expect(retrievalTopKForEffort("low")).toBe(4);
    expect(retrievalTopKForEffort("medium")).toBe(8);
    expect(retrievalTopKForEffort("high")).toBe(16);
    expect(reviewEffortGuidance("high")).toContain("deep review");
  });
});
