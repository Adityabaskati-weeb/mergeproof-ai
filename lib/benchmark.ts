import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { verifyAnalysisAttestation } from "./attestation";
import { readOutcomes, summarizeOutcomes, type OutcomeSummary } from "./outcomes";
import type { Analysis } from "./types";

export type BenchmarkSummary = {
  inputs: string[];
  total: number;
  validAttestations: number;
  invalidAttestations: number;
  decisions: Record<string, number>;
  models: Record<string, number>;
  totalCriteria: number;
  citedCriteria: number;
  citationCoverage: number;
  unsupportedClaims: number;
  securityFindings: number;
  averageElapsedMs: number;
  outcomes: OutcomeSummary;
  recommendations: string[];
};

type Candidate = { path: string; analysis: Analysis };
const MAX_FILES = 500;

function isAnalysis(value: unknown): value is Analysis {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Analysis>;
  return (candidate.decision === "ready" || candidate.decision === "needs-evidence" || candidate.decision === "needs-owner") && Array.isArray(candidate.rows) && Boolean(candidate.trace && typeof candidate.trace === "object");
}

function extractAnalysis(value: unknown): Analysis | undefined {
  if (isAnalysis(value)) return value;
  if (value && typeof value === "object" && isAnalysis((value as { analysis?: unknown }).analysis)) return (value as { analysis: Analysis }).analysis;
  return undefined;
}

async function collectJsonFiles(path: string, output: string[], depth = 0): Promise<void> {
  if (output.length >= MAX_FILES || depth > 4) return;
  try {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      if (output.length >= MAX_FILES) break;
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") continue;
      const child = join(path, entry.name);
      if (entry.isDirectory()) await collectJsonFiles(child, output, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) output.push(child);
    }
  } catch {
    // Inputs can be removed or unreadable; the benchmark remains bounded and skips them.
  }
}

async function resolveInputs(inputs: string[], root: string): Promise<string[]> {
  const resolved: string[] = [];
  for (const input of inputs.length ? inputs : [join(root, ".mergeproof", "benchmarks")]) {
    const path = resolve(root, input);
    try {
      const entries = await readdir(path, { withFileTypes: true });
      if (entries) await collectJsonFiles(path, resolved);
    } catch {
      if (path.toLowerCase().endsWith(".json")) resolved.push(path);
    }
  }
  return [...new Set(resolved)].slice(0, MAX_FILES);
}

export async function benchmarkReviews(root: string, inputs: string[] = []): Promise<BenchmarkSummary> {
  const repository = resolve(root);
  const paths = await resolveInputs(inputs, repository);
  const candidates: Candidate[] = [];
  for (const path of paths) {
    try {
      const analysis = extractAnalysis(JSON.parse(await readFile(path, "utf8")) as unknown);
      if (analysis) candidates.push({ path, analysis });
    } catch {
      // Non-analysis JSON files in a benchmark directory are ignored.
    }
  }
  const decisions: Record<string, number> = {};
  const models: Record<string, number> = {};
  let validAttestations = 0;
  let totalCriteria = 0;
  let citedCriteria = 0;
  let unsupportedClaims = 0;
  let securityFindings = 0;
  let elapsed = 0;
  for (const candidate of candidates) {
    const { analysis } = candidate;
    decisions[analysis.decision] = (decisions[analysis.decision] ?? 0) + 1;
    models[analysis.trace.model] = (models[analysis.trace.model] ?? 0) + 1;
    if (verifyAnalysisAttestation(analysis).valid) validAttestations += 1;
    totalCriteria += analysis.rows.length;
    citedCriteria += analysis.rows.filter((row) => row.citations.length > 0).length;
    unsupportedClaims += analysis.trace.unsupportedClaims;
    securityFindings += (analysis.securityFindings?.length ?? 0) + (analysis.qualitySignals?.length ?? 0);
    elapsed += analysis.trace.elapsedMs;
  }
  const outcomes = summarizeOutcomes(await readOutcomes(repository));
  const citationCoverage = totalCriteria ? Number((citedCriteria / totalCriteria).toFixed(4)) : 0;
  const recommendations: string[] = [];
  if (!candidates.length) recommendations.push("Save analyses with --save or place JSON analyses/bundles under .mergeproof/benchmarks before benchmarking.");
  if (candidates.length && validAttestations < candidates.length) recommendations.push("Investigate invalid or missing attestations before using this history as a quality baseline.");
  if (unsupportedClaims > 0) recommendations.push("Reduce unsupported claims or tighten repository instructions before treating ready decisions as production-safe.");
  if (totalCriteria && citationCoverage < 0.95) recommendations.push("Increase criterion citation coverage toward 95% or higher.");
  if (outcomes.readyCalibration && outcomes.readyCalibration.rate < 0.9) recommendations.push("Review false-ready outcomes and adjust checks, retrieval, or human ownership gates.");
  return { inputs: candidates.map((candidate) => candidate.path), total: candidates.length, validAttestations, invalidAttestations: candidates.length - validAttestations, decisions, models, totalCriteria, citedCriteria, citationCoverage, unsupportedClaims, securityFindings, averageElapsedMs: candidates.length ? Math.round(elapsed / candidates.length) : 0, outcomes, recommendations };
}

export function renderBenchmarkMarkdown(summary: BenchmarkSummary): string {
  const decisions = Object.entries(summary.decisions).map(([key, value]) => `- ${key}: ${value}`).join("\n") || "- none";
  const models = Object.entries(summary.models).map(([key, value]) => `- ${key}: ${value}`).join("\n") || "- none";
  return [
    "# MergeProof review benchmark",
    "",
    `Analyses: ${summary.total}`,
    `Attestations: ${summary.validAttestations} valid, ${summary.invalidAttestations} invalid or missing`,
    `Criterion citation coverage: ${(summary.citationCoverage * 100).toFixed(1)}% (${summary.citedCriteria}/${summary.totalCriteria})`,
    `Unsupported claims: ${summary.unsupportedClaims}`,
    `Security and quality findings: ${summary.securityFindings}`,
    `Average elapsed time: ${summary.averageElapsedMs}ms`,
    "",
    "## Decisions",
    decisions,
    "",
    "## Models",
    models,
    "",
    "## Outcome calibration",
    summary.outcomes.readyCalibration ? `Ready calibration: ${(summary.outcomes.readyCalibration.rate * 100).toFixed(1)}% (${summary.outcomes.readyCalibration.merged}/${summary.outcomes.readyCalibration.total})` : "Not enough judged outcomes.",
    "",
    "## Recommendations",
    summary.recommendations.map((recommendation) => `- ${recommendation}`).join("\n") || "- No immediate recommendations.",
    "",
  ].join("\n");
}
