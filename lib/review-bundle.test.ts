import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { attestAnalysis } from "./attestation";
import { verifyReviewBundle, type ReviewBundle } from "./review-bundle";
import type { Analysis } from "./types";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, stable(entry)]));
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function analysis(): Analysis {
  const value: Analysis = {
    decision: "ready",
    contract: { promise: "Retry requests", code: "Retry loop", tests: "Unit coverage", release: "No migration" },
    rows: [{ criterion: "Retry requests", evidence: "The retry loop is present.", state: "pass", citations: [{ path: "src/retry.ts", commitSha: "head", url: "https://github.com/acme/app/blob/head/src/retry.ts" }] }],
    trace: { fetchedSources: 2, citedSources: 1, unsupportedClaims: 0, model: "test:model", elapsedMs: 1, headSha: "head" },
  };
  return { ...value, trace: { ...value.trace, attestation: attestAnalysis(value) } };
}

function bundle(): ReviewBundle {
  const context = { ref: { owner: "acme", repo: "app", number: 1, url: "https://github.com/acme/app/pull/1" }, title: "Retry", body: "## Acceptance Criteria\n- Retry requests", headSha: "head", baseSha: "base", files: [{ path: "src/retry.ts", patch: "+retry", status: "modified", additions: 1, deletions: 0, url: "https://github.com/acme/app/blob/head/src/retry.ts" }], checks: [], sources: ["https://github.com/acme/app/pull/1", "https://github.com/acme/app/blob/head/src/retry.ts"], repositoryEvidence: [], issues: [] };
  const base = { kind: "mergeproof.review-bundle" as const, version: 1 as const, createdAt: "2026-01-01T00:00:00.000Z", target: { provider: "github", url: context.ref.url, title: context.title, headSha: context.headSha, baseSha: context.baseSha }, context, analysis: analysis(), contextDigest: digest(context) };
  return { ...base, bundleDigest: digest(base) };
}

describe("review bundles", () => {
  it("verifies an untampered offline evidence capsule", () => {
    const result = verifyReviewBundle(bundle());
    expect(result.valid).toBe(true);
    expect(result.citationErrors).toEqual([]);
  });

  it("detects tampered analysis and citations outside the manifest", () => {
    const value = bundle();
    value.analysis.rows[0].citations[0].url = "https://evil.example/claim";
    const result = verifyReviewBundle(value);
    expect(result.valid).toBe(false);
    expect(result.bundleDigestValid).toBe(false);
    expect(result.citationErrors[0]).toContain("not in the capsule source manifest");
  });
});
