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
  const labels = { analyze: "Analyze change", chat: "Chat with repository", ask: "Ask repository", report: "Review report", security: "Repository security scan", "bundle-verify": "Verify review capsule", "plan-history": "Inspect plan history", walkthrough: "Generate walkthrough", erd: "Generate schema impact", resolve: "Resolve review threads", docstrings: "Generate docstrings", consensus: "Run consensus gate", review: "Review local changes", conflicts: "Resolve merge conflicts", agent: "Sandbox fix and verify", task: "Implement GitHub issue", implement: "Implement local request", recipe: "Run finishing-touch recipe", autofix: "Review-thread autofix", plan: "Generate plan", "work-plan": "Plan free-form request", fix: "Suggest safe fix", simplify: "Simplify changed code", tests: "Generate tests" };
  const criteriaLabel = document.querySelector('label[for="criteria"]');
  button.innerHTML = `${labels[action.value]} <span>&rarr;</span>`;
  const local = ["review", "agent", "conflicts", "ask", "report", "security", "plan-history", "implement", "work-plan"].includes(action.value);
  targetLabel.textContent = action.value === "ask" || action.value === "chat" ? "Repository question" : action.value === "bundle-verify" ? "Review bundle JSON" : action.value === "work-plan" ? "PRD, design, or work request" : local ? "Repository path" : action.value === "plan" ? "Change request or issue" : action.value === "task" ? "GitHub issue" : "GitHub pull request";
  if (criteriaLabel) criteriaLabel.textContent = action.value === "recipe" ? "Recipe name" : "Criteria";
  input.placeholder = action.value === "ask" || action.value === "chat" ? "How does authentication flow through this repository?" : action.value === "bundle-verify" ? "C:\\path\\to\\review.bundle.json" : action.value === "implement" ? "Add rate limiting to the login endpoint" : action.value === "work-plan" ? "Add rate limiting to the public API" : local ? "C:\\path\\to\\repository" : action.value === "task" ? "https://github.com/owner/repo/issues/123" : "https://github.com/owner/repo/pull/123";
  apply.disabled = !["fix", "simplify", "conflicts", "resolve", "recipe", "implement"].includes(action.value);
  if (apply.disabled) apply.checked = false;
  criteria.disabled = action.value === "ask" || action.value === "chat";
  if (criteria.disabled) criteria.value = "";
  remember.disabled = action.value !== "analyze";
  if (action.value !== "analyze") remember.checked = false;
  verify.disabled = !["agent", "task", "implement", "recipe", "autofix"].includes(action.value);
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
  reReview.disabled = !["agent", "task", "implement", "recipe", "autofix"].includes(action.value);
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
    const target = ["review", "agent", "conflicts", "security", "plan-history", "bundle-verify"].includes(action.value) ? (input.value.trim() || repo.value.trim()) : input.value.trim();
  if (!target) return;
  button.disabled = true;
  button.textContent = "Working...";
  result.classList.add("hidden");
  try {
    const output = await window.__TAURI__.core.invoke("run_cli", { commandName: action.value, prUrl: target, model: model.value || null, provider: provider.value || null, effort: effort.value || null, profile: profile.value || null, agent: agentProfile.value || null, directories: directories.value || null, relatedRepos: relatedRepos.value || null, repoPath: ["review", "agent", "conflicts", "report", "security", "plan-history"].includes(action.value) ? (repo.value || target) : (repo.value || null), criteria: criteria.value || null, verify: verify.value || null, externalSecurity: externalSecurity.checked, codeqlDatabase: codeqlDatabase.value || null, mcp: mcp.checked, webSearch: webSearch.checked, apply: apply.checked, remember: remember.checked, reReview: reReview.checked });
    empty.classList.add("hidden");
    if (action.value === "resolve") {
      result.innerHTML = `<h2>REVIEW THREADS ${apply.checked ? "RESOLVED" : "INSPECTED"}</h2><p>${output.resolved?.length ?? output.unresolved?.length ?? 0} thread(s) &middot; ${apply.checked ? "GitHub mutation applied" : "read-only inspection"}</p><div class="evidence">${(output.unresolved || output.resolved || []).map((thread) => `<div class="row"><span>${escapeHtml(thread.id || thread)}</span><code>${escapeHtml(thread.path || "resolved")}</code><span class="badge">${apply.checked ? "RESOLVED" : "OPEN"}</span></div>`).join("")}</div>`;
    } else if (action.value === "walkthrough") {
      const walkthrough = output.walkthrough;
      result.innerHTML = `<h2>PR WALKTHROUGH</h2><p>Decision: ${escapeHtml(output.decision)} &middot; Effort: ${escapeHtml(walkthrough.effortScore)}/5 &middot; ${walkthrough.citations.length} cited files</p><p>${escapeHtml(walkthrough.summary)}</p><div class="evidence">${walkthrough.changeStack.map((layer, index) => `<div class="row"><span>${index + 1}. ${escapeHtml(layer.title)}<br /><small>${escapeHtml(layer.purpose)}</small></span><code>${layer.files.length} files</code><span class="badge">${layer.citations.length} CITED</span></div>`).join("")}</div><h3>Evidence-derived change flow</h3><pre class="patch">${escapeHtml(walkthrough.sequenceDiagram)}</pre>`;
    } else if (action.value === "erd") {
      result.innerHTML = `<h2>SCHEMA IMPACT</h2><p>Decision: ${escapeHtml(output.decision)} &middot; ${output.entities.length} evidence-backed entities</p><pre class="patch">${escapeHtml(output.diagram)}</pre><div class="evidence">${output.entities.map((entity) => `<div class="row"><span>${escapeHtml(entity.name)}</span><code>${escapeHtml(entity.source)}</code><span class="badge">CITED</span></div>`).join("") || "No schema/model entities detected."}</div>`;
    } else if (action.value === "report") {
      const decisions = Object.entries(output.reviews.decisions || {}).map(([key, value]) => `${escapeHtml(key)}=${value}`).join(", ") || "none";
      result.innerHTML = `<h2>REVIEW REPORT</h2><p>${output.reviews.total} reviews &middot; ${output.reviews.targets} targets &middot; ${output.reviews.attested} attested</p><p>Decisions: ${decisions}</p><p>Outcomes: ${output.outcomes.total} &middot; ${output.outcomes.readyCalibration ? `${Math.round(output.outcomes.readyCalibration.rate * 100)}% ready calibration` : "not enough judged outcomes"}</p>`;
    } else if (action.value === "security") {
      result.innerHTML = `<h2>REPOSITORY SECURITY SCAN</h2><p>${output.findings.length} deterministic finding(s) &middot; sensitive files excluded</p><div class="evidence">${output.findings.map((finding) => `<div class="row security"><span>${escapeHtml(finding.title)}</span><code>${escapeHtml(finding.path)}:${escapeHtml(finding.line)}</code><span class="badge">${escapeHtml(finding.severity.toUpperCase())}</span></div>`).join("") || "No deterministic findings."}</div>`;
    } else if (action.value === "bundle-verify") {
      const errors = (output.citationErrors || []).map((error) => `<div class="row security"><span>${escapeHtml(error)}</span><span class="badge">INVALID</span></div>`).join("");
      result.innerHTML = `<h2>REVIEW CAPSULE ${output.valid ? "VALID" : "INVALID"}</h2><p>Bundle digest: ${output.bundleDigestValid ? "valid" : "invalid"} &middot; Context digest: ${output.contextDigestValid ? "valid" : "invalid"} &middot; Analysis attestation: ${output.analysisAttestationValid ? "valid" : "invalid"}</p><div class="evidence">${errors || "All citations resolve to the capsule source manifest."}</div>`;
    } else if (action.value === "plan-history") {
      result.innerHTML = `<h2>PLAN HISTORY</h2><p>${output.length} recorded version(s)</p><div class="evidence">${output.map((entry) => `<div class="row"><span>${escapeHtml(entry.id)} v${entry.version}<br /><small>${escapeHtml(entry.request)}</small></span><code>${escapeHtml(entry.digest.slice(0, 12))}</code><span class="badge">${escapeHtml(entry.model)}</span></div>`).join("") || "No recorded plans."}</div>`;
    } else if (action.value === "ask" || action.value === "chat") {
      result.innerHTML = `<h2>${action.value === "chat" ? "EVIDENCE CHAT" : "REPOSITORY ANSWER"}</h2><p>Model: ${escapeHtml(output.trace.model)} &middot; ${output.trace.evidenceSources}/${output.trace.indexedChunks} evidence sources &middot; read-only &middot; ${output.trace.elapsedMs}ms</p><p class="answer">${escapeHtml(output.answer).replaceAll("\n", "<br />")}</p>`;
    } else if (action.value === "analyze" || action.value === "review" || action.value === "consensus") {
      const retrieval = output.trace.retrieval?.enabled ? ` &middot; ${output.trace.retrieval.selectedChunks}/${output.trace.retrieval.indexedChunks} repository chunks` : "";
      const security = (output.securityFindings || []).map((finding) => `<div class="row security"><span>${escapeHtml(finding.title)}</span><code>${escapeHtml(finding.path)}:${escapeHtml(finding.line)}</code><span class="badge">${escapeHtml(finding.severity.toUpperCase())}</span></div>`).join("");
      const consensus = action.value === "consensus" ? ` &middot; ${output.trace.agents} agents &middot; ${Math.round((output.trace.agreement || 0) * 100)}% agreement` : "";
      result.innerHTML = `<h2>${escapeHtml(output.decision.replaceAll("-", " ").toUpperCase())}</h2><p>Model: ${escapeHtml(output.trace.model || output.analyses?.map((item) => item.model).join(", ") || "consensus")} &middot; Effort: ${escapeHtml(output.trace.reviewEffort || "medium")} &middot; ${output.trace.citedSources} cited sources${consensus}${retrieval} &middot; ${output.trace.elapsedMs || 0}ms</p>${security ? `<h3>Security gate</h3><div class="evidence">${security}</div>` : ""}<div class="evidence">${output.rows.map((row) => `<div class="row"><span>${escapeHtml(row.criterion)}</span><code>${escapeHtml(row.citations[0]?.path ?? "No citation")}</code><span class="badge">${escapeHtml(row.state.toUpperCase())}</span></div>`).join("")}</div>`;
    } else if (action.value === "conflicts") {
      const conflictCount = output.conflictCount ?? output.trace?.changedPaths?.length ?? 0;
      result.innerHTML = `<h2>MERGE CONFLICTS ${output.trace ? (output.trace.applied ? "RESOLVED" : "SUGGESTED") : "DETECTED"}</h2><p>${conflictCount} conflict hunks &middot; ${output.trace ? `Model: ${escapeHtml(output.trace.model)}` : "read-only inspection"}</p><p>${escapeHtml(output.summary || "Resolve active conflicts before merging.")}</p>${output.patch ? `<pre class="patch">${escapeHtml(output.patch)}</pre>` : ""}`;
    } else if (action.value === "docstrings") {
      result.innerHTML = `<h2>DOCSTRINGS SUGGESTED</h2><p>Model: ${escapeHtml(output.trace.model)} &middot; ${output.trace.changedPaths.length} documentation paths</p><p>${escapeHtml(output.summary)}</p><pre class="patch">${escapeHtml(output.patch || "No documentation patch was proposed.")}</pre>`;
  } else if (action.value === "agent" || action.value === "task" || action.value === "implement" || action.value === "recipe" || action.value === "autofix") {
      const title = action.value === "autofix" ? "REVIEW-THREAD AUTOFIX" : `SANDBOX AGENT ${output.trace.verified && output.trace.reReviewPassed !== false ? "VERIFIED" : "SUGGESTED"}`;
      const detail = action.value === "autofix" ? `Unresolved threads: ${output.trace.unresolvedThreads ?? 0}${output.trace.pullRequestUrl ? ` &middot; Created PR: ${escapeHtml(output.trace.pullRequestUrl)}` : ""}` : `${output.trace.changedPaths.length} changed paths &middot; ${output.trace.verificationCommand ? escapeHtml(output.trace.verificationCommand) : "no verification"}${output.trace.reReviewDecision ? ` &middot; Re-review: ${escapeHtml(output.trace.reReviewDecision)}` : ""}${output.trace.evidenceSources ? ` &middot; ${output.trace.evidenceSources} evidence sources` : ""}`;
      result.innerHTML = `<h2>${action.value === "recipe" ? "FINISHING-TOUCH RECIPE" : title}</h2><p>Model: ${escapeHtml(output.trace.model)} &middot; ${detail}</p><p>${escapeHtml(output.summary)}</p><pre class="patch">${escapeHtml(output.patch || "No patch was proposed.")}</pre>`;
    } else if (action.value === "plan" || action.value === "work-plan") {
      result.innerHTML = `<h2>${action.value === "work-plan" ? "FREE-FORM WORK PLAN" : "IMPLEMENTATION PLAN"}</h2><p>Model: ${escapeHtml(output.trace.model)} &middot; ${output.trace.citedSources}/${output.trace.fetchedSources} citations verified${output.trace.local ? " &middot; local checkout" : ""}</p><p>${escapeHtml(output.summary)}</p><div class="evidence">${output.steps.map((step, index) => `<div class="row"><span>${index + 1}. ${escapeHtml(step.title)}<br /><small>${escapeHtml(step.detail)}</small></span><code>${escapeHtml(step.citations[0]?.path ?? "No citation")}</code><span class="badge">PLAN</span></div>`).join("")}</div>`;
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
