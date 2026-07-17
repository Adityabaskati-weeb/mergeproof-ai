export type EvidenceState = "pass" | "warn" | "fail";
export type ReviewEffort = "low" | "medium" | "high";
export type ReviewProfile = "quiet" | "chill" | "assertive";

export type CustomCheck = {
  name: string;
  instructions: string;
};

export type EvidenceChunk = {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  commitSha: string;
  url: string;
};

export type LinkedIssue = {
  provider: "github" | "gitlab" | "jira" | "linear";
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
  category?: "security" | "privacy" | "quality";
};

export type ReviewThread = {
  id: string;
  path: string;
  line?: number;
  originalLine?: number;
  isResolved: boolean;
  isOutdated: boolean;
  comments: Array<{ author: string; body: string; url: string; createdAt?: string }>;
  url: string;
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

export type WalkthroughCitation = {
  path: string;
  commitSha: string;
  url: string;
};

export type WalkthroughLayer = {
  id: string;
  title: string;
  purpose: string;
  files: Array<{ path: string; status: string; additions: number; deletions: number; citation: WalkthroughCitation }>;
  citations: WalkthroughCitation[];
};

export type ReviewWalkthrough = {
  summary: string;
  changeStack: WalkthroughLayer[];
  sequenceDiagram: string;
  entityRelationshipDiagram: string;
  entityEvidence: Array<{ name: string; source: string; citation: WalkthroughCitation }>;
  effortScore: 1 | 2 | 3 | 4 | 5;
  effortReason: string;
  relatedIssues: Array<{ provider: string; key: string; summary: string; url: string }>;
  suggestedReviewers: string[];
  suggestedLabels: string[];
  citations: WalkthroughCitation[];
  evidenceMode: "deterministic";
};

export type Analysis = {
  decision: "ready" | "needs-evidence" | "needs-owner";
  contract: { promise: string; code: string; tests: string; release: string };
  rows: Array<{ criterion: string; evidence: string; state: EvidenceState; citations: Array<{ path: string; commitSha: string; url: string }>; stateLabel?: string }>;
  securityFindings?: SecurityFinding[];
  qualitySignals?: SecurityFinding[];
  suggestedReviewers?: string[];
  walkthrough?: ReviewWalkthrough;
  trace: {
    fetchedSources: number;
    citedSources: number;
    unsupportedClaims: number;
    model: string;
    elapsedMs: number;
    headSha?: string;
    retrieval?: { enabled: boolean; indexedChunks: number; selectedChunks: number; indexCommitSha?: string; relatedRepositories?: number };
    linkedIssues?: number;
    securityFindings?: number;
    memory?: { enabled: boolean; matchedEntries: number; stored: boolean };
    attestation?: { algorithm: "sha256"; digest: string };
    scope?: "pull-request" | "working-tree";
    workingTreeDigest?: string;
    externalSecurity?: { tools: string[]; unavailable: string[] };
    mcp?: { successful: string[]; failed: string[] };
    webSearch?: { provider?: string; resultCount: number; unavailable?: string };
    knowledge?: { enabled: boolean; matchedFacts: number };
    reviewEffort?: ReviewEffort;
    reviewProfile?: ReviewProfile;
    suggestedReviewers?: number;
    reviewPaths?: string[];
    agent?: string;
    relatedRepositories?: number;
    unresolvedReviewThreads?: number;
    reviewThreadsUnavailable?: string;
    hooks?: { enabled: boolean; before: string[]; after: string[]; failed: string[] };
    customChecks?: number;
  };
};
