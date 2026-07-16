const vscode = require("vscode");
const { execFile } = require("node:child_process");

function runMergeProof(command, url, cwd) {
  const configuredPath = vscode.workspace.getConfiguration("mergeproof").get("cliPath");
  const executable = configuredPath || (process.platform === "win32" ? "npm.cmd" : "npm");
  const repoArgs = command === "analyze" || command === "fix" || command === "tests" ? ["--repo", cwd] : [];
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
  const url = await vscode.window.showInputBox({ prompt: "GitHub pull request URL", placeHolder: "https://github.com/owner/repo/pull/123" });
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

function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand("mergeproof.analyzePullRequest", () => analyze("analyze")));
  context.subscriptions.push(vscode.commands.registerCommand("mergeproof.generatePlan", () => analyze("plan")));
  context.subscriptions.push(vscode.commands.registerCommand("mergeproof.suggestFix", () => analyze("fix")));
  context.subscriptions.push(vscode.commands.registerCommand("mergeproof.generateTests", () => analyze("tests")));
}

module.exports = { activate, deactivate() {} };
