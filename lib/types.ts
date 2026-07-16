export type EvidenceState = "pass" | "warn" | "fail";

export type Analysis = {
  decision: "ready" | "needs-evidence" | "needs-owner";
  contract: { promise: string; code: string; tests: string; release: string };
  rows: Array<{ criterion: string; evidence: string; state: EvidenceState; citations: Array<{ path: string; commitSha: string; url: string }>; stateLabel?: string }>;
  trace: { fetchedSources: number; citedSources: number; unsupportedClaims: number; model: string; elapsedMs: number };
};
