import { createHash } from "node:crypto";
import type { Analysis } from "./types";

export type AnalysisAttestation = { algorithm: "sha256"; digest: string };

export function attestAnalysis(analysis: Analysis): AnalysisAttestation {
  const payload = JSON.stringify({
    decision: analysis.decision,
    contract: analysis.contract,
    rows: analysis.rows,
    securityFindings: analysis.securityFindings ?? [],
    headSha: analysis.trace.headSha ?? "unknown",
    scope: analysis.trace.scope ?? "pull-request",
    workingTreeDigest: analysis.trace.workingTreeDigest ?? null,
    externalSecurity: analysis.trace.externalSecurity ?? null,
    mcp: analysis.trace.mcp ?? null,
  });
  return { algorithm: "sha256", digest: createHash("sha256").update(payload).digest("hex") };
}
