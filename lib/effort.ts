import type { ReviewEffort } from "./types";

export function normalizeReviewEffort(value?: string): ReviewEffort {
  const normalized = value?.toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high") return normalized;
  return "medium";
}

export function retrievalTopKForEffort(effort: ReviewEffort): number {
  return effort === "low" ? 4 : effort === "high" ? 16 : 8;
}

export function reviewEffortGuidance(effort: ReviewEffort): string {
  if (effort === "low") return "Use a fast, targeted review. Prioritize high-confidence correctness and security risks in the changed code.";
  if (effort === "high") return "Use a deep review. Trace cross-file and cross-service behavior, inspect all relevant evidence, and abstain when the supplied context cannot prove a claim.";
  return "Use a balanced review. Check correctness, security, tests, release risk, and relevant repository context without inventing evidence.";
}
