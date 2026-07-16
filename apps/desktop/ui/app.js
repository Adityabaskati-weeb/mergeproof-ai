const input = document.querySelector("#pr-url");
const button = document.querySelector("#run");
const empty = document.querySelector("#empty");
const result = document.querySelector("#result");
const model = document.querySelector("#model");
const provider = document.querySelector("#provider");
const action = document.querySelector("#action");
const repo = document.querySelector("#repo");
const apply = document.querySelector("#apply");
const remember = document.querySelector("#remember");
const criteria = document.querySelector("#criteria");
const targetLabel = document.querySelector("#target-label");
const verify = document.querySelector("#verify");
const externalSecurity = document.querySelector("#external-security");
const codeqlDatabase = document.querySelector("#codeql-db");
const mcp = document.querySelector("#mcp");
const webSearch = document.querySelector("#web-search");
const effort = document.querySelector("#effort");
const directories = document.querySelector("#directories");
const reReview = document.querySelector("#re-review");
const agentProfile = document.querySelector("#agent-profile");
const relatedRepos = document.querySelector("#related-repos");

function updateActionLabel() {
  const labels = { analyze: "Analyze change", review: "Review local changes", agent: "Sandbox fix and verify", autofix: "Review-thread autofix", plan: "Generate plan", fix: "Suggest safe fix", tests: "Generate tests" };
  button.innerHTML = `${labels[action.value]} <span>&rarr;</span>`;
  const local = action.value === "review" || action.value === "agent";
  targetLabel.textContent = local ? "Repository path" : action.value === "plan" ? "Change request or issue" : "GitHub pull request";
  input.placeholder = local ? "C:\\path\\to\\repository" : "https://github.com/owner/repo/pull/123";
  apply.disabled = action.value !== "fix";
  if (action.value !== "fix") apply.checked = false;
  remember.disabled = action.value !== "analyze";
  if (action.value !== "analyze") remember.checked = false;
  verify.disabled = !["agent", "autofix"].includes(action.value);
  if (action.value !== "agent") verify.value = "";
  externalSecurity.disabled = !["analyze", "review", "agent"].includes(action.value);
  if (externalSecurity.disabled) externalSecurity.checked = false;
  codeqlDatabase.disabled = !["analyze", "review", "agent"].includes(action.value);
  if (codeqlDatabase.disabled) codeqlDatabase.value = "";
  mcp.disabled = action.value !== "analyze";
  if (mcp.disabled) mcp.checked = false;
  webSearch.disabled = action.value !== "analyze";
  if (webSearch.disabled) webSearch.checked = false;
  directories.disabled = !["review", "agent"].includes(action.value);
  if (directories.disabled) directories.value = "";
  reReview.disabled = !["agent", "autofix"].includes(action.value);
  if (reReview.disabled) reReview.checked = false;
  relatedRepos.disabled = action.value !== "analyze";
  if (relatedRepos.disabled) relatedRepos.value = "";
}

action.addEventListener("change", updateActionLabel);
updateActionLabel();

provider.addEventListener("change", () => {
  if (provider.value === "anthropic" && model.value.startsWith("gpt")) model.value = "claude-sonnet-4-20250514";
  if (provider.value !== "anthropic" && model.value.startsWith("claude")) model.value = "gpt-5.6";
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

button.addEventListener("click", async () => {
  const target = action.value === "review" || action.value === "agent" ? (input.value.trim() || repo.value.trim()) : input.value.trim();
  if (!target) return;
  button.disabled = true;
  button.textContent = "Working...";
  result.classList.add("hidden");
  try {
    const output = await window.__TAURI__.core.invoke("run_cli", { commandName: action.value, prUrl: target, model: model.value || null, provider: provider.value || null, effort: effort.value || null, agent: agentProfile.value || null, directories: directories.value || null, relatedRepos: relatedRepos.value || null, repoPath: action.value === "review" || action.value === "agent" ? null : (repo.value || null), criteria: criteria.value || null, verify: verify.value || null, externalSecurity: externalSecurity.checked, codeqlDatabase: codeqlDatabase.value || null, mcp: mcp.checked, webSearch: webSearch.checked, apply: apply.checked, remember: remember.checked, reReview: reReview.checked });
    empty.classList.add("hidden");
    if (action.value === "analyze" || action.value === "review") {
      const retrieval = output.trace.retrieval?.enabled ? ` &middot; ${output.trace.retrieval.selectedChunks}/${output.trace.retrieval.indexedChunks} repository chunks` : "";
      const security = (output.securityFindings || []).map((finding) => `<div class="row security"><span>${escapeHtml(finding.title)}</span><code>${escapeHtml(finding.path)}:${escapeHtml(finding.line)}</code><span class="badge">${escapeHtml(finding.severity.toUpperCase())}</span></div>`).join("");
      result.innerHTML = `<h2>${escapeHtml(output.decision.replaceAll("-", " ").toUpperCase())}</h2><p>Model: ${escapeHtml(output.trace.model)} &middot; Effort: ${escapeHtml(output.trace.reviewEffort || "medium")} &middot; ${output.trace.citedSources} cited sources${retrieval} &middot; ${output.trace.elapsedMs}ms</p>${security ? `<h3>Security gate</h3><div class="evidence">${security}</div>` : ""}<div class="evidence">${output.rows.map((row) => `<div class="row"><span>${escapeHtml(row.criterion)}</span><code>${escapeHtml(row.citations[0]?.path ?? "No citation")}</code><span class="badge">${escapeHtml(row.state.toUpperCase())}</span></div>`).join("")}</div>`;
    } else if (action.value === "agent" || action.value === "autofix") {
      const title = action.value === "autofix" ? "REVIEW-THREAD AUTOFIX" : `SANDBOX AGENT ${output.trace.verified && output.trace.reReviewPassed !== false ? "VERIFIED" : "SUGGESTED"}`;
      const detail = action.value === "autofix" ? `Unresolved threads: ${output.trace.unresolvedThreads ?? 0}${output.trace.pullRequestUrl ? ` &middot; Created PR: ${escapeHtml(output.trace.pullRequestUrl)}` : ""}` : `${output.trace.changedPaths.length} changed paths &middot; ${output.trace.verificationCommand ? escapeHtml(output.trace.verificationCommand) : "no verification"}${output.trace.reReviewDecision ? ` &middot; Re-review: ${escapeHtml(output.trace.reReviewDecision)}` : ""}`;
      result.innerHTML = `<h2>${title}</h2><p>Model: ${escapeHtml(output.trace.model)} &middot; ${detail}</p><p>${escapeHtml(output.summary)}</p><pre class="patch">${escapeHtml(output.patch || "No patch was proposed.")}</pre>`;
    } else if (action.value === "plan") {
      result.innerHTML = `<h2>IMPLEMENTATION PLAN</h2><p>Model: ${escapeHtml(output.trace.model)} &middot; ${output.trace.citedSources}/${output.trace.fetchedSources} citations verified</p><p>${escapeHtml(output.summary)}</p><div class="evidence">${output.steps.map((step, index) => `<div class="row"><span>${index + 1}. ${escapeHtml(step.title)}<br /><small>${escapeHtml(step.detail)}</small></span><code>${escapeHtml(step.citations[0]?.path ?? "No citation")}</code><span class="badge">PLAN</span></div>`).join("")}</div>`;
    } else if (action.value === "fix") {
      result.innerHTML = `<h2>SAFE FIX ${output.trace.applied ? "APPLIED" : "SUGGESTED"}</h2><p>Model: ${escapeHtml(output.trace.model)} &middot; ${output.trace.changedPaths.length} changed paths</p><p>${escapeHtml(output.summary)}</p><pre class="patch">${escapeHtml(output.patch || "No patch was proposed.")}</pre>`;
    } else {
      result.innerHTML = `<h2>TESTS SUGGESTED</h2><p>Model: ${escapeHtml(output.trace.model)} &middot; ${output.trace.changedPaths.length} test paths</p><p>${escapeHtml(output.summary)}</p><pre class="patch">${escapeHtml(output.patch || "No test patch was proposed.")}</pre>`;
    }
    result.classList.remove("hidden");
  } catch (error) {
    empty.classList.add("hidden");
    result.innerHTML = `<h2>ANALYSIS FAILED</h2><p>${escapeHtml(error)}</p>`;
    result.classList.remove("hidden");
  } finally {
    button.disabled = false;
    updateActionLabel();
  }
});
