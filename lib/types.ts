export type EvidenceState = "pass" | "warn" | "fail";

export type Analysis = {
  decision: "ready" | "needs-evidence" | "needs-owner";
  contract: { promise: string; code: string; tests: string; release: string };
  rows: Array<{ criterion: string; source: string; evidence: string; state: EvidenceState; stateLabel: string }>;
};
