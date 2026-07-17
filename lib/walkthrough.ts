import type { PullRequestContext } from "./github";
import type { Analysis, ReviewWalkthrough, WalkthroughCitation, WalkthroughLayer } from "./types";

type LayerDefinition = { id: string; title: string; purpose: string; patterns: RegExp[] };

const LAYER_DEFINITIONS: LayerDefinition[] = [
  { id: "contract", title: "Contract", purpose: "Public interfaces, schemas, types, migrations, and API definitions.", patterns: [/(?:schema|type|interface|openapi|swagger|proto|migration|model)/i] },
  { id: "delivery", title: "Delivery", purpose: "Build, deployment, infrastructure, and runtime configuration changes.", patterns: [/(?:\.github|workflow|docker|compose|terraform|k8s|helm|\.ya?ml$|\.json$|\.env)/i] },
  { id: "tests", title: "Verification", purpose: "Automated tests, fixtures, snapshots, and test-only validation.", patterns: [/(?:test|spec|fixture|snapshot|__tests__)/i] },
  { id: "docs", title: "Documentation", purpose: "Documentation and user-facing explanation changes.", patterns: [/(?:readme|docs?|changelog|\.md$|\.mdx$)/i] },
  { id: "integration", title: "Integration", purpose: "Routes, handlers, clients, adapters, services, and external boundaries.", patterns: [/(?:route|controller|handler|endpoint|api|client|adapter|integration|service|webhook)/i] },
  { id: "implementation", title: "Implementation", purpose: "Core application logic and behavior changed by the request.", patterns: [/.*/] },
];

const LAYER_ORDER = ["contract", "integration", "implementation", "delivery", "tests", "docs"];

function definitionFor(path: string): LayerDefinition {
  const definition = LAYER_DEFINITIONS.find((candidate) => candidate.id !== "implementation" && candidate.patterns.some((pattern) => pattern.test(path)));
  return definition ?? LAYER_DEFINITIONS.find((candidate) => candidate.id === "implementation")!;
}

function citationFor(file: PullRequestContext["files"][number], headSha: string): WalkthroughCitation {
  return { path: file.path, commitSha: headSha, url: file.url };
}

function uniqueCitations(citations: WalkthroughCitation[]): WalkthroughCitation[] {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = `${citation.path}\0${citation.commitSha}\0${citation.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scoreEffort(context: PullRequestContext): { score: ReviewWalkthrough["effortScore"]; reason: string } {
  const files = context.files.length;
  const lines = context.files.reduce((total, file) => total + file.additions + file.deletions, 0);
  const failedChecks = context.checks.filter((check) => check.conclusion && !["success", "neutral", "skipped"].includes(check.conclusion.toLowerCase())).length;
  const securitySignals = context.securityFindings?.filter((finding) => finding.severity !== "low").length ?? 0;
  let score = 1;
  if (files > 3 || lines > 120) score++;
  if (files > 10 || lines > 500) score++;
  if (failedChecks > 0 || securitySignals > 0) score++;
  if (files > 25 || lines > 1200) score++;
  const bounded = Math.min(5, score) as ReviewWalkthrough["effortScore"];
  const reasons = [`${files} changed file${files === 1 ? "" : "s"}`, `${lines} changed line${lines === 1 ? "" : "s"}`];
  if (failedChecks) reasons.push(`${failedChecks} non-passing check${failedChecks === 1 ? "" : "s"}`);
  if (securitySignals) reasons.push(`${securitySignals} elevated security signal${securitySignals === 1 ? "" : "s"}`);
  return { score: bounded, reason: `Evidence-derived estimate from ${reasons.join(", ")}.` };
}

function safeMermaid(value: string): string {
  return value.replace(/[^a-zA-Z0-9 _./-]/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "Change";
}

function buildSequenceDiagram(layers: WalkthroughLayer[]): string {
  const participants = layers.map((layer) => `  participant ${layer.id} as ${safeMermaid(layer.title)}`).join("\n");
  const notes = layers.map((layer) => `  Note over ${layer.id}: ${safeMermaid(`${layer.files.length} file${layer.files.length === 1 ? "" : "s"} - ${layer.files.slice(0, 2).map((file) => file.path).join(", ")}`)}`).join("\n");
  const edges = layers.slice(0, -1).map((layer, index) => `  ${layer.id}->>${layers[index + 1].id}: evidence flows to next layer`).join("\n");
  return ["sequenceDiagram", "  autonumber", "  Note over " + layers[0]?.id + ": Evidence-derived change flow; not a runtime execution trace", participants, notes, edges].filter(Boolean).join("\n");
}

export function buildWalkthrough(context: PullRequestContext, analysis?: Pick<Analysis, "contract" | "decision">): ReviewWalkthrough {
  const grouped = new Map<string, { definition: LayerDefinition; files: WalkthroughLayer["files"] }>();
  for (const file of context.files) {
    const definition = definitionFor(file.path);
    const group = grouped.get(definition.id) ?? { definition, files: [] };
    group.files.push({ path: file.path, status: file.status, additions: file.additions, deletions: file.deletions, citation: citationFor(file, context.headSha) });
    grouped.set(definition.id, group);
  }
  const layers = LAYER_ORDER.map((id) => grouped.get(id)).filter((group): group is { definition: LayerDefinition; files: WalkthroughLayer["files"] } => Boolean(group)).map((group) => ({ id: group.definition.id, title: group.definition.title, purpose: group.definition.purpose, files: group.files, citations: uniqueCitations(group.files.map((file) => file.citation)) }));
  const effort = scoreEffort(context);
  const totalAdditions = context.files.reduce((total, file) => total + file.additions, 0);
  const totalDeletions = context.files.reduce((total, file) => total + file.deletions, 0);
  const promise = analysis?.contract.promise && analysis.contract.promise !== context.title ? ` Contract: ${analysis.contract.promise}` : "";
  const summary = `${context.title}. This change is organized into ${layers.length} evidence-backed layer${layers.length === 1 ? "" : "s"} across ${context.files.length} file${context.files.length === 1 ? "" : "s"} (+${totalAdditions}/-${totalDeletions}).${promise}`;
  const labels = new Set<string>();
  if (layers.some((layer) => layer.id === "tests")) labels.add("tests");
  if (layers.some((layer) => layer.id === "docs")) labels.add("documentation");
  if (layers.some((layer) => layer.id === "delivery")) labels.add("infrastructure");
  if (context.securityFindings?.some((finding) => finding.category === "security")) labels.add("security");
  if (context.securityFindings?.some((finding) => finding.category === "privacy")) labels.add("privacy");
  if (context.checks.some((check) => check.conclusion && !["success", "neutral", "skipped"].includes(check.conclusion.toLowerCase()))) labels.add("needs-evidence");
  if (analysis?.decision === "needs-owner") labels.add("needs-owner");
  return {
    summary,
    changeStack: layers,
    sequenceDiagram: buildSequenceDiagram(layers.length ? layers : [{ id: "change", title: "Change", purpose: "Fetched change-request evidence.", files: [], citations: [] }]),
    effortScore: effort.score,
    effortReason: effort.reason,
    relatedIssues: (context.issues ?? []).map((issue) => ({ provider: issue.provider, key: issue.key, summary: issue.summary, url: issue.url })),
    suggestedReviewers: context.suggestedReviewers ?? [],
    suggestedLabels: [...labels].sort(),
    citations: uniqueCitations(layers.flatMap((layer) => layer.citations)),
    evidenceMode: "deterministic",
  };
}

export function renderWalkthroughMarkdown(walkthrough: ReviewWalkthrough, decision?: Analysis["decision"]): string {
  const stack = walkthrough.changeStack.map((layer) => `| **${layer.title}** | ${layer.purpose} | ${layer.files.length} | ${layer.citations.length} |`).join("\n");
  const files = walkthrough.changeStack.flatMap((layer) => layer.files).slice(0, 40).map((file) => `- \`${file.path}\` (${file.status}, +${file.additions}/-${file.deletions}) [evidence](${file.citation.url})`).join("\n");
  const issues = walkthrough.relatedIssues.length ? `\n### Related issues\n${walkthrough.relatedIssues.map((issue) => `- [${issue.key}](${issue.url}) ${issue.summary}`).join("\n")}` : "";
  const reviewers = walkthrough.suggestedReviewers.length ? `\n### Suggested reviewers\n${walkthrough.suggestedReviewers.map((reviewer) => `- ${reviewer}`).join("\n")}` : "";
  const labels = walkthrough.suggestedLabels.length ? `\n### Suggested labels\n${walkthrough.suggestedLabels.map((label) => `- \`${label}\``).join("\n")}` : "";
  return ["## MergeProof walkthrough", decision ? `**Decision:** ${decision}` : "", `**Evidence mode:** ${walkthrough.evidenceMode} | **Review effort:** ${walkthrough.effortScore}/5`, `\n${walkthrough.summary}`, `\n### Change stack\n| Layer | Purpose | Files | Citations |\n| --- | --- | ---: | ---: |\n${stack || "| No changed files returned | | 0 | 0 |"}`, `\n### Changed files\n${files || "No changed file evidence was returned."}`, `\n### Change flow\n\n\`\`\`mermaid\n${walkthrough.sequenceDiagram}\n\`\`\``, `\n### Effort rationale\n${walkthrough.effortReason}`, issues, reviewers, labels, `\nVerified file citations: ${walkthrough.citations.length}`].filter(Boolean).join("\n");
}
