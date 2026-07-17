import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { setFindingDisposition, type StoredFinding } from "./findings";

export function renderInteractiveFinding(finding: StoredFinding, index: number, total: number): string {
  return [
    `Finding ${index + 1}/${total} [${finding.severity.toUpperCase()}] ${finding.disposition === "ignored" ? "IGNORED" : "OPEN"}`,
    `${finding.fileName}${finding.line ? `:${finding.line}` : ""} - ${finding.criterion}`,
    finding.comment,
    finding.codegenInstructions ? `Fix: ${finding.codegenInstructions}` : "",
    "Commands: Enter/n next, p previous, i ignore, r restore, q quit",
  ].filter(Boolean).join("\n");
}

export async function runInteractiveReview(repository: string, findings: StoredFinding[]): Promise<void> {
  if (!findings.length) {
    console.log("No persisted findings for this review.");
    return;
  }
  const session = readline.createInterface({ input, output, terminal: Boolean(input.isTTY) });
  let index = 0;
  try {
    while (true) {
      console.log(`\n${renderInteractiveFinding(findings[index], index, findings.length)}`);
      const command = (await session.question("review> ")).trim().toLowerCase();
      if (command === "q" || command === "quit" || command === "exit") break;
      if (command === "p" || command === "prev") index = (index - 1 + findings.length) % findings.length;
      else if (command === "i" || command === "ignore") {
        findings[index] = await setFindingDisposition(repository, findings[index].id, "ignored");
        console.log(`Ignored ${findings[index].id}.`);
        index = (index + 1) % findings.length;
      } else if (command === "r" || command === "restore") {
        findings[index] = await setFindingDisposition(repository, findings[index].id, "open");
        console.log(`Restored ${findings[index].id}.`);
      } else index = (index + 1) % findings.length;
    }
  } finally {
    session.close();
  }
}
