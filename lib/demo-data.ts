import type { Analysis } from "./types";

export const demoAnalysis: Analysis = {
  decision: "needs-evidence",
  contract: { promise: "Retry failed payments twice with exponential backoff.", code: "RetryPolicy added to PaymentGateway; wired into charge().", tests: "Happy path covered. Retry path has no regression test.", release: "No schema migration. Rollback is a standard deploy." },
  rows: [
    { criterion: "Retry failed payments twice", source: "src/payment.ts:42", evidence: "RetryPolicy configured with maxAttempts: 2", state: "pass", stateLabel: "SUPPORTED" },
    { criterion: "Use exponential backoff", source: "src/retry.ts:18", evidence: "Backoff doubles between attempts", state: "pass", stateLabel: "SUPPORTED" },
    { criterion: "Do not duplicate a charge", source: "tests/payment.test.ts", evidence: "No test found for retry + idempotency key", state: "warn", stateLabel: "NEEDS TEST" },
    { criterion: "Safe production rollout", source: "Jira PAY-482", evidence: "No owner or rollout note linked", state: "warn", stateLabel: "OWNER NEEDED" },
  ],
};
