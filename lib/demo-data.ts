import type { Analysis } from "./types";

export const demoAnalysis: Analysis = {
  decision: "needs-evidence",
  contract: { promise: "Retry failed payments twice with exponential backoff.", code: "RetryPolicy added to PaymentGateway; wired into charge().", tests: "Happy path covered. Retry path has no regression test.", release: "No schema migration. Rollback is a standard deploy." },
  rows: [
    { criterion: "Retry failed payments twice", citations: [{ path: "src/payment.ts:42", commitSha: "91f0c2a", url: "https://github.com/octo-labs/checkout-api/blob/91f0c2a/src/payment.ts#L42" }], evidence: "RetryPolicy configured with maxAttempts: 2", state: "pass", stateLabel: "SUPPORTED" },
    { criterion: "Use exponential backoff", citations: [{ path: "src/retry.ts:18", commitSha: "91f0c2a", url: "https://github.com/octo-labs/checkout-api/blob/91f0c2a/src/retry.ts#L18" }], evidence: "Backoff doubles between attempts", state: "pass", stateLabel: "SUPPORTED" },
    { criterion: "Do not duplicate a charge", citations: [], evidence: "No test found for retry + idempotency key", state: "warn", stateLabel: "NEEDS TEST" },
    { criterion: "Safe production rollout", citations: [], evidence: "No owner or rollout note linked", state: "warn", stateLabel: "OWNER NEEDED" },
  ],
  trace: { fetchedSources: 12, citedSources: 2, unsupportedClaims: 0, model: "demo", elapsedMs: 38 },
};
