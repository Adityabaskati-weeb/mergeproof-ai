export type EvidenceState = "pass" | "warn" | "fail";

export type EvidenceChunk = {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  commitSha: string;
  url: string;
};

export type LinkedIssue = {
  provider: "jira";
  key: string;
  url: string;
  summary: string;
  description: string;
  status: string;
  acceptanceCriteria: string[];
};

export type Analysis = {
  decision: "ready" | "needs-evidence" | "needs-owner";
  contract: { promise: string; code: string; tests: string; release: string };
  rows: Array<{ criterion: string; evidence: string; state: EvidenceState; citations: Array<{ path: string; commitSha: string; url: string }>; stateLabel?: string }>;
  trace: {
    fetchedSources: number;
    citedSources: number;
    unsupportedClaims: number;
    model: string;
    elapsedMs: number;
    headSha?: string;
    retrieval?: { enabled: boolean; indexedChunks: number; selectedChunks: number; indexCommitSha?: string };
    linkedIssues?: number;
  };
};
