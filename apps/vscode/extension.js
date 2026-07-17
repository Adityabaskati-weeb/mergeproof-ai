const vscode = require("vscode");
const { execFile } = require("node:child_process");

function runMergeProof(command, url, cwd) {
  const configuredPath = vscode.workspace.getConfiguration("mergeproof").get("cliPath");
  const executable = configuredPath || (process.platform === "win32" ? "npm.cmd" : "npm");
  const repoArgs = command === "analyze" || command === "consensus" || command === "walkthrough" || command === "docstrings" || command === "fix" || command === "simplify" || command === "tests" || command === "autofix" || command === "task" || command === "work-plan" ? ["--repo", cwd] : [];
  const args = configuredPath ? [command, url, "--json", ...repoArgs] : ["run", "cli", "--", command, url, "--", "--json", ...repoArgs];
  return new Promise((resolve, reject) => execFile(executable, args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
    const jsonStart = stdout.indexOf("{");
    const json = jsonStart >= 0 ? stdout.slice(jsonStart).trim() : "";
    if (!json) return reject(new Error(stderr.trim() || error?.message || "MergeProof returned no JSON."));
    try { resolve(JSON.parse(json)); } catch { reject(new Error(stderr.trim() || "MergeProof returned invalid JSON.")); }
  }));
}

async function analyze(command) {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) return vscode.window.showErrorMessage("Open a repository folder before running MergeProof.");
  const url = await vscode.window.showInputBox({ prompt: "Pull request or Jira/Linear issue URL", placeHolder: "https://github.com/owner/repo/pull/123" });
  if (!url) return;
  const channel = vscode.window.createOutputChannel("MergeProof");
  channel.show(true);
  try {
    const result = await runMergeProof(command, url, folder);
    channel.appendLine(JSON.stringify(result, null, 2));
    vscode.window.showInformationMessage(`MergeProof: ${result.decision || "plan generated"}`);
  } catch (error) {
    channel.appendLine(String(error));
    vscode.window.showErrorMessage(`MergeProof failed: ${error.message}`);
  }
}

async function reviewWorkingTree() {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) return vscode.window.showErrorMessage("Open a repository folder before running MergeProof.");
  const channel = vscode.window.createOutputChannel("MergeProof");
  channel.show(true);
  try {
    const result = await runMergeProof("review", folder, folder);
    channel.appendLine(JSON.stringify(result, null, 2));
    vscode.window.showInformationMessage(`MergeProof: ${result.decision || "review generated"}`);
  } catch (error) {
    channel.appendLine(String(error));
    vscode.window.showErrorMessage(`MergeProof failed: ${error.message}`);
  }
}

async function resolveConflicts() {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) return vscode.window.showErrorMessage("Open a repository folder before resolving conflicts.");
  const channel = vscode.window.createOutputChannel("MergeProof");
  channel.show(true);
  try {
    const result = await runMergeProof("conflicts", folder, folder);
    channel.appendLine(JSON.stringify(result, null, 2));
    vscode.window.showInformationMessage(`MergeProof conflicts: ${result.conflictCount ?? result.trace?.changedPaths?.length ?? 0} detected`);
  } catch (error) {
    channel.appendLine(String(error));
    vscode.window.showErrorMessage(`MergeProof conflict inspection failed: ${error.message}`);
  }
}

async function runSandboxAgent() {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) return vscode.window.showErrorMessage("Open a repository folder before running MergeProof.");
  const channel = vscode.window.createOutputChannel("MergeProof");
  channel.show(true);
  try {
    const result = await runMergeProof("agent", folder, folder);
    channel.appendLine(JSON.stringify(result, null, 2));
    vscode.window.showInformationMessage(`MergeProof agent: ${result.trace?.verified ? "verification passed" : "sandbox run complete"}`);
  } catch (error) {
    channel.appendLine(String(error));
    vscode.window.showErrorMessage(`MergeProof agent failed: ${error.message}`);
  }
}

async function implementIssue() {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) return vscode.window.showErrorMessage("Open a clean repository folder before implementing an issue.");
  const issueUrl = await vscode.window.showInputBox({ prompt: "GitHub issue URL", placeHolder: "https://github.com/owner/repo/issues/123" });
  if (!issueUrl) return;
  const channel = vscode.window.createOutputChannel("MergeProof");
  channel.show(true);
  try {
    const result = await runMergeProof("task", issueUrl, folder);
    channel.appendLine(JSON.stringify(result, null, 2));
    vscode.window.showInformationMessage(`MergeProof issue agent: ${result.trace?.verified ? "verification passed" : "patch suggested"}`);
  } catch (error) {
    channel.appendLine(String(error));
    vscode.window.showErrorMessage(`MergeProof issue agent failed: ${error.message}`);
  }
}

async function generateWorkPlan() {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) return vscode.window.showErrorMessage("Open a repository folder before generating a work plan.");
  const request = await vscode.window.showInputBox({ prompt: "PRD, design, issue text, or free-form work request", placeHolder: "Add rate limiting to the public API" });
  if (!request) return;
  const channel = vscode.window.createOutputChannel("MergeProof");
  channel.show(true);
  try {
    const result = await runMergeProof("work-plan", request, folder);
    channel.appendLine(JSON.stringify(result, null, 2));
    vscode.window.showInformationMessage(`MergeProof work plan: ${result.steps?.length ?? 0} steps, ${result.trace?.citedSources ?? 0} citations`);
  } catch (error) {
    channel.appendLine(String(error));
    vscode.window.showErrorMessage(`MergeProof work plan failed: ${error.message}`);
  }
}

function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand("mergeproof.analyzePullRequest", () => analyze("analyze")));
  context.subscriptions.push(vscode.commands.registerCommand("mergeproof.consensus", () => analyze("consensus")));
  context.subscriptions.push(vscode.commands.registerCommand("mergeproof.reviewWorkingTree", reviewWorkingTree));
  context.subscriptions.push(vscode.commands.registerCommand("mergeproof.resolveConflicts", resolveConflicts));
  context.subscriptions.push(vscode.commands.registerCommand("mergeproof.runSandboxAgent", runSandboxAgent));
  context.subscriptions.push(vscode.commands.registerCommand("mergeproof.implementIssue", implementIssue));
  context.subscriptions.push(vscode.commands.registerCommand("mergeproof.generatePlan", () => analyze("plan")));
  context.subscriptions.push(vscode.commands.registerCommand("mergeproof.generateWorkPlan", generateWorkPlan));
  context.subscriptions.push(vscode.commands.registerCommand("mergeproof.generateWalkthrough", () => analyze("walkthrough")));
  context.subscriptions.push(vscode.commands.registerCommand("mergeproof.resolveReviewThreads", () => analyze("resolve")));
  context.subscriptions.push(vscode.commands.registerCommand("mergeproof.generateDocstrings", () => analyze("docstrings")));
  context.subscriptions.push(vscode.commands.registerCommand("mergeproof.suggestFix", () => analyze("fix")));
  context.subscriptions.push(vscode.commands.registerCommand("mergeproof.simplify", () => analyze("simplify")));
  context.subscriptions.push(vscode.commands.registerCommand("mergeproof.generateTests", () => analyze("tests")));
  context.subscriptions.push(vscode.commands.registerCommand("mergeproof.autofix", () => analyze("autofix")));
}

module.exports = { activate, deactivate() {} };
