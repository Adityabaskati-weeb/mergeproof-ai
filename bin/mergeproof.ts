#!/usr/bin/env node
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { Command } from "commander";
import { analyzePullRequest } from "../lib/analyze";
import { evaluateAnalysis } from "../lib/evaluation";
import { publishPullRequestCheck } from "../lib/github-publish";
import { publishPullRequestReview } from "../lib/github-review";
import { createJiraIssue } from "../lib/issues";
import { indexRepository } from "../lib/retrieval";
import { planPullRequest } from "../lib/plan";
import { publishSlackSummary } from "../lib/slack";
import type { Analysis } from "../lib/types";
import type { ReviewPlan } from "../lib/models";

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
  console.log();
}

function printPlan(plan: ReviewPlan) {
  console.log(`\nMERGEPROOF PLAN (${plan.trace.model})\n\n${plan.summary}\n`);
  if (plan.risks.length) console.log(`Risks:\n${plan.risks.map((risk) => `- [${risk.severity}] ${risk.risk}`).join("\n")}\n`);
  console.log(`Steps:\n${plan.steps.map((step, index) => `${index + 1}. ${step.title}\n   ${step.detail}${step.citations.length ? `\n   Evidence: ${step.citations.map((citation) => citation.url).join(", ")}` : ""}`).join("\n")}`);
  console.log(`\nCitations verified: ${plan.trace.citedSources}/${plan.trace.fetchedSources}\n`);
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

program.command("analyze").description("Analyze a GitHub pull request").argument("<pr-url>", "Public GitHub pull request URL").option("--json", "Print machine-readable JSON").option("--save <path>", "Save the JSON analysis to a file").option("--model <model>", "Model name").option("--provider <provider>", "openai, openai-compatible, or anthropic").option("--repo <path>", "Local checkout to use for repository retrieval").option("--retrieval-top-k <number>", "Maximum repository evidence chunks", "8").option("--publish-check", "Publish the result as a GitHub Check").option("--publish-review", "Publish a pull-request review or fallback comment").option("--slack-webhook <url>", "Post a summary to a Slack incoming webhook").option("--create-jira", "Create a Jira follow-up for non-passing criteria").action(async (prUrl, options) => {
  try {
    const analysis = await analyzePullRequest(prUrl, options.model, { provider: options.provider, repoPath: options.repo, retrievalTopK: Number(options.retrievalTopK) });
    if (options.publishCheck) console.error(`GitHub Check: ${await publishPullRequestCheck(prUrl, analysis)}`);
    if (options.publishReview) console.error(`GitHub Review: ${await publishPullRequestReview(prUrl, analysis)}`);
    if (options.slackWebhook) await publishSlackSummary(options.slackWebhook, prUrl, analysis);
    if (options.createJira) {
      const findings = analysis.rows.filter((row) => row.state !== "pass").map((row) => `${row.state.toUpperCase()}: ${row.criterion}\n${row.evidence}`).join("\n\n") || "MergeProof found no failing criteria; review the analysis trace.";
      console.error(`Jira issue: ${await createJiraIssue(`MergeProof follow-up for ${prUrl}`, findings)}`);
    }
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
