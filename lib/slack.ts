import type { Analysis } from "./types";

export async function publishSlackSummary(webhookUrl: string, prUrl: string, analysis: Analysis): Promise<void> {
  const security = (analysis.securityFindings ?? []).map((finding) => `:rotating_light: ${finding.severity.toUpperCase()} ${finding.path}:${finding.line} ${finding.title}`).join("\n");
  const response = await fetch(webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `MergeProof *${analysis.decision}* for <${prUrl}|pull request>\n${security ? `${security}\n` : ""}${analysis.rows.map((row) => `${row.state === "pass" ? ":white_check_mark:" : ":warning:"} ${row.criterion}`).join("\n")}\nModel: ${analysis.trace.model} | Citations verified: ${analysis.trace.citedSources}` }) });
  if (!response.ok) throw new Error(`Slack webhook failed with HTTP ${response.status}.`);
}
