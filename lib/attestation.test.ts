import { describe, expect, it } from "vitest";
import { attestAnalysis, verifyAnalysisAttestation } from "./attestation";
import type { Analysis } from "./types";

const analysis: Analysis = { decision: "ready", contract: { promise: "Retry", code: "Loop", tests: "Unit", release: "None" }, rows: [{ criterion: "Retries twice", evidence: "Loop exists", state: "pass", citations: [{ path: "src/retry.ts", commitSha: "abc", url: "https://github.com/acme/payments/blob/abc/src/retry.ts#L1" }] }], securityFindings: [], trace: { fetchedSources: 1, citedSources: 1, unsupportedClaims: 0, model: "test", elapsedMs: 1, headSha: "abc" } };

describe("analysis attestation", () => {
  it("is deterministic and changes when evidence changes", () => {
    const first = attestAnalysis(analysis);
    expect(attestAnalysis(analysis)).toEqual(first);
    expect(attestAnalysis({ ...analysis, decision: "needs-evidence" }).digest).not.toBe(first.digest);
  });

  it("verifies a saved analysis attestation and detects tampering", () => {
    const signed = { ...analysis, trace: { ...analysis.trace, attestation: attestAnalysis(analysis) } };
    expect(verifyAnalysisAttestation(signed).valid).toBe(true);
    expect(verifyAnalysisAttestation({ ...signed, decision: "needs-evidence" }).valid).toBe(false);
  });
});
