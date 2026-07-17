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
const profile = document.querySelector("#profile");
const directories = document.querySelector("#directories");
const reReview = document.querySelector("#re-review");
const agentProfile = document.querySelector("#agent-profile");
const relatedRepos = document.querySelector("#related-repos");

function updateActionLabel() {
  const labels = { analyze: "Analyze change", walkthrough: "Generate walkthrough", consensus: "Run consensus gate", review: "Review local changes", conflicts: "Resolve merge conflicts", agent: "Sandbox fix and verify", autofix: "Review-thread autofix", plan: "Generate plan", fix: "Suggest safe fix", simplify: "Simplify changed code", tests: "Generate tests" };
  button.innerHTML = `${labels[action.value]} <span>&rarr;</span>`;
  const local = ["review", "agent", "conflicts"].includes(action.value);
  targetLabel.textContent = local ? "Repository path" : action.value === "plan" ? "Change request or issue" : "GitHub pull request";
  input.placeholder = local ? "C:\\path\\to\\repository" : "https://github.com/owner/repo/pull/123";
  apply.disabled = !["fix", "simplify", "conflicts"].includes(action.value);
  if (apply.disabled) apply.checked = false;
  remember.disabled = action.value !== "analyze";
  if (action.value !== "analyze") remember.checked = false;
  verify.disabled = !["agent", "autofix"].includes(action.value);
  if (action.value !== "agent") verify.value = "";
  externalSecurity.disabled = !["analyze", "review", "agent"].includes(action.value);
  if (externalSecurity.disabled) externalSecurity.checked = false;
  codeqlDatabase.disabled = !["analyze", "review", "agent"].includes(action.value);
  if (codeqlDatabase.disabled) codeqlDatabase.value = "";
  mcp.disabled = !["analyze", "consensus"].includes(action.value);
  if (mcp.disabled) mcp.checked = false;
  webSearch.disabled = !["analyze", "consensus"].includes(action.value);
  if (webSearch.disabled) webSearch.checked = false;
  directories.disabled = !["review", "agent"].includes(action.value);
  if (directories.disabled) directories.value = "";
  reReview.disabled = !["agent", "autofix"].includes(action.value);
  if (reReview.disabled) reReview.checked = false;
  relatedRepos.disabled = !["analyze", "consensus"].includes(action.value);
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
    const target = ["review", "agent", "conflicts"].includes(action.value) ? (input.value.trim() || repo.value.trim()) : input.value.trim();
  if (!target) return;
  button.disabled = true;
  button.textContent = "Working...";
  result.classList.add("hidden");
  try {
    const output = await window.__TAURI__.core.invoke("run_cli", { commandName: action.value, prUrl: target, model: model.value || null, provider: provider.value || null, effort: effort.value || null, profile: profile.value || null, agent: agentProfile.value || null, directories: directories.value || null, relatedRepos: relatedRepos.value || null, repoPath: ["review", "agent", "conflicts"].includes(action.value) ? null : (repo.value || null), criteria: criteria.value || null, verify: verify.value || null, externalSecurity: externalSecurity.checked, codeqlDatabase: codeqlDatabase.value || null, mcp: mcp.checked, webSearch: webSearch.checked, apply: apply.checked, remember: remember.checked, reReview: reReview.checked });
    empty.classList.add("hidden");
    if (action.value === "walkthrough") {
      const walkthrough = output.walkthrough;
      result.innerHTML = `<h2>PR WALKTHROUGH</h2><p>Decision: ${escapeHtml(output.decision)} &middot; Effort: ${escapeHtml(walkthrough.effortScore)}/5 &middot; ${walkthrough.citations.length} cited files</p><p>${escapeHtml(walkthrough.summary)}</p><div class="evidence">${walkthrough.changeStack.map((layer, index) => `<div class="row"><span>${index + 1}. ${escapeHtml(layer.title)}<br /><small>${escapeHtml(layer.purpose)}</small></span><code>${layer.files.length} files</code><span class="badge">${layer.citations.length} CITED</span></div>`).join("")}</div><h3>Evidence-derived change flow</h3><pre class="patch">${escapeHtml(walkthrough.sequenceDiagram)}</pre>`;
    } else if (action.value === "analyze" || action.value === "review" || action.value === "consensus") {
      const retrieval = output.trace.retrieval?.enabled ? ` &middot; ${output.trace.retrieval.selectedChunks}/${output.trace.retrieval.indexedChunks} repository chunks` : "";
      const security = (output.securityFindings || []).map((finding) => `<div class="row security"><span>${escapeHtml(finding.title)}</span><code>${escapeHtml(finding.path)}:${escapeHtml(finding.line)}</code><span class="badge">${escapeHtml(finding.severity.toUpperCase())}</span></div>`).join("");
      const consensus = action.value === "consensus" ? ` &middot; ${output.trace.agents} agents &middot; ${Math.round((output.trace.agreement || 0) * 100)}% agreement` : "";
      result.innerHTML = `<h2>${escapeHtml(output.decision.replaceAll("-", " ").toUpperCase())}</h2><p>Model: ${escapeHtml(output.trace.model || output.analyses?.map((item) => item.model).join(", ") || "consensus")} &middot; Effort: ${escapeHtml(output.trace.reviewEffort || "medium")} &middot; ${output.trace.citedSources} cited sources${consensus}${retrieval} &middot; ${output.trace.elapsedMs || 0}ms</p>${security ? `<h3>Security gate</h3><div class="evidence">${security}</div>` : ""}<div class="evidence">${output.rows.map((row) => `<div class="row"><span>${escapeHtml(row.criterion)}</span><code>${escapeHtml(row.citations[0]?.path ?? "No citation")}</code><span class="badge">${escapeHtml(row.state.toUpperCase())}</span></div>`).join("")}</div>`;
    } else if (action.value === "conflicts") {
      const conflictCount = output.conflictCount ?? output.trace?.changedPaths?.length ?? 0;
      result.innerHTML = `<h2>MERGE CONFLICTS ${output.trace ? (output.trace.applied ? "RESOLVED" : "SUGGESTED") : "DETECTED"}</h2><p>${conflictCount} conflict hunks &middot; ${output.trace ? `Model: ${escapeHtml(output.trace.model)}` : "read-only inspection"}</p><p>${escapeHtml(output.summary || "Resolve active conflicts before merging.")}</p>${output.patch ? `<pre class="patch">${escapeHtml(output.patch)}</pre>` : ""}`;
    } else if (action.value === "agent" || action.value === "autofix") {
      const title = action.value === "autofix" ? "REVIEW-THREAD AUTOFIX" : `SANDBOX AGENT ${output.trace.verified && output.trace.reReviewPassed !== false ? "VERIFIED" : "SUGGESTED"}`;
      const detail = action.value === "autofix" ? `Unresolved threads: ${output.trace.unresolvedThreads ?? 0}${output.trace.pullRequestUrl ? ` &middot; Created PR: ${escapeHtml(output.trace.pullRequestUrl)}` : ""}` : `${output.trace.changedPaths.length} changed paths &middot; ${output.trace.verificationCommand ? escapeHtml(output.trace.verificationCommand) : "no verification"}${output.trace.reReviewDecision ? ` &middot; Re-review: ${escapeHtml(output.trace.reReviewDecision)}` : ""}`;
      result.innerHTML = `<h2>${title}</h2><p>Model: ${escapeHtml(output.trace.model)} &middot; ${detail}</p><p>${escapeHtml(output.summary)}</p><pre class="patch">${escapeHtml(output.patch || "No patch was proposed.")}</pre>`;
    } else if (action.value === "plan") {
      result.innerHTML = `<h2>IMPLEMENTATION PLAN</h2><p>Model: ${escapeHtml(output.trace.model)} &middot; ${output.trace.citedSources}/${output.trace.fetchedSources} citations verified</p><p>${escapeHtml(output.summary)}</p><div class="evidence">${output.steps.map((step, index) => `<div class="row"><span>${index + 1}. ${escapeHtml(step.title)}<br /><small>${escapeHtml(step.detail)}</small></span><code>${escapeHtml(step.citations[0]?.path ?? "No citation")}</code><span class="badge">PLAN</span></div>`).join("")}</div>`;
    } else if (action.value === "fix" || action.value === "simplify") {
      result.innerHTML = `<h2>${action.value === "simplify" ? "SIMPLIFICATION" : "SAFE FIX"} ${output.trace.applied ? "APPLIED" : "SUGGESTED"}</h2><p>Model: ${escapeHtml(output.trace.model)} &middot; ${output.trace.changedPaths.length} changed paths</p><p>${escapeHtml(output.summary)}</p><pre class="patch">${escapeHtml(output.patch || "No patch was proposed.")}</pre>`;
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
