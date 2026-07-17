#!/usr/bin/env node
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { Command } from "commander";
import { analyzePullRequest } from "../lib/analyze";
import { scanRepositorySecurity } from "../lib/security";
import { evaluateAnalysis } from "../lib/evaluation";
import { verifyAnalysisAttestation } from "../lib/attestation";
import { fixPullRequest, simplifyPullRequest } from "../lib/fix";
import { autofixPullRequest, type AutofixResult } from "../lib/autofix";
import { publishChangeRequestCheck, publishChangeRequestComment, publishChangeRequestReview } from "../lib/change-publish";
import { applyPullRequestLabels, requestPullRequestReviewers } from "../lib/github-review";
import { createGitLabIssue, createJiraIssue, createLinearIssue } from "../lib/issues";
import { indexRepository } from "../lib/retrieval";
import { planPullRequest } from "../lib/plan";
import { planWorkItem } from "../lib/work-plan";
import { parseIssueUrl, planIssue } from "../lib/issue-plan";
import { publishSlackSummary } from "../lib/slack";
import { readRepositoryMemory } from "../lib/memory";
import { readAuditEvents } from "../lib/audit";
import { readReviewState, updateReviewState } from "../lib/review-state";
import { inspectConflicts, resolveConflicts, type ConflictReport, type ConflictResolution } from "../lib/conflicts";
import { addKnowledge, readKnowledge } from "../lib/knowledge";
import { startGithubWebhookServer } from "../lib/webhook";
import { createGithubIssueFromAnalysis } from "../lib/github-issues";
import { fetchGithubReviewThreads, resolveGithubReviewThreads } from "../lib/github-threads";
import { generateTestsPullRequest, type TestSuggestion } from "../lib/tests";
import { generateDocstringsPullRequest, type DocstringSuggestion } from "../lib/docstrings";
import { reviewWorkingTree } from "../lib/local-review";
import { runConsensus, type ConsensusResult } from "../lib/consensus";
import { runLocalAgent, VERIFICATION_COMMANDS, type LocalAgentRun, type VerificationCommand } from "../lib/local-agent";
import type { Analysis } from "../lib/types";
import type { ReviewPlan } from "../lib/models";
import type { FixSuggestion, SimplifySuggestion } from "../lib/fix";
import { parsePullRequestUrl, type PullRequestRef } from "../lib/github";
import type { ReviewEffort } from "../lib/types";
import { renderWalkthroughMarkdown } from "../lib/walkthrough";
import { runIssueAgent, type TaskAgentRun } from "../lib/task-agent";
import { runImplementationAgent, type ImplementationAgentRun } from "../lib/implementation-agent";
import { loadRecipes, runRecipe, type RecipeRun } from "../lib/recipes";
import { recordOutcome, readOutcomes, summarizeOutcomes, type OutcomeLabel } from "../lib/outcomes";
import { parseChangeRequestUrl } from "../lib/change-request";
import { generateMergeProofConfiguration, readMergeProofConfiguration, renderConfiguration } from "../lib/configuration";
import { askRepository } from "../lib/ask";
import { buildReviewReport, filterReviewRecords, renderReviewReportCsv, renderReviewReportMarkdown } from "../lib/report";
import { generateCustomReport } from "../lib/report-ai";
import { publishReviewReport, publishReviewReportEmail, type ReportDestination } from "../lib/report-delivery";
import { readPlanHistory, recordPlanVersion } from "../lib/plan-history";
import { createReviewBundle, verifyReviewBundle } from "../lib/review-bundle";

function printAnalysis(analysis: Analysis) {
  console.log(`\nMERGEPROOF: ${analysis.decision.toUpperCase()}\n`);
  for (const row of analysis.rows) {
    const marker = row.state === "pass" ? "[x]" : row.state === "warn" ? "[!]" : "[ ]";
    console.log(`${marker} ${row.criterion}`);
    console.log(`    ${row.evidence}`);
    for (const citation of row.citations) console.log(`    -> ${citation.path} (${citation.url})`);
  }
  console.log(`\nModel: ${analysis.trace.model}`);
  console.log(`Sources fetched: ${analysis.trace.fetchedSources} | Sources cited: ${analysis.trace.citedSources}`);
  console.log(`Unsupported claims: ${analysis.trace.unsupportedClaims} | Analysis time: ${analysis.trace.elapsedMs}ms`);
  if (analysis.trace.retrieval?.enabled) console.log(`Repository retrieval: ${analysis.trace.retrieval.selectedChunks}/${analysis.trace.retrieval.indexedChunks} chunks selected`);
  if (analysis.trace.linkedIssues) console.log(`Linked Jira issues: ${analysis.trace.linkedIssues}`);
  if (analysis.trace.customChecks) console.log(`Custom pre-merge checks: ${analysis.trace.customChecks}`);
  if (analysis.securityFindings?.length) {
    console.log(`Security findings: ${analysis.securityFindings.length}`);
    for (const finding of analysis.securityFindings) console.log(`    [${finding.severity}] ${finding.path}:${finding.line} ${finding.title}`);
  }
  if (analysis.qualitySignals?.length) {
    console.log(`Quality signals: ${analysis.qualitySignals.length}`);
    for (const finding of analysis.qualitySignals) console.log(`    [${finding.severity}] ${finding.path}:${finding.line} ${finding.title}`);
  }
  if (analysis.trace.memory?.enabled) console.log(`Review memory: ${analysis.trace.memory.matchedEntries} matched | stored: ${analysis.trace.memory.stored ? "yes" : "no"}`);
  if (analysis.trace.attestation) console.log(`Attestation: ${analysis.trace.attestation.algorithm}:${analysis.trace.attestation.digest}`);
  if (analysis.trace.externalSecurity) console.log(`External security: ${analysis.trace.externalSecurity.tools.join(", ") || "none"}${analysis.trace.externalSecurity.unavailable.length ? ` | unavailable: ${analysis.trace.externalSecurity.unavailable.join(", ")}` : ""}`);
  if (analysis.trace.mcp) console.log(`MCP context: ${analysis.trace.mcp.successful.join(", ") || "none"}${analysis.trace.mcp.failed.length ? ` | failed: ${analysis.trace.mcp.failed.join("; ")}` : ""}`);
  if (analysis.trace.webSearch) console.log(`Web search: ${analysis.trace.webSearch.provider || "none"} | results: ${analysis.trace.webSearch.resultCount}${analysis.trace.webSearch.unavailable ? ` | unavailable: ${analysis.trace.webSearch.unavailable}` : ""}`);
  if (analysis.trace.reviewEffort) console.log(`Review effort: ${analysis.trace.reviewEffort}`);
  if (analysis.trace.agent) console.log(`Agent profile: ${analysis.trace.agent}`);
  if (analysis.trace.knowledge) console.log(`Knowledge facts: ${analysis.trace.knowledge.matchedFacts}`);
  if (analysis.trace.relatedRepositories) console.log(`Related repositories: ${analysis.trace.relatedRepositories}`);
  if (analysis.trace.reviewPaths?.length) console.log(`Review scope: ${analysis.trace.reviewPaths.join(", ")}`);
  if (analysis.trace.unresolvedReviewThreads !== undefined) console.log(`Unresolved review threads: ${analysis.trace.unresolvedReviewThreads}`);
  if (analysis.trace.reviewThreadsUnavailable) console.log(`Review-thread context: ${analysis.trace.reviewThreadsUnavailable}`);
  if (analysis.trace.hooks?.enabled) console.log(`Hooks: before ${analysis.trace.hooks.before.join(", ") || "none"}; after ${analysis.trace.hooks.after.join(", ") || "none"}${analysis.trace.hooks.failed.length ? `; failed ${analysis.trace.hooks.failed.join(", ")}` : ""}`);
  console.log();
}

function printPlan(plan: ReviewPlan) {
  console.log(`\nMERGEPROOF PLAN (${plan.trace.model})\n\n${plan.summary}\n`);
  if (plan.risks.length) console.log(`Risks:\n${plan.risks.map((risk) => `- [${risk.severity}] ${risk.risk}`).join("\n")}\n`);
  console.log(`Steps:\n${plan.steps.map((step, index) => `${index + 1}. ${step.title}\n   ${step.detail}${step.citations.length ? `\n   Evidence: ${step.citations.map((citation) => citation.url).join(", ")}` : ""}`).join("\n")}`);
  console.log(`\nCitations verified: ${plan.trace.citedSources}/${plan.trace.fetchedSources}\n`);
}

function printWalkthrough(analysis: Analysis) {
  if (!analysis.walkthrough) {
    console.log("No walkthrough was generated.");
    return;
  }
  console.log(`\nMERGEPROOF WALKTHROUGH (${analysis.decision.toUpperCase()})\n\n${analysis.walkthrough.summary}\n`);
  console.log(`Change stack:\n${analysis.walkthrough.changeStack.map((layer, index) => `${index + 1}. ${layer.title} - ${layer.files.length} file(s), ${layer.citations.length} citation(s)\n   ${layer.purpose}`).join("\n") || "No changed files returned."}`);
  console.log(`\nReview effort: ${analysis.walkthrough.effortScore}/5\n${analysis.walkthrough.effortReason}`);
  if (analysis.walkthrough.relatedIssues.length) console.log(`\nRelated issues: ${analysis.walkthrough.relatedIssues.map((issue) => `${issue.key} (${issue.url})`).join(", ")}`);
  if (analysis.walkthrough.suggestedReviewers.length) console.log(`Suggested reviewers: ${analysis.walkthrough.suggestedReviewers.join(", ")}`);
  console.log(`\nVerified file citations: ${analysis.walkthrough.citations.length}\n\n${analysis.walkthrough.sequenceDiagram}\n`);
}

function printFix(fix: FixSuggestion) {
  console.log(`\nMERGEPROOF FIX (${fix.trace.model})\n\n${fix.summary}\n`);
  console.log(fix.patch || "No patch was proposed.");
  console.log(`\nApplied: ${fix.trace.applied ? "yes" : "no"}\n`);
}

function printConsensus(result: ConsensusResult) {
  console.log(`\nMERGEPROOF CONSENSUS: ${result.decision.toUpperCase()}\n`);
  for (const row of result.rows) console.log(`${row.agreement >= 0.67 ? "[x]" : "[!]"} ${row.criterion} (${Math.round(row.agreement * 100)}% agreement)\n    ${row.evidence}`);
  if (result.disagreements.length) console.log(`\nDisagreements: ${result.disagreements.map((item) => `${item.criterion}: ${item.states.join(", ")}`).join("; ")}`);
  console.log(`Agents: ${result.trace.agents} | Agreement: ${Math.round(result.trace.agreement * 100)}% | Sources cited: ${result.trace.citedSources}`);
  console.log(`Models: ${result.analyses.map((analysis) => `${analysis.model}=${analysis.decision}`).join(", ")}\n`);
}

function printConflicts(report: ConflictReport) {
  console.log(`\nMERGEPROOF CONFLICTS: ${report.conflictCount}\n`);
  for (const file of report.files) console.log(`- ${file.path}: ${file.hunks.length} conflict hunk(s)`);
  console.log(`Repository: ${report.repository} | HEAD: ${report.headSha}\n`);
}

function printConflictResolution(result: ConflictResolution) {
  console.log(`\nMERGEPROOF CONFLICT RESOLUTION (${result.trace.model})\n\n${result.summary}\n`);
  console.log(result.patch || "No resolution patch was proposed.");
  console.log(`\nApplied: ${result.trace.applied ? "yes" : "no"}\n`);
}

function printSimplify(fix: SimplifySuggestion) {
  console.log(`\nMERGEPROOF SIMPLIFY (${fix.trace.model})\n\n${fix.summary}\n`);
  console.log(fix.patch || "No behavior-preserving simplification was proposed.");
  console.log(`\nApplied: ${fix.trace.applied ? "yes" : "no"}\n`);
}

function printAutofix(fix: AutofixResult) {
  console.log(`\nMERGEPROOF AUTOFIX (${fix.trace.model})\n\n${fix.summary}\n`);
  console.log(fix.patch || "No patch was proposed.");
  console.log(`\nUnresolved review threads: ${fix.trace.unresolvedThreads}`);
  console.log(`Sandbox verification: ${fix.trace.verified ? "passed" : "failed"}`);
  if (fix.trace.verificationCommand) console.log(`Verification command: ${fix.trace.verificationCommand}`);
  if (fix.trace.reReviewDecision) console.log(`Re-review: ${fix.trace.reReviewDecision} (${fix.trace.reReviewPassed ? "passed" : "failed"})`);
  if (fix.trace.pullRequestUrl) console.log(`Created PR: ${fix.trace.pullRequestUrl}`);
}

function printTests(suggestion: TestSuggestion) {
  console.log(`\nMERGEPROOF TESTS (${suggestion.trace.model})\n\n${suggestion.summary}\n`);
  console.log(suggestion.patch || "No test patch was proposed.");
  console.log(`\nChanged test paths: ${suggestion.trace.changedPaths.join(", ") || "none"}\n`);
}

function printDocstrings(suggestion: DocstringSuggestion) {
  console.log(`\nMERGEPROOF DOCSTRINGS (${suggestion.trace.model})\n\n${suggestion.summary}\n`);
  console.log(suggestion.patch || "No documentation patch was proposed.");
  console.log(`\nChanged documentation paths: ${suggestion.trace.changedPaths.join(", ") || "none"}\n`);
}

function printRecipe(run: RecipeRun) {
  console.log(`\nMERGEPROOF RECIPE: ${run.recipe.name.toUpperCase()} (${run.trace.model})\n\n${run.summary}\n`);
  console.log(run.patch || "No recipe patch was proposed.");
  console.log(`\nSandboxed: ${run.trace.sandboxed ? "yes" : "no"} | Applied: ${run.trace.applied ? "yes" : "no"} | Verification: ${run.trace.verified ? "passed" : "not requested or failed"}`);
  if (run.trace.reReviewDecision) console.log(`Re-review: ${run.trace.reReviewDecision} (${run.trace.reReviewPassed ? "passed" : "failed"})`);
  if (run.trace.pullRequestUrl) console.log(`Created PR: ${run.trace.pullRequestUrl}`);
}

function printAgent(run: LocalAgentRun) {
  console.log(`\nMERGEPROOF SANDBOX AGENT (${run.trace.model})\n\n${run.summary}\n`);
  console.log(run.patch || "No patch was proposed.");
  console.log(`\nSandbox applied: ${run.trace.appliedToSandbox ? "yes" : "no"}`);
  console.log(`Verification: ${run.trace.verificationCommand ? `${run.trace.verificationCommand} (${run.trace.verified ? "passed" : "failed"})` : "not requested"}`);
  if (run.trace.reReviewDecision) console.log(`Autonomous re-review: ${run.trace.reReviewDecision} (${run.trace.reReviewPassed ? "passed" : "failed"})`);
  if (run.trace.reReviewError) console.log(`Re-review detail: ${run.trace.reReviewError}`);
  if (run.trace.verificationOutput) console.log(`\nVerification output:\n${run.trace.verificationOutput}`);
}

function printTaskAgent(run: TaskAgentRun) {
  console.log(`\nMERGEPROOF ISSUE AGENT (${run.trace.model})\n\n${run.summary}\n`);
  console.log(run.patch || "No patch was proposed.");
  console.log(`\nSandbox applied: ${run.trace.appliedToSandbox ? "yes" : "no"}`);
  console.log(`Evidence sources: ${run.trace.evidenceSources}`);
  console.log(`Verification: ${run.trace.verificationCommand ? `${run.trace.verificationCommand} (${run.trace.verified ? "passed" : "failed"})` : run.trace.verified ? "patch application passed" : "not requested"}`);
  if (run.trace.reReviewDecision) console.log(`Evidence re-review: ${run.trace.reReviewDecision} (${run.trace.reReviewPassed ? "passed" : "failed"})`);
  if (run.trace.pullRequestUrl) console.log(`Created PR: ${run.trace.pullRequestUrl}`);
  if (run.trace.verificationOutput) console.log(`\nVerification output:\n${run.trace.verificationOutput}`);
}

function printImplementation(run: ImplementationAgentRun) {
  console.log(`\nMERGEPROOF IMPLEMENTATION (${run.trace.model})\n\n${run.summary}\n`);
  console.log(run.patch || "No safe patch was proposed.");
  console.log(`\nEvidence sources: ${run.trace.evidenceSources} | Indexed chunks: ${run.trace.indexedChunks}`);
  console.log(`Sandbox verification: ${run.trace.verified ? "passed" : "not passed"}${run.trace.verificationCommand ? ` (${run.trace.verificationCommand})` : ""}`);
  if (run.trace.reReviewDecision) console.log(`Re-review: ${run.trace.reReviewDecision} (${run.trace.reReviewPassed ? "passed" : "failed"})`);
  console.log(`Applied to checkout: ${run.trace.appliedToCheckout ? "yes" : "no"}`);
}

function parseCriteria(value?: string): string[] | undefined {
  if (!value) return undefined;
  return value.split("|").map((criterion) => criterion.trim()).filter(Boolean);
}

function parseVerificationCommand(value?: string): VerificationCommand | undefined {
  if (!value) return undefined;
  if (!VERIFICATION_COMMANDS.includes(value as VerificationCommand)) throw new Error(`Unsupported verification command. Choose one of: ${VERIFICATION_COMMANDS.join(", ")}.`);
  return value as VerificationCommand;
}

function parseReviewEffort(value?: string): ReviewEffort | undefined {
  if (!value) return undefined;
  if (value !== "low" && value !== "medium" && value !== "high") throw new Error("Review effort must be low, medium, or high.");
  return value;
}

function parseOutcomeLabel(value: string): OutcomeLabel {
  const labels: OutcomeLabel[] = ["merged", "closed-unmerged", "false-positive", "missed-risk", "accepted", "rejected"];
  if (!labels.includes(value as OutcomeLabel)) throw new Error(`Outcome must be one of: ${labels.join(", ")}.`);
  return value as OutcomeLabel;
}

function parseRepository(value: string): PullRequestRef {
  const match = value.trim().match(/^([^/]+)\/([^/]+)$/);
  if (!match) throw new Error("Repository must use the owner/repo format.");
  return { owner: match[1], repo: match[2], number: 0, url: `https://github.com/${match[1]}/${match[2]}` };
}

function isIssuePlanningUrl(value: string): boolean {
  try { parseIssueUrl(value); return true; } catch { return false; }
}

const program = new Command();
program.name("mergeproof").description("Evidence-backed merge decisions for software change requests").version("0.4.0");

program.command("index").description("Build a local repository evidence index").argument("[repo-path]", "Repository path", process.cwd()).action(async (repoPath) => {
  const result = await indexRepository(repoPath);
  console.log(JSON.stringify({ indexPath: result.path, commitSha: result.index.commitSha, chunks: result.index.chunks.length }, null, 2));
});

program.command("configuration").alias("config").description("Inspect or explicitly generate the repository MergeProof policy").option("--repo <path>", "Repository path", process.cwd()).option("--generate", "Create .mergeproof/config.json when it is missing").option("--force", "Overwrite the existing policy when generating").option("--json", "Print machine-readable JSON").action(async (options) => {
  try {
    if (options.generate) {
      const generated = await generateMergeProofConfiguration(options.repo, options.force);
      if (options.json) console.log(JSON.stringify(generated, null, 2));
      else console.log(`${generated.created ? "Generated" : "Kept"} ${generated.path}.`);
      return;
    }
    const snapshot = await readMergeProofConfiguration(options.repo);
    if (options.json) console.log(JSON.stringify(snapshot, null, 2));
    else console.log(renderConfiguration(snapshot));
  } catch (error) {
    console.error(`MergeProof configuration error: ${error instanceof Error ? error.message : "Configuration inspection failed."}`);
    process.exitCode = 1;
  }
});

program.command("ask").alias("chat").description("Answer a read-only repository question using bounded local evidence").argument("<question...>", "Question to answer").option("--repo <path>", "Repository path", process.cwd()).option("--model <model>", "Model name").option("--provider <provider>", "openai, openai-compatible, or anthropic").option("--agent <profile>", "Repository custom-agent profile").option("--retrieval-top-k <number>", "Maximum repository evidence chunks", "8").option("--json", "Print machine-readable JSON").action(async (question, options) => {
  try {
    const result = await askRepository(question.join(" "), options.model, { repoPath: options.repo, provider: options.provider, agent: options.agent, retrievalTopK: Number(options.retrievalTopK) });
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`${result.answer}\n\nModel: ${result.trace.model}\nEvidence sources: ${result.trace.evidenceSources}/${result.trace.indexedChunks}\nRead-only trace: ${result.trace.headSha} (${result.trace.elapsedMs}ms)`);
  } catch (error) {
    console.error(`MergeProof ask error: ${error instanceof Error ? error.message : "Repository question failed."}`);
    process.exitCode = 1;
  }
});

program.command("evaluate").description("Measure evidence coverage for a saved JSON analysis").argument("<analysis-json>", "Path to analysis JSON").action(async (analysisPath) => {
  const analysis = JSON.parse(await readFile(analysisPath, "utf8")) as Analysis;
  console.log(JSON.stringify(evaluateAnalysis(analysis), null, 2));
});

program.command("verify").description("Verify the SHA-256 attestation on a saved JSON analysis").argument("<analysis-json>", "Path to analysis JSON").option("--json", "Print machine-readable JSON").action(async (analysisPath, options) => {
  try {
    const result = verifyAnalysisAttestation(JSON.parse(await readFile(analysisPath, "utf8")) as Analysis);
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`${result.valid ? "Valid" : "Invalid"} MergeProof attestation. Expected ${result.expected.algorithm}:${result.expected.digest}${result.actual ? `; actual ${result.actual.algorithm}:${result.actual.digest}` : "."}`);
    process.exitCode = result.valid ? 0 : 2;
  } catch (error) {
    console.error(`MergeProof verify error: ${error instanceof Error ? error.message : "Attestation verification failed."}`);
    process.exitCode = 1;
  }
});

const bundleCommand = program.command("bundle").description("Create or verify an offline, evidence-backed review capsule");
bundleCommand.command("create").description("Fetch a change request and package its exact context with a saved analysis").argument("<change-request-url>", "Public change-request URL").requiredOption("--analysis <path>", "Saved MergeProof analysis JSON").option("--output <path>", "Write the review bundle JSON to a file").option("--json", "Print the full bundle JSON").action(async (prUrl, options) => {
  try {
    const analysis = JSON.parse(await readFile(options.analysis, "utf8")) as Analysis;
    const bundle = await createReviewBundle(prUrl, analysis);
    if (options.output) await writeFile(options.output, JSON.stringify(bundle, null, 2), "utf8");
    if (options.json) console.log(JSON.stringify(bundle, null, 2));
    else console.log(`Review capsule created: ${options.output || "stdout"}\nBundle digest: sha256:${bundle.bundleDigest}\nContext digest: sha256:${bundle.contextDigest}\nHead SHA: ${bundle.target.headSha}`);
  } catch (error) {
    console.error(`MergeProof bundle create error: ${error instanceof Error ? error.message : "Review capsule creation failed."}`);
    process.exitCode = 1;
  }
});
bundleCommand.command("verify").description("Verify a review capsule without a model or network request").argument("<bundle-json>", "Path to a review bundle JSON").option("--json", "Print machine-readable JSON").action(async (bundlePath, options) => {
  try {
    const result = verifyReviewBundle(JSON.parse(await readFile(bundlePath, "utf8")));
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`${result.valid ? "Valid" : "Invalid"} MergeProof review capsule. Bundle digest: ${result.bundleDigestValid ? "valid" : "invalid"}; context digest: ${result.contextDigestValid ? "valid" : "invalid"}; analysis attestation: ${result.analysisAttestationValid ? "valid" : "invalid"}; citations: ${result.citationErrors.length ? `${result.citationErrors.length} error(s)` : "valid"}.`);
    process.exitCode = result.valid ? 0 : 2;
  } catch (error) {
    console.error(`MergeProof bundle verify error: ${error instanceof Error ? error.message : "Review capsule verification failed."}`);
    process.exitCode = 1;
  }
});

program.command("memory").description("Inspect repository-scoped review memory").argument("<repository>", "GitHub repository, for example owner/repo").option("--repo <path>", "Repository path", process.cwd()).option("--query <text>", "Filter by title or criterion").option("--limit <number>", "Maximum entries", "20").option("--json", "Print machine-readable JSON").action(async (repository, options) => {
  try {
    const entries = await readRepositoryMemory(options.repo, repository, options.query || "", Number(options.limit));
    if (options.json) console.log(JSON.stringify(entries, null, 2));
    else for (const entry of entries) console.log(`${entry.recordedAt} ${entry.decision} ${entry.prUrl} ${entry.title}`);
  } catch (error) {
    console.error(`MergeProof memory error: ${error instanceof Error ? error.message : "Memory lookup failed."}`);
    process.exitCode = 1;
  }
});

program.command("plan-history").description("Inspect locally recorded implementation-plan versions").option("--repo <path>", "Repository path", process.cwd()).option("--id <plan-id>", "Filter to one stable plan identity").option("--limit <number>", "Maximum versions", "20").option("--json", "Print machine-readable JSON").action(async (options) => {
  try {
    const entries = await readPlanHistory(options.repo, { id: options.id, limit: Number(options.limit) });
    if (options.json) console.log(JSON.stringify(entries, null, 2));
    else for (const entry of entries) console.log(`${entry.id} v${entry.version} ${entry.recordedAt} ${entry.kind} ${entry.target} ${entry.digest}`);
  } catch (error) {
    console.error(`MergeProof plan-history error: ${error instanceof Error ? error.message : "Plan history lookup failed."}`);
    process.exitCode = 1;
  }
});

program.command("audit").description("Inspect the local bounded review metadata trail").option("--repo <path>", "Repository path", process.cwd()).option("--limit <number>", "Maximum events", "50").option("--json", "Print machine-readable JSON").action(async (options) => {
  const events = await readAuditEvents(options.repo, Number(options.limit));
  if (options.json) console.log(JSON.stringify(events, null, 2));
  else for (const event of events) console.log(`${event.recordedAt} ${event.action} ${event.decision ?? "-"} ${event.target} ${event.attestation ? `sha256:${event.attestation}` : ""}`.trim());
});

program.command("feedback").description("Record an explicit human or lifecycle outcome for a reviewed change request").argument("<change-request-url>", "Public change-request URL").argument("<label>", "merged, closed-unmerged, false-positive, missed-risk, accepted, or rejected").option("--repo <path>", "Repository path", process.cwd()).option("--analysis <path>", "Saved MergeProof analysis JSON to attach the predicted decision and attestation").option("--reason <text>", "Short human explanation").option("--json", "Print machine-readable JSON").action(async (targetUrl, label, options) => {
  try {
    const target = parseChangeRequestUrl(targetUrl);
    const analysis = options.analysis ? JSON.parse(await readFile(options.analysis, "utf8")) as Analysis : undefined;
    const outcome = await recordOutcome(options.repo, target.ref, targetUrl, parseOutcomeLabel(label), { analysis, reason: options.reason });
    if (options.json) console.log(JSON.stringify(outcome, null, 2));
    else console.log(`Recorded ${outcome.label} for ${outcome.target}${outcome.predictedDecision ? ` (predicted ${outcome.predictedDecision})` : ""}.`);
  } catch (error) {
    console.error(`MergeProof feedback error: ${error instanceof Error ? error.message : "Outcome recording failed."}`);
    process.exitCode = 1;
  }
});

program.command("metrics").description("Summarize evidence-review outcomes and ready-decision calibration").argument("[repository]", "Repository owner/repo filter").option("--repo <path>", "Repository path", process.cwd()).option("--limit <number>", "Maximum outcomes", "2000").option("--json", "Print machine-readable JSON").action(async (repository, options) => {
  try {
    const summary = summarizeOutcomes(await readOutcomes(options.repo, repository, Number(options.limit)));
    if (options.json) console.log(JSON.stringify(summary, null, 2));
    else console.log(`Outcomes: ${summary.total}\nLabels: ${Object.entries(summary.labels).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}\nDecisions: ${Object.entries(summary.decisions).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}${summary.readyCalibration ? `\nReady calibration: ${Math.round(summary.readyCalibration.rate * 100)}% (${summary.readyCalibration.merged}/${summary.readyCalibration.total} merged or accepted)` : ""}`);
  } catch (error) {
    console.error(`MergeProof metrics error: ${error instanceof Error ? error.message : "Metrics failed."}`);
    process.exitCode = 1;
  }
});

program.command("report").description("Generate local review activity, outcome, and calibration reports").argument("[repository]", "Repository owner/repo filter").option("--repo <path>", "Repository path", process.cwd()).option("--days <number>", "Only include the last N days").option("--format <format>", "json, markdown, or csv", "markdown").option("--output <path>", "Write the report to a file").option("--prompt <request>", "Generate a custom natural-language report from the measured report data").option("--model <model>", "Model name for --prompt").option("--provider <provider>", "Provider for --prompt").option("--agent <profile>", "Custom agent profile for --prompt").option("--slack-webhook <url>", "Deliver the Markdown report to a Slack incoming webhook").option("--discord-webhook <url>", "Deliver the Markdown report to a Discord webhook").option("--teams-webhook <url>", "Deliver the Markdown report to a Microsoft Teams webhook").option("--email-to <address>", "Deliver the Markdown report to an email address", process.env.MERGEPROOF_REPORT_EMAIL_TO).option("--email-from <address>", "Verified sender address for email delivery", process.env.MERGEPROOF_REPORT_EMAIL_FROM).option("--email-subject <subject>", "Subject for email delivery", "MergeProof review report").action(async (repository, options) => {
  try {
    const events = await readAuditEvents(options.repo, 500);
    const outcomes = await readOutcomes(options.repo, undefined, 2_000);
    const filters = { repository, ...(options.days ? { periodDays: Number(options.days) } : {}) };
    const filtered = filterReviewRecords(events, outcomes, filters);
    const report = buildReviewReport(events, outcomes, filters);
    const format = String(options.format).toLowerCase();
    if (options.prompt && format !== "markdown") throw new Error("Custom report prompts require --format markdown.");
    const content = options.prompt
      ? (await generateCustomReport(options.prompt, report, { repoPath: options.repo, model: options.model, provider: options.provider, agent: options.agent })).report
      : format === "json" ? JSON.stringify(report, null, 2) : format === "csv" ? renderReviewReportCsv(filtered.events, filtered.outcomes) : renderReviewReportMarkdown(report);
    if (options.output) await writeFile(options.output, `${content}${content.endsWith("\n") ? "" : "\n"}`, "utf8");
    else console.log(content);
    const destinations: Array<[ReportDestination, string | undefined]> = [["slack", options.slackWebhook], ["discord", options.discordWebhook], ["teams", options.teamsWebhook]];
    for (const [destination, webhook] of destinations) if (webhook) {
      await publishReviewReport(destination, webhook, renderReviewReportMarkdown(report));
      console.error(`Report delivered to ${destination}.`);
    }
    if (options.emailTo || options.emailFrom) {
      if (!options.emailTo || !options.emailFrom) throw new Error("Email report delivery requires both --email-to and --email-from.");
      await publishReviewReportEmail(renderReviewReportMarkdown(report), { to: options.emailTo, from: options.emailFrom, subject: options.emailSubject });
      console.error(`Report delivered by email to ${options.emailTo}.`);
    }
  } catch (error) {
    console.error(`MergeProof report error: ${error instanceof Error ? error.message : "Report generation failed."}`);
    process.exitCode = 1;
  }
});

program.command("state").description("Inspect or control automatic review pause, ignore, and auto-pause state").option("--repo <path>", "Repository path", process.cwd()).option("--pause", "Pause automatic reviews for this repository").option("--resume", "Resume automatic reviews for this repository").option("--ignore <pull-request-url>", "Ignore automatic reviews for one pull request").option("--unignore <pull-request-url>", "Re-enable automatic reviews for one pull request").option("--auto-pause-after <commits>", "Auto-pause a PR after this many commits since its last automatic review; 0 disables it").option("--reason <text>", "Bounded human-readable reason").option("--json", "Print machine-readable JSON").action(async (options) => {
  try {
    if (options.pause && options.resume) throw new Error("Choose only one of --pause or --resume.");
    if (options.ignore && options.unignore) throw new Error("Choose only one of --ignore or --unignore.");
    const state = options.pause || options.resume || options.ignore || options.unignore || options.autoPauseAfter !== undefined
      ? await updateReviewState(options.repo, { ...(options.pause ? { paused: true } : {}), ...(options.resume ? { paused: false } : {}), ...(options.ignore ? { ignorePullRequest: options.ignore } : {}), ...(options.unignore ? { unignorePullRequest: options.unignore } : {}), ...(options.autoPauseAfter !== undefined ? { autoPauseAfterReviewedCommits: Number(options.autoPauseAfter) } : {}), ...(options.reason ? { reason: options.reason } : {}) })
      : await readReviewState(options.repo);
    if (options.json) console.log(JSON.stringify(state, null, 2));
    else console.log(`Automatic reviews: ${state.paused ? "paused" : "enabled"}\nIgnored pull requests: ${state.ignoredPullRequests.length}\nAuto-paused pull requests: ${state.autoPausedPullRequests.length}\nAuto-pause after commits: ${state.autoPauseAfterReviewedCommits ?? "disabled"}${state.reason ? `\nReason: ${state.reason}` : ""}`);
  } catch (error) {
    console.error(`MergeProof state error: ${error instanceof Error ? error.message : "Review state operation failed."}`);
    process.exitCode = 1;
  }
});

program.command("conflicts").description("Inspect active Git merge conflicts or generate a guarded resolution patch").argument("[repo-path]", "Git repository path", process.cwd()).option("--json", "Print machine-readable JSON").option("--model <model>", "Model name for resolution").option("--provider <provider>", "openai, openai-compatible, or anthropic").option("--criteria <criteria>", "Pipe-separated resolution criteria").option("--patch <path>", "Save the resolution patch").option("--resolve", "Ask the configured model for a resolution patch").option("--apply", "Apply the resolution with git apply --3way and stage resolved paths").action(async (repoPath, options) => {
  try {
    if (!options.resolve) {
      const report = await inspectConflicts(repoPath);
      if (options.json) console.log(JSON.stringify(report, null, 2));
      else printConflicts(report);
      process.exitCode = report.conflictCount ? 2 : 0;
      return;
    }
    const resolution = await resolveConflicts(repoPath, options.model, { provider: options.provider, criteria: parseCriteria(options.criteria), apply: options.apply });
    if (options.patch) await writeFile(options.patch, resolution.patch, "utf8");
    if (options.json) console.log(JSON.stringify(resolution, null, 2));
    else printConflictResolution(resolution);
    process.exitCode = resolution.trace.applied ? 0 : 2;
  } catch (error) {
    console.error(`MergeProof conflicts error: ${error instanceof Error ? error.message : "Conflict workflow failed."}`);
    process.exitCode = 1;
  }
});

program.command("resolve").description("Inspect or explicitly resolve current GitHub pull-request review threads").argument("<github-pull-request-url>", "GitHub pull request URL").option("--thread-id <id...>", "Only select explicit unresolved thread IDs").option("--apply", "Resolve selected threads through the GitHub GraphQL API").option("--json", "Print machine-readable JSON").action(async (prUrl, options) => {
  try {
    const ref = parsePullRequestUrl(prUrl);
    const report = await fetchGithubReviewThreads(ref);
    const selected = report.threads.filter((thread) => !thread.isResolved && !thread.isOutdated && (!options.threadId?.length || options.threadId.includes(thread.id)));
    if (options.apply) {
      const resolved = await resolveGithubReviewThreads(ref, options.threadId?.length ? options.threadId : undefined);
      const output = { pullRequestUrl: ref.url, resolved, remainingUnresolved: selected.length - resolved.length };
      if (options.json) console.log(JSON.stringify(output, null, 2));
      else console.log(`Resolved ${resolved.length} review thread(s) on ${ref.url}.`);
      return;
    }
    const output = { pullRequestUrl: ref.url, unresolved: selected.map((thread) => ({ id: thread.id, path: thread.path, line: thread.line, url: thread.url })) };
    if (options.json) console.log(JSON.stringify(output, null, 2));
    else console.log(selected.length ? selected.map((thread) => `${thread.id} ${thread.path}:${thread.line ?? "?"} ${thread.url}`).join("\n") : "No unresolved current review threads.");
  } catch (error) {
    console.error(`MergeProof resolve error: ${error instanceof Error ? error.message : "Review-thread resolution failed."}`);
    process.exitCode = 1;
  }
});

program.command("knowledge").description("Inspect or explicitly add repository-scoped review knowledge").argument("<repository>", "GitHub repository, for example owner/repo").option("--repo <path>", "Repository path", process.cwd()).option("--query <text>", "Filter facts by content").option("--limit <number>", "Maximum facts", "20").option("--add <fact>", "Add an explicitly approved human fact").option("--path <path...>", "Optional changed-file paths this fact applies to").option("--json", "Print machine-readable JSON").action(async (repository, options) => {
  try {
    const ref = parseRepository(repository);
    if (options.add) {
      const fact = await addKnowledge(options.repo, ref, options.add, options.path ?? []);
      console.log(options.json ? JSON.stringify(fact, null, 2) : `Knowledge fact ${fact.id} stored for ${fact.repository}.`);
      return;
    }
    const facts = await readKnowledge(options.repo, ref, [], options.query ?? "", Number(options.limit));
    if (options.json) console.log(JSON.stringify(facts, null, 2));
    else for (const fact of facts) console.log(`${fact.id} ${fact.paths.length ? `[${fact.paths.join(", ")}] ` : ""}${fact.content}`);
  } catch (error) {
    console.error(`MergeProof knowledge error: ${error instanceof Error ? error.message : "Knowledge operation failed."}`);
    process.exitCode = 1;
  }
});

program.command("serve").description("Run GitHub, provider, Slack, Discord, and custom automation webhook receivers").option("--host <host>", "Bind host", process.env.MERGEPROOF_WEBHOOK_HOST || "127.0.0.1").option("--port <number>", "Bind port", process.env.MERGEPROOF_WEBHOOK_PORT || "8787").option("--secret <secret>", "GitHub webhook signing secret", process.env.GITHUB_WEBHOOK_SECRET).option("--slack-signing-secret <secret>", "Slack signing secret", process.env.SLACK_SIGNING_SECRET).option("--slack-bot-token <token>", "Slack bot token for Events API replies", process.env.SLACK_BOT_TOKEN).option("--discord-public-key <key>", "Discord application Ed25519 public key", process.env.DISCORD_PUBLIC_KEY).option("--gitlab-webhook-secret <secret>", "GitLab webhook secret", process.env.GITLAB_WEBHOOK_SECRET).option("--bitbucket-webhook-secret <secret>", "Bitbucket webhook secret", process.env.BITBUCKET_WEBHOOK_SECRET).option("--azure-devops-webhook-secret <secret>", "Azure DevOps webhook secret", process.env.AZURE_DEVOPS_WEBHOOK_SECRET).option("--automation-webhook-secret <secret>", "Custom automation webhook HMAC secret", process.env.MERGEPROOF_AUTOMATION_WEBHOOK_SECRET).option("--repo <path>", "Local repository path for retrieval and memory").option("--model <model>", "Model name").option("--provider <provider>", "openai, openai-compatible, or anthropic").option("--publish-review", "Publish a PR review in addition to the provider status/check").action(async (options) => {
  try {
    const server = startGithubWebhookServer({ secret: options.secret, slackSigningSecret: options.slackSigningSecret, slackBotToken: options.slackBotToken, discordPublicKey: options.discordPublicKey, gitlabWebhookSecret: options.gitlabWebhookSecret, bitbucketWebhookSecret: options.bitbucketWebhookSecret, azureDevopsWebhookSecret: options.azureDevopsWebhookSecret, automationWebhookSecret: options.automationWebhookSecret, host: options.host, port: Number(options.port), repoPath: options.repo, model: options.model, provider: options.provider, publishReview: options.publishReview, log: (message) => console.error(message) });
    console.error(`MergeProof webhook listening on http://${options.host}:${options.port}/github/webhook, /gitlab/webhook, /bitbucket/webhook, /azure-devops/webhook, /automation/webhook, /slack/commands, /slack/events, and /discord/interactions`);
    await new Promise<void>((resolve, reject) => { server.on("error", reject); server.on("close", resolve); });
  } catch (error) {
    console.error(`MergeProof serve error: ${error instanceof Error ? error.message : "Webhook server failed."}`);
    process.exitCode = 1;
  }
});

program.command("plan").description("Generate a citation-aware implementation plan for a change request").argument("<change-request-url>", "Public change-request URL").option("--json", "Print machine-readable JSON").option("--save <path>", "Save the plan JSON to a file").option("--record", "Record a version in .mergeproof/plan-history.jsonl").option("--model <model>", "Model name").option("--provider <provider>", "openai, openai-compatible, or anthropic").option("--agent <profile>", "Repository custom-agent profile").option("--repo <path>", "Local repository containing the profile").action(async (prUrl, options) => {
  try {
    let plan = await (isIssuePlanningUrl(prUrl) ? planIssue(prUrl, options.model, options.provider, { repoPath: options.repo, agent: options.agent }) : planPullRequest(prUrl, options.model, options.provider, { repoPath: options.repo, agent: options.agent }));
    if (options.record) {
      const entry = await recordPlanVersion(options.repo, plan, { kind: "change-request", target: prUrl });
      plan = { ...entry.plan, trace: { ...entry.plan.trace, historyPath: ".mergeproof/plan-history.jsonl" } };
    }
    if (options.save) await writeFile(options.save, JSON.stringify(plan, null, 2), "utf8");
    if (options.json) console.log(JSON.stringify(plan, null, 2));
    else printPlan(plan);
  } catch (error) {
    console.error(`MergeProof plan error: ${error instanceof Error ? error.message : "Planning failed."}`);
    process.exitCode = 1;
  }
});

program.command("work-plan").description("Create a citation-aware implementation plan from a PRD, design, issue text, or free-form request").argument("<request...>", "Work item or product request").option("--json", "Print machine-readable JSON").option("--save <path>", "Save the plan JSON to a file").option("--record", "Record a version in .mergeproof/plan-history.jsonl").option("--model <model>", "Model name").option("--provider <provider>", "openai, openai-compatible, or anthropic").option("--agent <profile>", "Repository custom-agent profile").option("--repo <path>", "Local repository to inspect", process.cwd()).option("--retrieval-top-k <number>", "Maximum repository evidence chunks", "12").action(async (request, options) => {
  try {
    let plan = await planWorkItem(request.join(" "), options.model, { repoPath: options.repo, provider: options.provider, agent: options.agent, retrievalTopK: Number(options.retrievalTopK) });
    if (options.record) {
      const entry = await recordPlanVersion(options.repo, plan, { kind: "work-item", target: options.repo, request: request.join(" ") });
      plan = { ...entry.plan, trace: { ...entry.plan.trace, historyPath: ".mergeproof/plan-history.jsonl" } };
    }
    if (options.save) await writeFile(options.save, JSON.stringify(plan, null, 2), "utf8");
    if (options.json) console.log(JSON.stringify(plan, null, 2));
    else printPlan(plan);
  } catch (error) {
    console.error(`MergeProof work-plan error: ${error instanceof Error ? error.message : "Work planning failed."}`);
    process.exitCode = 1;
  }
});

program.command("walkthrough").description("Generate an evidence-backed PR summary, change stack, effort estimate, and Mermaid change-flow diagram").argument("<change-request-url>", "Public change-request URL").option("--json", "Print machine-readable JSON").option("--save <path>", "Save the walkthrough JSON to a file").option("--model <model>", "Model name").option("--provider <provider>", "openai, openai-compatible, or anthropic").option("--repo <path>", "Local checkout to use for repository retrieval").option("--effort <level>", "Review effort: low, medium, or high").option("--profile <profile>", "Review profile: quiet, chill, or assertive").option("--publish", "Publish the walkthrough as a provider comment").action(async (prUrl, options) => {
  try {
    const analysis = await analyzePullRequest(prUrl, options.model, { provider: options.provider, repoPath: options.repo, effort: parseReviewEffort(options.effort), profile: options.profile });
    if (!analysis.walkthrough) throw new Error("Walkthrough generation returned no artifact.");
    const output = { decision: analysis.decision, walkthrough: analysis.walkthrough, trace: analysis.trace };
    if (options.save) await writeFile(options.save, JSON.stringify(output, null, 2), "utf8");
    if (options.publish) console.error(`Walkthrough published: ${await publishChangeRequestComment(prUrl, renderWalkthroughMarkdown(analysis.walkthrough, analysis.decision))}`);
    if (options.json) console.log(JSON.stringify(output, null, 2));
    else printWalkthrough(analysis);
  } catch (error) {
    console.error(`MergeProof walkthrough error: ${error instanceof Error ? error.message : "Walkthrough generation failed."}`);
    process.exitCode = 1;
  }
});

program.command("erd").description("Generate an evidence-backed Mermaid entity relationship impact diagram").argument("<change-request-url>", "Public change-request URL").option("--json", "Print machine-readable JSON").option("--save <path>", "Save the ERD JSON to a file").option("--model <model>", "Model name").option("--provider <provider>", "openai, openai-compatible, or anthropic").option("--repo <path>", "Local checkout to use for repository retrieval").option("--publish", "Publish the ERD as a provider comment").action(async (prUrl, options) => {
  try {
    const analysis = await analyzePullRequest(prUrl, options.model, { provider: options.provider, repoPath: options.repo });
    if (!analysis.walkthrough) throw new Error("ERD generation returned no artifact.");
    const output = { decision: analysis.decision, diagram: analysis.walkthrough.entityRelationshipDiagram, entities: analysis.walkthrough.entityEvidence, trace: analysis.trace };
    if (options.save) await writeFile(options.save, JSON.stringify(output, null, 2), "utf8");
    if (options.publish) {
      const entityLines = output.entities.map((entity) => `- **${entity.name}** from \`${entity.source}\` [evidence](${entity.citation.url})`);
      const body = ["## MergeProof schema impact", "", "```mermaid", output.diagram, "```", "", entityLines.join("\n") || "No schema/model entities were detected."].join("\n");
      console.error(`ERD published: ${await publishChangeRequestComment(prUrl, body)}`);
    }
    if (options.json) console.log(JSON.stringify(output, null, 2));
    else console.log(`${output.diagram}\n\nEntities: ${output.entities.map((entity) => `${entity.name} (${entity.source})`).join(", ") || "none"}`);
  } catch (error) {
    console.error(`MergeProof ERD error: ${error instanceof Error ? error.message : "ERD generation failed."}`);
    process.exitCode = 1;
  }
});

program.command("consensus").description("Run independent model reviews and require evidence consensus").argument("<change-request-url>", "Public change-request URL").option("--json", "Print machine-readable JSON").option("--save <path>", "Save the consensus JSON to a file").option("--model <model...>", "Two or more model names").option("--provider <provider...>", "Provider for each model").option("--repo <path>", "Local checkout to use for repository retrieval").option("--related-repo <path...>", "Additional local repositories for read-only context").option("--effort <level>", "Review effort: low, medium, or high").option("--profile <profile>", "Review profile: quiet, chill, or assertive").option("--agent <profile>", "Repository custom-agent profile").option("--mcp", "Use explicitly configured read-only MCP context tools").option("--web-search", "Use opt-in web-search snippets as external context").action(async (prUrl, options) => {
  try {
    const consensus = await runConsensus(prUrl, { models: options.model, providers: options.provider, provider: options.provider?.[0], repoPath: options.repo, relatedRepos: options.relatedRepo, effort: parseReviewEffort(options.effort), profile: options.profile, agent: options.agent, mcp: options.mcp, webSearch: options.webSearch });
    if (options.save) await writeFile(options.save, JSON.stringify(consensus, null, 2), "utf8");
    if (options.json) console.log(JSON.stringify(consensus, null, 2));
    else printConsensus(consensus);
    process.exitCode = consensus.decision === "ready" ? 0 : 2;
  } catch (error) {
    console.error(`MergeProof consensus error: ${error instanceof Error ? error.message : "Consensus failed."}`);
    process.exitCode = 1;
  }
});

program.command("simplify").description("Suggest a behavior-preserving simplification of changed code").argument("<change-request-url>", "Public change-request URL").option("--json", "Print machine-readable JSON").option("--save <path>", "Save the simplify JSON to a file").option("--patch <path>", "Save the unified diff to a patch file").option("--model <model>", "Model name").option("--provider <provider>", "openai, openai-compatible, or anthropic").option("--repo <path>", "Local checkout to validate").option("--agent <profile>", "Repository custom-agent profile").option("--apply", "Apply only after git apply --check succeeds").action(async (prUrl, options) => {
  try {
    const simplify = await simplifyPullRequest(prUrl, options.model, { provider: options.provider, repoPath: options.repo, agent: options.agent, apply: options.apply });
    if (options.patch) await writeFile(options.patch, simplify.patch, "utf8");
    if (options.save) await writeFile(options.save, JSON.stringify(simplify, null, 2), "utf8");
    if (options.json) console.log(JSON.stringify(simplify, null, 2));
    else printSimplify(simplify);
  } catch (error) {
    console.error(`MergeProof simplify error: ${error instanceof Error ? error.message : "Simplification failed."}`);
    process.exitCode = 1;
  }
});

program.command("fix").description("Suggest or explicitly apply a validated unified diff").argument("<change-request-url>", "Public change-request URL").option("--json", "Print machine-readable JSON").option("--save <path>", "Save the fix JSON to a file").option("--patch <path>", "Save the unified diff to a patch file").option("--model <model>", "Model name").option("--provider <provider>", "openai, openai-compatible, or anthropic").option("--repo <path>", "Local checkout to validate").option("--agent <profile>", "Repository custom-agent profile").option("--apply", "Apply only after git apply --check succeeds").action(async (prUrl, options) => {
  try {
    const fix = await fixPullRequest(prUrl, options.model, { provider: options.provider, repoPath: options.repo, agent: options.agent, apply: options.apply });
    if (options.patch) await writeFile(options.patch, fix.patch, "utf8");
    if (options.save) await writeFile(options.save, JSON.stringify(fix, null, 2), "utf8");
    if (options.json) console.log(JSON.stringify(fix, null, 2));
    else printFix(fix);
  } catch (error) {
    console.error(`MergeProof fix error: ${error instanceof Error ? error.message : "Fix generation failed."}`);
    process.exitCode = 1;
  }
});

program.command("autofix").description("Fix review findings in an ephemeral worktree").argument("<pull-request-url>", "GitHub pull request or GitLab merge request URL").requiredOption("--repo <path>", "Checkout at the exact change-request head SHA").option("--json", "Print machine-readable JSON").option("--save <path>", "Save the autofix JSON to a file").option("--patch <path>", "Save the unified diff to a patch file").option("--model <model>", "Model name").option("--provider <provider>", "openai, openai-compatible, or anthropic").option("--agent <profile>", "Repository custom-agent profile").option("--thread-id <id...>", "Only address explicitly selected review-thread IDs").option("--verify <command>", "Allowlisted verification command").option("--re-review", "Re-review the applied patch before reporting success").option("--create-pr", "Push a new branch and open a separate PR/MR; never modify the original branch").option("--stacked-pr", "When creating a GitHub PR, target the current PR branch instead of the default branch").option("--branch <name>", "Branch name when --create-pr is enabled").action(async (prUrl, options) => {
  try {
    const autofix = await autofixPullRequest(prUrl, options.model, { provider: options.provider, repoPath: options.repo, agent: options.agent, threadIds: options.threadId, verify: parseVerificationCommand(options.verify), reReview: options.reReview, createPr: options.createPr, stackedPr: options.stackedPr, branch: options.branch });
    if (options.patch) await writeFile(options.patch, autofix.patch, "utf8");
    if (options.save) await writeFile(options.save, JSON.stringify(autofix, null, 2), "utf8");
    if (options.json) console.log(JSON.stringify(autofix, null, 2));
    else printAutofix(autofix);
    process.exitCode = autofix.trace.verified && (!options.reReview || autofix.trace.reReviewPassed) ? 0 : 2;
  } catch (error) {
    console.error(`MergeProof autofix error: ${error instanceof Error ? error.message : "Autofix failed."}`);
    process.exitCode = 1;
  }
});

program.command("tests").description("Generate a test-only unified diff suggestion").argument("<change-request-url>", "Public change-request URL").option("--json", "Print machine-readable JSON").option("--save <path>", "Save the test suggestion JSON to a file").option("--patch <path>", "Save the unified diff to a patch file").option("--model <model>", "Model name").option("--provider <provider>", "openai, openai-compatible, or anthropic").option("--repo <path>", "Local checkout for repository retrieval").option("--agent <profile>", "Repository custom-agent profile").action(async (prUrl, options) => {
  try {
    const suggestion = await generateTestsPullRequest(prUrl, options.model, { provider: options.provider, repoPath: options.repo, agent: options.agent });
    if (options.patch) await writeFile(options.patch, suggestion.patch, "utf8");
    if (options.save) await writeFile(options.save, JSON.stringify(suggestion, null, 2), "utf8");
    if (options.json) console.log(JSON.stringify(suggestion, null, 2));
    else printTests(suggestion);
  } catch (error) {
    console.error(`MergeProof tests error: ${error instanceof Error ? error.message : "Test generation failed."}`);
    process.exitCode = 1;
  }
});

program.command("docstrings").description("Generate a documentation-only unified diff suggestion").argument("<change-request-url>", "Public change-request URL").option("--json", "Print machine-readable JSON").option("--save <path>", "Save the documentation suggestion JSON to a file").option("--patch <path>", "Save the unified diff to a patch file").option("--model <model>", "Model name").option("--provider <provider>", "openai, openai-compatible, or anthropic").option("--repo <path>", "Local checkout for repository retrieval").option("--agent <profile>", "Repository custom-agent profile").action(async (prUrl, options) => {
  try {
    const suggestion = await generateDocstringsPullRequest(prUrl, options.model, { provider: options.provider, repoPath: options.repo, agent: options.agent });
    if (options.patch) await writeFile(options.patch, suggestion.patch, "utf8");
    if (options.save) await writeFile(options.save, JSON.stringify(suggestion, null, 2), "utf8");
    if (options.json) console.log(JSON.stringify(suggestion, null, 2));
    else printDocstrings(suggestion);
  } catch (error) {
    console.error(`MergeProof docstrings error: ${error instanceof Error ? error.message : "Documentation generation failed."}`);
    process.exitCode = 1;
  }
});

program.command("recipes").description("List repository-scoped named finishing-touch recipes").option("--repo <path>", "Repository path", process.cwd()).option("--json", "Print machine-readable JSON").action(async (options) => {
  try {
    const recipes = await loadRecipes(options.repo);
    if (options.json) console.log(JSON.stringify(recipes, null, 2));
    else console.log(recipes.length ? recipes.map((recipe) => `${recipe.name}: ${recipe.description}`).join("\n") : "No recipes configured. Copy .mergeproof/recipes.example.json to .mergeproof/recipes.json.");
  } catch (error) {
    console.error(`MergeProof recipes error: ${error instanceof Error ? error.message : "Recipe listing failed."}`);
    process.exitCode = 1;
  }
});

program.command("recipe").description("Run a named repository finishing-touch recipe against a change request").argument("<change-request-url>", "Public change-request URL").argument("<recipe-name>", "Name from .mergeproof/recipes.json").option("--json", "Print machine-readable JSON").option("--save <path>", "Save the recipe JSON to a file").option("--patch <path>", "Save the unified diff to a patch file").option("--model <model>", "Model name").option("--provider <provider>", "openai, openai-compatible, or anthropic").option("--repo <path>", "Local checkout to use for retrieval and mutation").option("--agent <profile>", "Repository custom-agent profile").option("--verify <command>", "Sandbox verification command").option("--re-review", "Re-review the recipe patch before reporting success").option("--apply", "Apply the checked patch to the explicit checkout").option("--create-pr", "Push a separate branch and open a GitHub pull request").option("--branch <name>", "Branch name when --create-pr is enabled").action(async (prUrl, recipeName, options) => {
  try {
    const run = await runRecipe(prUrl, recipeName, options.model, { repoPath: options.repo, provider: options.provider, agent: options.agent, verify: parseVerificationCommand(options.verify), reReview: options.reReview, apply: options.apply, createPr: options.createPr, branch: options.branch });
    if (options.patch) await writeFile(options.patch, run.patch, "utf8");
    if (options.save) await writeFile(options.save, JSON.stringify(run, null, 2), "utf8");
    if (options.json) console.log(JSON.stringify(run, null, 2));
    else printRecipe(run);
    process.exitCode = options.createPr && (!run.trace.verified || options.reReview && run.trace.reReviewPassed !== true) ? 2 : 0;
  } catch (error) {
    console.error(`MergeProof recipe error: ${error instanceof Error ? error.message : "Recipe execution failed."}`);
    process.exitCode = 1;
  }
});

program.command("review").description("Review staged, unstaged, and untracked working-tree changes").argument("[repo-path]", "Git repository path", process.cwd()).option("--json", "Print machine-readable JSON").option("--save <path>", "Save the review JSON to a file").option("--model <model>", "Model name").option("--provider <provider>", "openai, openai-compatible, or anthropic").option("--effort <level>", "Review effort: low, medium, or high").option("--profile <profile>", "Review profile: quiet, chill, or assertive").option("--agent <profile>", "Repository custom-agent profile").option("--dir <path...>", "Limit review to one or more repository paths").option("--criteria <criteria>", "Pipe-separated review criteria; defaults to a safe general review").option("--retrieval-top-k <number>", "Maximum repository evidence chunks").option("--hooks", "Run configured safe lifecycle hooks").option("--external-security", "Run npm audit and Semgrep when available").option("--codeql-db <path>", "Run CodeQL against an existing database").option("--codeql-create", "Create a missing CodeQL database before analysis").option("--codeql-languages <languages>", "Comma-separated CodeQL languages").option("--codeql-query <query>", "CodeQL query suite or pack").option("--tool-sarif <path...>", "Ingest existing SARIF output from configured CI/security tools").action(async (repoPath, options) => {
  try {
    const analysis = await reviewWorkingTree(options.model, { repoPath, provider: options.provider, effort: parseReviewEffort(options.effort), profile: options.profile, agent: options.agent, directories: options.dir, criteria: parseCriteria(options.criteria), retrievalTopK: options.retrievalTopK ? Number(options.retrievalTopK) : undefined, hooks: options.hooks, externalSecurity: options.externalSecurity, codeqlDatabase: options.codeqlDb, codeqlCreate: options.codeqlCreate, codeqlLanguages: options.codeqlLanguages, codeqlQuery: options.codeqlQuery, toolSarif: options.toolSarif });
    if (options.save) await writeFile(options.save, JSON.stringify(analysis, null, 2), "utf8");
    if (options.json) console.log(JSON.stringify(analysis, null, 2));
    else printAnalysis(analysis);
    process.exitCode = analysis.decision === "ready" ? 0 : 2;
  } catch (error) {
    console.error(`MergeProof review error: ${error instanceof Error ? error.message : "Working-tree review failed."}`);
    process.exitCode = 1;
  }
});

program.command("security").description("Scan the committed repository tree for deterministic security findings").option("--repo <path>", "Repository path", process.cwd()).option("--json", "Print machine-readable JSON").option("--save <path>", "Save the security report to a file").action(async (options) => {
  try {
    const findings = await scanRepositorySecurity(options.repo);
    const output = { findings, trace: { scope: "repository", scannedAt: new Date().toISOString(), deterministic: true, sensitiveFilesExcluded: true } };
    if (options.save) await writeFile(options.save, JSON.stringify(output, null, 2), "utf8");
    if (options.json) console.log(JSON.stringify(output, null, 2));
    else {
      console.log(`Repository security findings: ${findings.length}`);
      for (const finding of findings) console.log(`[${finding.severity}] ${finding.path}:${finding.line} ${finding.title}`);
    }
  } catch (error) {
    console.error(`MergeProof security error: ${error instanceof Error ? error.message : "Repository security scan failed."}`);
    process.exitCode = 1;
  }
});

program.command("agent").description("Generate and verify a fix inside an ephemeral Git worktree").argument("[repo-path]", "Git repository path", process.cwd()).option("--json", "Print machine-readable JSON").option("--save <path>", "Save the agent run JSON to a file").option("--model <model>", "Model name").option("--provider <provider>", "openai, openai-compatible, or anthropic").option("--effort <level>", "Review effort: low, medium, or high").option("--profile <profile>", "Review profile: quiet, chill, or assertive").option("--agent <profile>", "Repository custom-agent profile").option("--dir <path...>", "Limit review to one or more repository paths").option("--criteria <criteria>", "Pipe-separated review criteria; defaults to a safe general review").option("--retrieval-top-k <number>", "Maximum repository evidence chunks").option("--hooks", "Run configured safe lifecycle hooks").option("--external-security", "Run npm audit and Semgrep when available").option("--codeql-db <path>", "Run CodeQL against an existing database").option("--codeql-create", "Create a missing CodeQL database before analysis").option("--codeql-languages <languages>", "Comma-separated CodeQL languages").option("--codeql-query <query>", "CodeQL query suite or pack").option("--tool-sarif <path...>", "Ingest existing SARIF output from configured CI/security tools").option("--verify <command>", "Sandbox verification: npm test, npm run build, npm run typecheck, pytest, cargo test, or go test ./...").option("--re-review", "Review the verified sandbox patch once before reporting success").action(async (repoPath, options) => {
  try {
    const run = await runLocalAgent(options.model, { repoPath, provider: options.provider, effort: parseReviewEffort(options.effort), profile: options.profile, agent: options.agent, directories: options.dir, criteria: parseCriteria(options.criteria), retrievalTopK: options.retrievalTopK ? Number(options.retrievalTopK) : undefined, hooks: options.hooks, externalSecurity: options.externalSecurity, codeqlDatabase: options.codeqlDb, codeqlCreate: options.codeqlCreate, codeqlLanguages: options.codeqlLanguages, codeqlQuery: options.codeqlQuery, toolSarif: options.toolSarif, verify: parseVerificationCommand(options.verify), reReview: options.reReview });
    if (options.save) await writeFile(options.save, JSON.stringify(run, null, 2), "utf8");
    if (options.json) console.log(JSON.stringify(run, null, 2));
    else printAgent(run);
    const gated = Boolean(options.verify || options.reReview);
    const verificationPassed = !options.verify || run.trace.verified;
    const reReviewPassed = !options.reReview || run.trace.reReviewPassed === true;
    process.exitCode = !gated || verificationPassed && reReviewPassed ? 0 : 2;
  } catch (error) {
    console.error(`MergeProof agent error: ${error instanceof Error ? error.message : "Sandbox agent failed."}`);
    process.exitCode = 1;
  }
});

program.command("task").description("Implement a GitHub issue from retrieved repository evidence in an ephemeral worktree").argument("<github-issue-url>", "GitHub issue URL").requiredOption("--repo <path>", "Local checkout of the target repository").option("--json", "Print machine-readable JSON").option("--save <path>", "Save the task-agent JSON to a file").option("--patch <path>", "Save the unified diff to a patch file").option("--model <model>", "Model name").option("--provider <provider>", "openai, openai-compatible, or anthropic").option("--agent <profile>", "Repository custom-agent profile").option("--retrieval-top-k <number>", "Maximum repository evidence chunks", "10").option("--verify <command>", "Sandbox verification: npm test, npm run build, npm run typecheck, pytest, cargo test, or go test ./...").option("--re-review", "Re-review the sandbox patch before reporting success").option("--create-pr", "Push a separate branch and open a pull request").option("--branch <name>", "Branch name when --create-pr is enabled").action(async (issueUrl, options) => {
  try {
    const run = await runIssueAgent(issueUrl, options.model, { repoPath: options.repo, provider: options.provider, agent: options.agent, retrievalTopK: Number(options.retrievalTopK), verify: parseVerificationCommand(options.verify), reReview: options.reReview, createPr: options.createPr, branch: options.branch });
    if (options.patch) await writeFile(options.patch, run.patch, "utf8");
    if (options.save) await writeFile(options.save, JSON.stringify(run, null, 2), "utf8");
    if (options.json) console.log(JSON.stringify(run, null, 2));
    else printTaskAgent(run);
    process.exitCode = options.createPr && (!run.trace.verified || options.reReview && run.trace.reReviewPassed !== true) ? 2 : 0;
  } catch (error) {
    console.error(`MergeProof task error: ${error instanceof Error ? error.message : "Issue-agent workflow failed."}`);
    process.exitCode = 1;
  }
});

program.command("analyze").description("Analyze a GitHub, GitLab, Bitbucket, or Azure DevOps change request").argument("<change-request-url>", "Public change-request URL").option("--json", "Print machine-readable JSON").option("--save <path>", "Save the JSON analysis to a file").option("--model <model>", "Model name").option("--provider <provider>", "openai, openai-compatible, or anthropic").option("--repo <path>", "Local checkout to use for repository retrieval").option("--related-repo <path...>", "Additional local repositories for read-only context").option("--effort <level>", "Review effort: low, medium, or high").option("--profile <profile>", "Review profile: quiet, chill, or assertive").option("--agent <profile>", "Repository custom-agent profile").option("--retrieval-top-k <number>", "Maximum repository evidence chunks").option("--knowledge-limit <number>", "Maximum approved knowledge facts to include", "12").option("--external-security", "Run npm audit and Semgrep when available").option("--codeql-db <path>", "Run CodeQL against an existing database").option("--codeql-create", "Create a missing CodeQL database before analysis").option("--codeql-languages <languages>", "Comma-separated CodeQL languages").option("--codeql-query <query>", "CodeQL query suite or pack").option("--tool-sarif <path...>", "Ingest existing SARIF output from configured CI/security tools").option("--mcp", "Use explicitly configured read-only MCP context tools").option("--web-search", "Use opt-in Brave or Tavily web-search snippets as external context").option("--hooks", "Run explicitly configured safe lifecycle hooks from .mergeproof/hooks.json").option("--remember", "Persist this review in repository-scoped memory").option("--memory-root <path>", "Memory repository root").option("--memory-limit <number>", "Prior memory entries to provide", "5").option("--publish-check", "Publish the result as a GitHub Check").option("--publish-review", "Publish a pull-request review or fallback comment").option("--request-reviewers <reviewer...>", "Explicitly request GitHub users or team:<slug> reviewers").option("--apply-labels", "Apply deterministic suggested labels to a GitHub pull request").option("--slack-webhook <url>", "Post a summary to a Slack incoming webhook").option("--create-jira", "Create a Jira follow-up for non-passing criteria").option("--create-linear", "Create a Linear follow-up for non-passing criteria").option("--create-gitlab-issue", "Create one GitLab follow-up issue from unresolved findings").option("--create-github-issue", "Create one GitHub follow-up issue from unresolved findings").option("--github-issue-title <title>", "Title for the created GitHub issue").action(async (prUrl, options) => {
  try {
    const analysis = await analyzePullRequest(prUrl, options.model, { provider: options.provider, repoPath: options.repo, relatedRepos: options.relatedRepo, effort: parseReviewEffort(options.effort), profile: options.profile, agent: options.agent, retrievalTopK: options.retrievalTopK ? Number(options.retrievalTopK) : undefined, remember: options.remember, memoryRoot: options.memoryRoot, memoryLimit: Number(options.memoryLimit), knowledgeLimit: Number(options.knowledgeLimit), externalSecurity: options.externalSecurity, codeqlDatabase: options.codeqlDb, codeqlCreate: options.codeqlCreate, codeqlLanguages: options.codeqlLanguages, codeqlQuery: options.codeqlQuery, toolSarif: options.toolSarif, mcp: options.mcp, webSearch: options.webSearch, hooks: options.hooks });
    if (options.publishCheck) console.error(`Change Check: ${await publishChangeRequestCheck(prUrl, analysis)}`);
    if (options.publishReview) console.error(`Change Review: ${await publishChangeRequestReview(prUrl, analysis)}`);
    if (options.requestReviewers) console.error(`Reviewers requested: ${await requestPullRequestReviewers(prUrl, options.requestReviewers)}`);
    if (options.applyLabels) {
      if (!analysis.walkthrough?.suggestedLabels.length) console.error("No deterministic labels were suggested.");
      else console.error(`Labels applied: ${await applyPullRequestLabels(prUrl, analysis.walkthrough.suggestedLabels)}`);
    }
    if (options.slackWebhook) await publishSlackSummary(options.slackWebhook, prUrl, analysis);
    if (options.createJira) {
      const findings = analysis.rows.filter((row) => row.state !== "pass").map((row) => `${row.state.toUpperCase()}: ${row.criterion}\n${row.evidence}`).join("\n\n") || "MergeProof found no failing criteria; review the analysis trace.";
      console.error(`Jira issue: ${await createJiraIssue(`MergeProof follow-up for ${prUrl}`, findings)}`);
    }
    if (options.createLinear) {
      const findings = analysis.rows.filter((row) => row.state !== "pass").map((row) => `${row.state.toUpperCase()}: ${row.criterion}\n${row.evidence}`).join("\n\n") || "MergeProof found no failing criteria; review the analysis trace.";
      console.error(`Linear issue: ${await createLinearIssue(`MergeProof follow-up for ${prUrl}`, findings)}`);
    }
    if (options.createGitlabIssue) {
      const findings = analysis.rows.filter((row) => row.state !== "pass").map((row) => `${row.state.toUpperCase()}: ${row.criterion}\n${row.evidence}`).join("\n\n") || "MergeProof found no failing criteria; review the analysis trace.";
      console.error(`GitLab issue: ${await createGitLabIssue(prUrl, `MergeProof follow-up for ${prUrl}`, findings)}`);
    }
    if (options.createGithubIssue) console.error(`GitHub issue: ${await createGithubIssueFromAnalysis(prUrl, analysis, options.githubIssueTitle)}`);
    if (options.save) {
      await writeFile(options.save, JSON.stringify(analysis, null, 2), "utf8");
      console.error(`Analysis saved: ${options.save}`);
    }
    if (options.json) console.log(JSON.stringify(analysis, null, 2));
    else printAnalysis(analysis);
    process.exitCode = analysis.decision === "ready" ? 0 : 2;
  } catch (error) {
    console.error(`MergeProof error: ${error instanceof Error ? error.message : "Analysis failed."}`);
    process.exitCode = 1;
  }
});

program.command("implement").description("Implement a natural-language request in a clean local repository using bounded evidence and a verified sandbox").argument("<request...>", "Implementation request").requiredOption("--repo <path>", "Local checkout of the target repository").option("--json", "Print machine-readable JSON").option("--save <path>", "Save the implementation run JSON to a file").option("--patch <path>", "Save the unified diff to a patch file").option("--model <model>", "Model name").option("--provider <provider>", "openai, openai-compatible, or anthropic").option("--agent <profile>", "Repository custom-agent profile").option("--retrieval-top-k <number>", "Maximum repository evidence chunks", "10").option("--verify <command>", "Sandbox verification: npm test, npm run build, npm run typecheck, pytest, cargo test, or go test ./...").option("--re-review", "Re-review the sandbox patch before reporting success").option("--apply", "Apply only after explicit verification, and after optional re-review passes").action(async (request, options) => {
  try {
    const run = await runImplementationAgent(request.join(" "), options.model, { repoPath: options.repo, provider: options.provider, agent: options.agent, retrievalTopK: Number(options.retrievalTopK), verify: parseVerificationCommand(options.verify), reReview: options.reReview, apply: options.apply });
    if (options.patch) await writeFile(options.patch, run.patch, "utf8");
    if (options.save) await writeFile(options.save, JSON.stringify(run, null, 2), "utf8");
    if (options.json) console.log(JSON.stringify(run, null, 2));
    else printImplementation(run);
    const gated = Boolean(options.verify || options.reReview || options.apply);
    const verificationPassed = !options.verify || run.trace.verified;
    const reReviewPassed = !options.reReview || run.trace.reReviewPassed === true;
    process.exitCode = !gated || verificationPassed && reReviewPassed ? 0 : 2;
  } catch (error) {
    console.error(`MergeProof implement error: ${error instanceof Error ? error.message : "Implementation agent failed."}`);
    process.exitCode = 1;
  }
});

program.parseAsync().catch(() => { process.exitCode = 1; });
