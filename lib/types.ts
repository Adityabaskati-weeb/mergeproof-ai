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
  provider: "jira" | "linear";
  key: string;
  url: string;
  summary: string;
  description: string;
  status: string;
  acceptanceCriteria: string[];
};

export type SecurityFinding = {
  id: string;
  title: string;
  severity: "low" | "medium" | "high";
  path: string;
  line: number;
  detail: string;
  citation: { path: string; commitSha: string; url: string };
};

export type ReviewMemoryEntry = {
  repository: string;
  prUrl: string;
  headSha: string;
  title: string;
  decision: Analysis["decision"];
  criteria: string[];
  findings: Array<{ criterion: string; state: EvidenceState; evidence: string }>;
  securityFindings?: SecurityFinding[];
  model: string;
  recordedAt: string;
};

export type Analysis = {
  decision: "ready" | "needs-evidence" | "needs-owner";
  contract: { promise: string; code: string; tests: string; release: string };
  rows: Array<{ criterion: string; evidence: string; state: EvidenceState; citations: Array<{ path: string; commitSha: string; url: string }>; stateLabel?: string }>;
  securityFindings?: SecurityFinding[];
  trace: {
    fetchedSources: number;
    citedSources: number;
    unsupportedClaims: number;
    model: string;
    elapsedMs: number;
    headSha?: string;
    retrieval?: { enabled: boolean; indexedChunks: number; selectedChunks: number; indexCommitSha?: string };
    linkedIssues?: number;
    securityFindings?: number;
    memory?: { enabled: boolean; matchedEntries: number; stored: boolean };
    attestation?: { algorithm: "sha256"; digest: string };
    scope?: "pull-request" | "working-tree";
    workingTreeDigest?: string;
    externalSecurity?: { tools: string[]; unavailable: string[] };
    mcp?: { successful: string[]; failed: string[] };
  };
};
