#!/usr/bin/env node
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { Command } from "commander";
import { analyzePullRequest } from "../lib/analyze";
import { evaluateAnalysis } from "../lib/evaluation";
import { fixPullRequest } from "../lib/fix";
import { publishPullRequestCheck } from "../lib/github-publish";
import { publishPullRequestReview } from "../lib/github-review";
import { createJiraIssue } from "../lib/issues";
import { indexRepository } from "../lib/retrieval";
import { planPullRequest } from "../lib/plan";
import { publishSlackSummary } from "../lib/slack";
import { readRepositoryMemory } from "../lib/memory";
import { startGithubWebhookServer } from "../lib/webhook";
import { createGithubIssueFromAnalysis } from "../lib/github-issues";
import { generateTestsPullRequest, type TestSuggestion } from "../lib/tests";
import type { Analysis } from "../lib/types";
import type { ReviewPlan } from "../lib/models";
import type { FixSuggestion } from "../lib/fix";

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
  if (analysis.securityFindings?.length) {
    console.log(`Security findings: ${analysis.securityFindings.length}`);
    for (const finding of analysis.securityFindings) console.log(`    [${finding.severity}] ${finding.path}:${finding.line} ${finding.title}`);
  }
  if (analysis.trace.memory?.enabled) console.log(`Review memory: ${analysis.trace.memory.matchedEntries} matched | stored: ${analysis.trace.memory.stored ? "yes" : "no"}`);
  console.log();
}

function printPlan(plan: ReviewPlan) {
  console.log(`\nMERGEPROOF PLAN (${plan.trace.model})\n\n${plan.summary}\n`);
  if (plan.risks.length) console.log(`Risks:\n${plan.risks.map((risk) => `- [${risk.severity}] ${risk.risk}`).join("\n")}\n`);
  console.log(`Steps:\n${plan.steps.map((step, index) => `${index + 1}. ${step.title}\n   ${step.detail}${step.citations.length ? `\n   Evidence: ${step.citations.map((citation) => citation.url).join(", ")}` : ""}`).join("\n")}`);
  console.log(`\nCitations verified: ${plan.trace.citedSources}/${plan.trace.fetchedSources}\n`);
}

function printFix(fix: FixSuggestion) {
  console.log(`\nMERGEPROOF FIX (${fix.trace.model})\n\n${fix.summary}\n`);
  console.log(fix.patch || "No patch was proposed.");
  console.log(`\nApplied: ${fix.trace.applied ? "yes" : "no"}\n`);
}

function printTests(suggestion: TestSuggestion) {
  console.log(`\nMERGEPROOF TESTS (${suggestion.trace.model})\n\n${suggestion.summary}\n`);
  console.log(suggestion.patch || "No test patch was proposed.");
  console.log(`\nChanged test paths: ${suggestion.trace.changedPaths.join(", ") || "none"}\n`);
}

const program = new Command();
program.name("mergeproof").description("Evidence-backed merge decisions for GitHub pull requests").version("0.3.0");

program.command("index").description("Build a local repository evidence index").argument("[repo-path]", "Repository path", process.cwd()).action(async (repoPath) => {
  const result = await indexRepository(repoPath);
  console.log(JSON.stringify({ indexPath: result.path, commitSha: result.index.commitSha, chunks: result.index.chunks.length }, null, 2));
});

program.command("evaluate").description("Measure evidence coverage for a saved JSON analysis").argument("<analysis-json>", "Path to analysis JSON").action(async (analysisPath) => {
  const analysis = JSON.parse(await readFile(analysisPath, "utf8")) as Analysis;
  console.log(JSON.stringify(evaluateAnalysis(analysis), null, 2));
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

program.command("serve").description("Run GitHub and optional Slack webhook receivers").option("--host <host>", "Bind host", process.env.MERGEPROOF_WEBHOOK_HOST || "127.0.0.1").option("--port <number>", "Bind port", process.env.MERGEPROOF_WEBHOOK_PORT || "8787").option("--secret <secret>", "GitHub webhook signing secret", process.env.GITHUB_WEBHOOK_SECRET).option("--slack-signing-secret <secret>", "Slack signing secret", process.env.SLACK_SIGNING_SECRET).option("--repo <path>", "Local repository path for retrieval and memory").option("--model <model>", "Model name").option("--provider <provider>", "openai, openai-compatible, or anthropic").option("--publish-review", "Publish a PR review in addition to the GitHub Check").action(async (options) => {
  try {
    const server = startGithubWebhookServer({ secret: options.secret, slackSigningSecret: options.slackSigningSecret, host: options.host, port: Number(options.port), repoPath: options.repo, model: options.model, provider: options.provider, publishReview: options.publishReview, log: (message) => console.error(message) });
    console.error(`MergeProof webhook listening on http://${options.host}:${options.port}/github/webhook and /slack/commands`);
    await new Promise<void>((resolve, reject) => { server.on("error", reject); server.on("close", resolve); });
  } catch (error) {
    console.error(`MergeProof serve error: ${error instanceof Error ? error.message : "Webhook server failed."}`);
    process.exitCode = 1;
  }
});

program.command("plan").description("Generate a citation-aware implementation plan for a pull request").argument("<pr-url>", "Public GitHub pull request URL").option("--json", "Print machine-readable JSON").option("--save <path>", "Save the plan JSON to a file").option("--model <model>", "Model name").option("--provider <provider>", "openai, openai-compatible, or anthropic").action(async (prUrl, options) => {
  try {
    const plan = await planPullRequest(prUrl, options.model, options.provider);
    if (options.save) await writeFile(options.save, JSON.stringify(plan, null, 2), "utf8");
    if (options.json) console.log(JSON.stringify(plan, null, 2));
    else printPlan(plan);
  } catch (error) {
    console.error(`MergeProof plan error: ${error instanceof Error ? error.message : "Planning failed."}`);
    process.exitCode = 1;
  }
});

program.command("fix").description("Suggest or explicitly apply a validated unified diff").argument("<pr-url>", "Public GitHub pull request URL").option("--json", "Print machine-readable JSON").option("--save <path>", "Save the fix JSON to a file").option("--patch <path>", "Save the unified diff to a patch file").option("--model <model>", "Model name").option("--provider <provider>", "openai, openai-compatible, or anthropic").option("--repo <path>", "Local checkout to validate").option("--apply", "Apply only after git apply --check succeeds").action(async (prUrl, options) => {
  try {
    const fix = await fixPullRequest(prUrl, options.model, { provider: options.provider, repoPath: options.repo, apply: options.apply });
    if (options.patch) await writeFile(options.patch, fix.patch, "utf8");
    if (options.save) await writeFile(options.save, JSON.stringify(fix, null, 2), "utf8");
    if (options.json) console.log(JSON.stringify(fix, null, 2));
    else printFix(fix);
  } catch (error) {
    console.error(`MergeProof fix error: ${error instanceof Error ? error.message : "Fix generation failed."}`);
    process.exitCode = 1;
  }
});

program.command("tests").description("Generate a test-only unified diff suggestion").argument("<pr-url>", "Public GitHub pull request URL").option("--json", "Print machine-readable JSON").option("--save <path>", "Save the test suggestion JSON to a file").option("--patch <path>", "Save the unified diff to a patch file").option("--model <model>", "Model name").option("--provider <provider>", "openai, openai-compatible, or anthropic").option("--repo <path>", "Local checkout for repository retrieval").action(async (prUrl, options) => {
  try {
    const suggestion = await generateTestsPullRequest(prUrl, options.model, { provider: options.provider, repoPath: options.repo });
    if (options.patch) await writeFile(options.patch, suggestion.patch, "utf8");
    if (options.save) await writeFile(options.save, JSON.stringify(suggestion, null, 2), "utf8");
    if (options.json) console.log(JSON.stringify(suggestion, null, 2));
    else printTests(suggestion);
  } catch (error) {
    console.error(`MergeProof tests error: ${error instanceof Error ? error.message : "Test generation failed."}`);
    process.exitCode = 1;
  }
});

program.command("analyze").description("Analyze a GitHub pull request").argument("<pr-url>", "Public GitHub pull request URL").option("--json", "Print machine-readable JSON").option("--save <path>", "Save the JSON analysis to a file").option("--model <model>", "Model name").option("--provider <provider>", "openai, openai-compatible, or anthropic").option("--repo <path>", "Local checkout to use for repository retrieval").option("--retrieval-top-k <number>", "Maximum repository evidence chunks", "8").option("--remember", "Persist this review in repository-scoped memory").option("--memory-root <path>", "Memory repository root").option("--memory-limit <number>", "Prior memory entries to provide", "5").option("--publish-check", "Publish the result as a GitHub Check").option("--publish-review", "Publish a pull-request review or fallback comment").option("--slack-webhook <url>", "Post a summary to a Slack incoming webhook").option("--create-jira", "Create a Jira follow-up for non-passing criteria").option("--create-github-issue", "Create one GitHub follow-up issue from unresolved findings").option("--github-issue-title <title>", "Title for the created GitHub issue").action(async (prUrl, options) => {
  try {
    const analysis = await analyzePullRequest(prUrl, options.model, { provider: options.provider, repoPath: options.repo, retrievalTopK: Number(options.retrievalTopK), remember: options.remember, memoryRoot: options.memoryRoot, memoryLimit: Number(options.memoryLimit) });
    if (options.publishCheck) console.error(`GitHub Check: ${await publishPullRequestCheck(prUrl, analysis)}`);
    if (options.publishReview) console.error(`GitHub Review: ${await publishPullRequestReview(prUrl, analysis)}`);
    if (options.slackWebhook) await publishSlackSummary(options.slackWebhook, prUrl, analysis);
    if (options.createJira) {
      const findings = analysis.rows.filter((row) => row.state !== "pass").map((row) => `${row.state.toUpperCase()}: ${row.criterion}\n${row.evidence}`).join("\n\n") || "MergeProof found no failing criteria; review the analysis trace.";
      console.error(`Jira issue: ${await createJiraIssue(`MergeProof follow-up for ${prUrl}`, findings)}`);
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

program.parseAsync().catch(() => { process.exitCode = 1; });
