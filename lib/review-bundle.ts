import { createHash } from "node:crypto";
import type { PullRequestContext } from "./github";
import { fetchChangeRequest, parseChangeRequestUrl } from "./change-request";
import { verifyAnalysisAttestation } from "./attestation";
import type { Analysis } from "./types";

export type SerializedPullRequestContext = Omit<PullRequestContext, "sources" | "sourceCommits"> & {
  sources: string[];
  sourceCommits?: string[];
};

export type ReviewBundle = {
  kind: "mergeproof.review-bundle";
  version: 1;
  createdAt: string;
  target: { provider: string; url: string; title: string; headSha: string; baseSha: string };
  context: SerializedPullRequestContext;
  analysis: Analysis;
  contextDigest: string;
  bundleDigest: string;
};

export type ReviewBundleVerification = {
  valid: boolean;
  bundleDigestValid: boolean;
  contextDigestValid: boolean;
  analysisAttestationValid: boolean;
  headShaValid: boolean;
  citationErrors: string[];
};

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, sortValue(entry)]));
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function digest(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function serializeContext(context: PullRequestContext): SerializedPullRequestContext {
  const { sources, sourceCommits, ...rest } = context;
  return { ...rest, sources: [...sources].sort(), ...(sourceCommits ? { sourceCommits: [...sourceCommits].sort() } : {}) };
}

function bundlePayload(bundle: Omit<ReviewBundle, "bundleDigest">): Omit<ReviewBundle, "bundleDigest"> {
  return bundle;
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value;
  }
}

export async function createReviewBundle(prUrl: string, analysis: Analysis): Promise<ReviewBundle> {
  const target = parseChangeRequestUrl(prUrl);
  const context = await fetchChangeRequest(target);
  if (analysis.trace.headSha && analysis.trace.headSha !== context.headSha) {
    throw new Error(`Analysis head SHA ${analysis.trace.headSha} does not match fetched change-request head ${context.headSha}. Re-run the analysis before bundling.`);
  }
  const serializedContext = serializeContext(context);
  const base: Omit<ReviewBundle, "bundleDigest"> = {
    kind: "mergeproof.review-bundle",
    version: 1,
    createdAt: new Date().toISOString(),
    target: { provider: target.provider, url: target.ref.url, title: context.title, headSha: context.headSha, baseSha: context.baseSha },
    context: serializedContext,
    analysis,
    contextDigest: digest(serializedContext),
  };
  return { ...base, bundleDigest: digest(bundlePayload(base)) };
}

export function verifyReviewBundle(value: unknown): ReviewBundleVerification {
  const bundle = value as Partial<ReviewBundle> | undefined;
  const empty: ReviewBundleVerification = { valid: false, bundleDigestValid: false, contextDigestValid: false, analysisAttestationValid: false, headShaValid: false, citationErrors: ["Invalid review bundle structure."] };
  if (!bundle || bundle.kind !== "mergeproof.review-bundle" || bundle.version !== 1 || !bundle.context || !bundle.analysis || !bundle.contextDigest || !bundle.bundleDigest) return empty;
  const contextDigestValid = digest(bundle.context) === bundle.contextDigest;
  const unsigned = { ...bundle };
  delete unsigned.bundleDigest;
  const bundleDigestValid = digest(bundlePayload(unsigned as Omit<ReviewBundle, "bundleDigest">)) === bundle.bundleDigest;
  const analysisAttestationValid = verifyAnalysisAttestation(bundle.analysis).valid;
  const context = bundle.context;
  const headShaValid = bundle.analysis.trace.headSha === context.headSha && bundle.target?.headSha === context.headSha;
  const allowedSources = new Set((context.sources ?? []).map(canonicalUrl));
  const allowedCommits = new Set([context.headSha, ...(context.sourceCommits ?? [])]);
  const citationErrors: string[] = [];
  for (const row of bundle.analysis.rows ?? []) {
    for (const citation of row.citations ?? []) {
      if (!allowedSources.has(canonicalUrl(citation.url))) citationErrors.push(`${row.criterion}: citation URL is not in the capsule source manifest (${citation.url})`);
      if (!allowedCommits.has(citation.commitSha)) citationErrors.push(`${row.criterion}: citation commit ${citation.commitSha} is not in the capsule commit manifest`);
    }
  }
  const valid = contextDigestValid && bundleDigestValid && analysisAttestationValid && headShaValid && citationErrors.length === 0;
  return { valid, bundleDigestValid, contextDigestValid, analysisAttestationValid, headShaValid, citationErrors };
}
