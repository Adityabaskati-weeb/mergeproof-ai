import type { ReviewProfile } from "./types";

export function normalizeReviewProfile(value?: string): ReviewProfile {
  const normalized = value?.toLowerCase();
  if (normalized === "quiet" || normalized === "chill" || normalized === "assertive") return normalized;
  return "chill";
}

export function reviewProfileGuidance(profile: ReviewProfile): string {
  if (profile === "quiet") return "Keep reviewer-facing findings focused: prioritize high-impact correctness, security, privacy, and release risks. Do not invent findings just to increase coverage.";
  if (profile === "assertive") return "Review comprehensively, including maintainability, test gaps, edge cases, and low-confidence risks, while still citing every claim.";
  return "Use a balanced review: report material correctness, security, privacy, test, release, and maintainability risks without nitpicking.";
}

export function shouldPublishFinding(profile: ReviewProfile, severity: "low" | "medium" | "high", category?: "security" | "privacy" | "quality"): boolean {
  if (profile === "assertive") return true;
  if (profile === "quiet") return severity !== "low" || category === "security" || category === "privacy";
  return severity !== "low" || category === "security" || category === "privacy";
}
