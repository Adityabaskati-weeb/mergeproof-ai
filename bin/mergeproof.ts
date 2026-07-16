#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { analyzePullRequest } from "../lib/analyze";
import type { Analysis } from "../lib/types";

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
  console.log(`Unsupported claims: ${analysis.trace.unsupportedClaims} | Analysis time: ${analysis.trace.elapsedMs}ms\n`);
}

const program = new Command();
program.name("mergeproof").description("Evidence-backed merge decisions for GitHub pull requests").version("0.2.0");
program.command("analyze").description("Analyze a GitHub pull request").argument("<pr-url>", "Public GitHub pull request URL").option("--json", "Print machine-readable JSON").option("--model <model>", "Model provider model name").action(async (prUrl, options) => {
  try {
    const analysis = await analyzePullRequest(prUrl, options.model);
    if (options.json) console.log(JSON.stringify(analysis, null, 2));
    else printAnalysis(analysis);
    process.exitCode = analysis.decision === "ready" ? 0 : 2;
  } catch (error) {
    console.error(`MergeProof error: ${error instanceof Error ? error.message : "Analysis failed."}`);
    process.exitCode = 1;
  }
});
program.parseAsync().catch(() => { process.exitCode = 1; });
