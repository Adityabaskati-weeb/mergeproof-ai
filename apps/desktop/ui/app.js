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
let chatSessionId = null;
const chatTurns = [];

for (const [value, label] of [["security-review", "Security review active changes"], ["findings", "Review findings"], ["research", "Research topic"], ["doctor", "Diagnose environment"], ["init", "Initialize repository"], ["auth-status", "Integration auth status"], ["sessions-list", "List local sessions"], ["sessions-compact", "Compact a local session"], ["sessions-checkpoints", "Inspect session checkpoints"], ["benchmark", "Benchmark review history"], ["search", "Search local timeline"], ["plugins", "Discover plugins and extensions"], ["lsp", "Inspect LSP configuration"], ["complete", "Complete code at cursor"], ["stats", "Review statistics"], ["prompts", "Replay saved prompts"], ["tasks", "Start background task"], ["tasks-list", "List background tasks"]]) {
  if (!action.querySelector(`option[value="${value}"]`)) action.insertAdjacentHTML("beforeend", `<option value="${value}">${label}</option>`);
}
if (!action.querySelector('option[value="autopilot"]')) action.insertAdjacentHTML("beforeend", '<option value="autopilot">Autopilot correction loop</option>');

function updateActionLabel() {
  const labels = { analyze: "Analyze change", chat: "Chat with repository", ask: "Ask repository", "fleet-ask": "Run evidence fleet", "fleet-plan": "Run planning fleet", report: "Review report", security: "Repository security scan", "bundle-verify": "Verify review capsule", "plan-history": "Inspect plan history", walkthrough: "Generate walkthrough", erd: "Generate schema impact", resolve: "Resolve review threads", docstrings: "Generate docstrings", consensus: "Run consensus gate", review: "Review local changes", conflicts: "Resolve merge conflicts", agent: "Sandbox fix and verify", task: "Implement GitHub issue", implement: "Implement local request", recipe: "Run finishing-touch recipe", autofix: "Review-thread autofix", plan: "Generate plan", "work-plan": "Plan free-form request", fix: "Suggest safe fix", simplify: "Simplify changed code", tests: "Generate tests", init: "Initialize repository", "auth-status": "Integration auth status", "sessions-list": "List local sessions", "sessions-compact": "Compact a local session", "sessions-checkpoints": "Inspect session checkpoints", benchmark: "Benchmark review history", search: "Search local timeline", plugins: "Discover plugins and extensions", lsp: "Inspect LSP configuration", tasks: "Start background task", "tasks-list": "List background tasks" };
  const criteriaLabel = document.querySelector('label[for="criteria"]');
  button.innerHTML = `${labels[action.value]} <span>&rarr;</span>`;
  const local = ["review", "agent", "conflicts", "ask", "fleet-ask", "fleet-plan", "report", "security", "plan-history", "implement", "work-plan", "init", "auth-status", "sessions-list", "sessions-compact", "sessions-checkpoints", "benchmark", "search", "plugins", "lsp", "complete", "stats", "prompts", "tasks-list"].includes(action.value);
  targetLabel.textContent = action.value === "ask" || action.value === "chat" || action.value === "fleet-ask" || action.value === "fleet-plan" ? "Repository question or request" : action.value === "bundle-verify" ? "Review bundle JSON" : action.value === "work-plan" ? "PRD, design, or work request" : action.value === "complete" ? "File path" : local ? "Repository path" : action.value === "plan" ? "Change request or issue" : action.value === "task" ? "GitHub issue" : "GitHub pull request";
  if (criteriaLabel) criteriaLabel.textContent = action.value === "recipe" ? "Recipe name" : action.value === "tasks" ? "Task action (review, research, ask, benchmark, doctor)" : action.value === "lsp" ? "LSP action (show or test)" : "Criteria";
  input.placeholder = action.value === "ask" || action.value === "chat" || action.value === "fleet-ask" ? "How does authentication flow through this repository?" : action.value === "fleet-plan" ? "Add rate limiting to the public API" : action.value === "bundle-verify" ? "C:\\path\\to\\review.bundle.json" : action.value === "implement" ? "Add rate limiting to the login endpoint" : action.value === "work-plan" ? "Add rate limiting to the public API" : action.value === "tasks" ? "Research topic, repository question, or review path" : action.value === "sessions-compact" || action.value === "sessions-checkpoints" ? "session-id" : action.value === "complete" ? "src\\file.ts" : local ? "C:\\path\\to\\repository" : action.value === "task" ? "https://github.com/owner/repo/issues/123" : "https://github.com/owner/repo/pull/123";
  apply.disabled = !["fix", "simplify", "conflicts", "resolve", "recipe", "implement"].includes(action.value);
  if (apply.disabled) apply.checked = false;
  criteria.disabled = action.value === "ask" || action.value === "chat" || action.value === "fleet-ask" || action.value === "fleet-plan";
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
action.addEventListener("change", () => {
  if (action.value === "security-review") {
    button.innerHTML = "Security review active changes <span>&rarr;</span>";
    targetLabel.textContent = "Repository path";
    input.placeholder = "C:\\path\\to\\repository";
  } else if (action.value === "research") {
    button.innerHTML = "Research topic <span>&rarr;</span>";
    targetLabel.textContent = "Research topic";
    input.placeholder = "secure GitHub webhook verification";
  } else if (action.value === "doctor") {
    button.innerHTML = "Diagnose environment <span>&rarr;</span>";
    targetLabel.textContent = "Repository path";
    input.placeholder = "C:\\path\\to\\repository";
  } else if (action.value === "findings") {
    button.innerHTML = "Review findings <span>&rarr;</span>";
    targetLabel.textContent = "Repository path";
    input.placeholder = "C:\\path\\to\\repository";
  } else if (action.value === "init") {
    button.innerHTML = "Initialize repository <span>&rarr;</span>";
    targetLabel.textContent = "Repository path";
    input.placeholder = "C:\\path\\to\\repository";
  } else if (action.value === "auth-status") {
    button.innerHTML = "Check integration auth <span>&rarr;</span>";
    targetLabel.textContent = "Repository path (optional)";
    input.placeholder = "Optional repository path";
  } else if (action.value === "sessions-list") {
    button.innerHTML = "List local sessions <span>&rarr;</span>";
    targetLabel.textContent = "Repository path";
    input.placeholder = "C:\\path\\to\\repository";
  } else if (action.value === "sessions-compact" || action.value === "sessions-checkpoints") {
    button.innerHTML = `${action.value === "sessions-compact" ? "Compact session" : "Inspect checkpoints"} <span>&rarr;</span>`;
    targetLabel.textContent = "Session ID";
  } else if (action.value === "benchmark") {
    button.innerHTML = "Benchmark review history <span>&rarr;</span>";
    targetLabel.textContent = "Repository path";
    input.placeholder = "C:\\path\\to\\repository";
  } else if (action.value === "search") {
    button.innerHTML = "Search local timeline <span>&rarr;</span>";
    targetLabel.textContent = "Search query";
    input.placeholder = "authentication failure";
  } else if (action.value === "plugins") {
    button.innerHTML = "Discover plugins and extensions <span>&rarr;</span>";
    targetLabel.textContent = "Repository path";
    input.placeholder = "C:\\path\\to\\repository";
  } else if (action.value === "tasks") {
    button.innerHTML = "Start background task <span>&rarr;</span>";
    targetLabel.textContent = "Task request (optional for doctor, benchmark, or review)";
  } else if (action.value === "tasks-list") {
    button.innerHTML = "List background tasks <span>&rarr;</span>";
    targetLabel.textContent = "Repository path";
    input.placeholder = "C:\\path\\to\\repository";
  }
});

provider.addEventListener("change", () => {
  if (provider.value === "anthropic" && model.value.startsWith("gpt")) model.value = "claude-sonnet-4-20250514";
  if (provider.value !== "anthropic" && model.value.startsWith("claude")) model.value = "gpt-5.6";
});

action.addEventListener("change", () => {
  if (action.value !== "autopilot") return;
  button.innerHTML = "Run autopilot correction loop <span>&rarr;</span>";
  targetLabel.textContent = "Natural-language change request";
  input.placeholder = "Add rate limiting to the login endpoint";
  apply.disabled = false;
  verify.disabled = false;
  reReview.disabled = true;
  reReview.checked = false;
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

button.addEventListener("click", async () => {
    const target = action.value === "auth-status" ? "." : ["review", "agent", "conflicts", "security", "security-review", "findings", "doctor", "init", "sessions-list", "benchmark", "plugins", "tasks-list", "bundle-verify"].includes(action.value) ? (input.value.trim() || repo.value.trim()) : input.value.trim();
  if (!target) return;
  button.disabled = true;
  button.textContent = "Working...";
  result.classList.add("hidden");
  try {
    const output = await window.__TAURI__.core.invoke("run_cli", { commandName: action.value, prUrl: target, model: model.value || null, provider: provider.value || null, effort: effort.value || null, profile: profile.value || null, agent: agentProfile.value || null, directories: directories.value || null, relatedRepos: relatedRepos.value || null, repoPath: action.value === "research" || action.value === "search" || action.value === "complete" ? (repo.value || ".") : ["review", "agent", "conflicts", "report", "security", "security-review", "findings", "doctor", "init", "sessions-list", "sessions-compact", "sessions-checkpoints", "benchmark", "plugins", "lsp", "stats", "prompts", "tasks", "tasks-list", "fleet-ask", "fleet-plan"].includes(action.value) ? (repo.value || target) : (repo.value || null), criteria: criteria.value || null, verify: verify.value || null, externalSecurity: externalSecurity.checked, codeqlDatabase: codeqlDatabase.value || null, mcp: mcp.checked, webSearch: webSearch.checked, apply: apply.checked, remember: remember.checked, reReview: reReview.checked, sessionId: action.value === "chat" ? chatSessionId : null });
    empty.classList.add("hidden");
    if (action.value === "complete") {
      result.innerHTML = `<h2>CODE COMPLETION</h2><p>Model: ${escapeHtml(output.trace.model)} &middot; ${escapeHtml(output.trace.filePath)}:${output.trace.line}:${output.trace.column} &middot; non-mutating</p><pre class="patch">${escapeHtml(output.completion || "No completion returned.")}</pre>`;
    } else if (action.value === "stats") {
      result.innerHTML = `<h2>REVIEW STATISTICS</h2><p>${output.reviews.total} review(s) &middot; ${output.reviews.attested} attested &middot; ${output.findings.total} finding(s) &middot; ${output.outcomes.total} outcome(s)</p><p>Decisions: ${escapeHtml(Object.entries(output.reviews.decisions || {}).map(([key, value]) => `${key}=${value}`).join(", ") || "none")}</p>`;
    } else if (action.value === "prompts") {
      result.innerHTML = `<h2>SAVED PROMPTS</h2><p>${output.length} bounded prompt record(s) &middot; replay is explicit</p><div class="evidence">${(output || []).map((prompt) => `<div class="row"><span>${escapeHtml(prompt.action)} / ${escapeHtml(prompt.model)}<br /><small>${escapeHtml(prompt.recordedAt)}</small></span><code>${escapeHtml(prompt.digest.slice(0, 12))}</code><span class="badge">REPLAYABLE</span></div>`).join("") || "No saved prompts."}</div>`;
    } else if (action.value === "search") {
      result.innerHTML = `<h2>LOCAL TIMELINE SEARCH</h2><p>${output.length} match(es)</p><div class="evidence">${(output || []).map((hit) => `<div class="row"><span>${escapeHtml(hit.title)}<br /><small>${escapeHtml(hit.snippet)}</small></span><code>${escapeHtml(hit.source)}</code><span class="badge">${escapeHtml(hit.kind.toUpperCase())}</span></div>`).join("") || "No timeline matches."}</div>`;
    } else if (action.value === "plugins") {
      result.innerHTML = `<h2>WORKSPACE SURFACES</h2><p>${output.length} plugin, skill, agent, command, and client surface(s)</p><div class="evidence">${(output || []).map((plugin) => `<div class="row"><span>${escapeHtml(plugin.name)}<br /><small>${escapeHtml(plugin.detail)}</small></span><code>${escapeHtml(plugin.path)}</code><span class="badge">${escapeHtml(plugin.kind.toUpperCase())}</span></div>`).join("") || "No workspace surfaces discovered."}</div>`;
    } else if (action.value === "benchmark") {
      result.innerHTML = `<h2>REVIEW BENCHMARK</h2><p>${output.total} analysis record(s) &middot; ${(output.citationCoverage * 100).toFixed(1)}% citation coverage &middot; ${output.validAttestations} valid attestations</p><p>Unsupported claims: ${output.unsupportedClaims} &middot; Average latency: ${output.averageElapsedMs}ms</p><div class="evidence">${(output.recommendations || []).map((recommendation) => `<div class="row security"><span>${escapeHtml(recommendation)}</span><span class="badge">ACTION</span></div>`).join("") || "No immediate recommendations."}</div>`;
    } else if (action.value === "init") {
      result.innerHTML = `<h2>MERGEPROOF INITIALIZED</h2><p>${escapeHtml(output.repository)}</p><div class="evidence">${(output.files || []).map((file) => `<div class="row"><span>${escapeHtml(file.path)}<br /><small>${escapeHtml(file.purpose)}</small></span><span class="badge">${file.created ? "CREATED" : "KEPT"}</span></div>`).join("")}</div>`;
    } else if (action.value === "auth-status") {
      result.innerHTML = `<h2>INTEGRATION AUTH STATUS</h2><p>Model provider: ${escapeHtml(output.provider)}</p><div class="evidence">${(output.entries || []).map((entry) => `<div class="row"><span>${escapeHtml(entry.id)}<br /><small>${escapeHtml(entry.scope)}</small></span><span class="badge">${escapeHtml(entry.status.toUpperCase())}</span></div>`).join("")}</div>`;
    } else if (action.value === "sessions-list") {
      result.innerHTML = `<h2>LOCAL SESSIONS</h2><p>${output.length} saved session(s)</p><div class="evidence">${(output || []).map((session) => `<div class="row"><span>${escapeHtml(session.name || session.id)}<br /><small>${escapeHtml(session.id)}</small></span><span class="badge">${session.turns.length} TURNS</span></div>`).join("") || "No saved sessions."}</div>`;
    } else if (action.value === "sessions-compact" || action.value === "sessions-checkpoints") {
      const checkpoints = action.value === "sessions-checkpoints" ? output : output.checkpoints || [];
      result.innerHTML = `<h2>SESSION ${action.value === "sessions-compact" ? "COMPACTED" : "CHECKPOINTS"}</h2><p>${checkpoints.length} checkpoint(s)</p><div class="evidence">${(checkpoints || []).map((checkpoint) => `<div class="row"><span>${escapeHtml(checkpoint.createdAt)}<br /><small>Archived ${checkpoint.archivedTurns} turn(s), retained ${checkpoint.retainedTurns}</small></span><code>${escapeHtml(checkpoint.digest.slice(0, 12))}</code><span class="badge">AUDITABLE</span></div>`).join("") || "No compaction checkpoints."}</div>`;
    } else if (action.value === "doctor") {
      result.innerHTML = `<h2>MERGEPROOF DOCTOR ${output.ok ? "READY" : "BLOCKED"}</h2><p>${escapeHtml(output.repository)}</p><div class="evidence">${(output.checks || []).map((check) => `<div class="row"><span>${escapeHtml(check.id)}<br /><small>${escapeHtml(check.message)}</small></span><span class="badge">${escapeHtml(check.status.toUpperCase())}</span></div>`).join("")}</div>`;
    } else if (action.value === "tasks-list") {
      result.innerHTML = `<h2>BACKGROUND TASKS</h2><p>${output.length} saved task(s)</p><div class="evidence">${(output || []).map((task) => `<div class="row"><span>${escapeHtml(task.action)}<br /><small>${escapeHtml(task.id)}</small></span><code>${escapeHtml(task.status)}</code><span class="badge">${escapeHtml(task.status.toUpperCase())}</span></div>`).join("") || "No saved tasks."}</div>`;
    } else if (action.value === "tasks") {
      result.innerHTML = `<h2>BACKGROUND TASK STARTED</h2><p>${escapeHtml(output.id)} &middot; ${escapeHtml(output.action)} &middot; ${escapeHtml(output.status)}</p><div class="evidence"><div class="row"><span>Task log</span><code>${escapeHtml(output.logPath)}</code><span class="badge">TRACK WITH TASKS LIST</span></div></div>`;
    } else if (action.value === "lsp") {
      const values = Array.isArray(output) ? output : output.servers || [];
      result.innerHTML = `<h2>LSP ${criteria.value.toLowerCase() === "test" ? "AVAILABILITY" : "CONFIGURATION"}</h2><p>${values.length} configured result(s)</p><div class="evidence">${values.map((item) => `<div class="row"><span>${escapeHtml(item.name || item.command || "LSP")}</span><code>${escapeHtml(item.message || Object.keys(item.fileExtensions || {}).join(", ") || "configured")}</code><span class="badge">${item.available === false ? "WARN" : "READY"}</span></div>`).join("") || "No LSP servers configured."}</div>`;
    } else if (action.value === "findings") {
      result.innerHTML = `<h2>REVIEW FINDINGS</h2><p>${output.length} persisted finding(s)</p><div class="evidence">${(output || []).map((finding) => `<div class="row security"><span>${escapeHtml(finding.criterion)}<br /><small>${escapeHtml(finding.comment)}</small></span><code>${escapeHtml(finding.fileName)}${finding.line ? `:${finding.line}` : ""}</code><span class="badge">${escapeHtml(finding.severity.toUpperCase())}</span></div>`).join("") || "No persisted review findings."}</div>`;
    } else if (action.value === "research") {
      result.innerHTML = `<h2>RESEARCH SOURCE PACK</h2><p>${output.sources?.length ?? 0} source(s) &middot; network: opt-in${output.trace?.model ? ` &middot; ${escapeHtml(output.trace.model)}` : ""}</p><p class="answer">${escapeHtml(output.answer || "No synthesis returned.").replaceAll("\n", "<br />")}</p><div class="evidence">${(output.sources || []).map((source, index) => `<div class="row"><span>[${index + 1}] ${escapeHtml(source.title)}<br /><small>${escapeHtml(source.snippet)}</small></span><code>${escapeHtml(source.url)}</code></div>`).join("") || "No sources returned."}</div>`;
    } else if (action.value === "resolve") {
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
    } else if (action.value === "fleet-ask") {
      result.innerHTML = `<h2>FLEET ASK</h2><p>${output.trace.agents} agents &middot; ${Math.round((output.agreement || 0) * 100)}% answer agreement &middot; context ${escapeHtml(output.trace.headSha)}</p>${output.agents.map((agent) => `<div class="row"><span><strong>${escapeHtml(agent.model)}</strong><br /><small>${escapeHtml(agent.answer)}</small></span><code>${agent.trace.evidenceSources} evidence</code><span class="badge">${output.disagreements ? "DISAGREES" : "AGREES"}</span></div>`).join("")}`;
    } else if (action.value === "fleet-plan") {
      result.innerHTML = `<h2>FLEET PLAN</h2><p>${output.trace.agents} agents &middot; shared steps: ${escapeHtml(output.sharedSteps.join(", ") || "none")} &middot; context ${escapeHtml(output.trace.headSha)}</p>${output.agents.map((agent) => `<div class="row"><span><strong>${escapeHtml(agent.model)}</strong><br /><small>${escapeHtml(agent.summary)}</small></span><code>${agent.steps.length} steps</code><span class="badge">PLAN</span></div>`).join("")}`;
    } else if (action.value === "ask" || action.value === "chat") {
      const chatOutput = output.output || output;
      if (action.value === "chat" && output.sessionId) chatSessionId = output.sessionId;
      if (action.value === "chat") chatTurns.push({ request: target, answer: chatOutput.answer || chatOutput.summary || "No response." });
      const transcript = action.value === "chat" ? chatTurns.map((turn) => `<div class="row"><span><strong>${escapeHtml(turn.request)}</strong><br /><small>${escapeHtml(turn.answer).replaceAll("\n", "<br />")}</small></span><span class="badge">SESSION</span></div>`).join("") : `<p class="answer">${escapeHtml(chatOutput.answer).replaceAll("\n", "<br />")}</p>`;
      result.innerHTML = `<h2>${action.value === "chat" ? "EVIDENCE CHAT" : "REPOSITORY ANSWER"}</h2><p>${action.value === "chat" ? `Session: ${escapeHtml(chatSessionId || "new")}` : `Model: ${escapeHtml(chatOutput.trace.model)} &middot; ${chatOutput.trace.evidenceSources}/${chatOutput.trace.indexedChunks} evidence sources`} &middot; read-only</p>${action.value === "chat" ? `<div class="evidence">${transcript}</div>` : transcript}`;
    } else if (action.value === "analyze" || action.value === "review" || action.value === "security-review" || action.value === "consensus") {
      const retrieval = output.trace.retrieval?.enabled ? ` &middot; ${output.trace.retrieval.selectedChunks}/${output.trace.retrieval.indexedChunks} repository chunks` : "";
      const security = (output.securityFindings || []).map((finding) => `<div class="row security"><span>${escapeHtml(finding.title)}</span><code>${escapeHtml(finding.path)}:${escapeHtml(finding.line)}</code><span class="badge">${escapeHtml(finding.severity.toUpperCase())}</span></div>`).join("");
      const consensus = action.value === "consensus" ? ` &middot; ${output.trace.agents} agents &middot; ${Math.round((output.trace.agreement || 0) * 100)}% agreement` : "";
      result.innerHTML = `<h2>${escapeHtml(output.decision.replaceAll("-", " ").toUpperCase())}</h2><p>Model: ${escapeHtml(output.trace.model || output.analyses?.map((item) => item.model).join(", ") || "consensus")} &middot; Effort: ${escapeHtml(output.trace.reviewEffort || "medium")} &middot; ${output.trace.citedSources} cited sources${consensus}${retrieval} &middot; ${output.trace.elapsedMs || 0}ms</p>${security ? `<h3>Security gate</h3><div class="evidence">${security}</div>` : ""}<div class="evidence">${output.rows.map((row) => `<div class="row"><span>${escapeHtml(row.criterion)}</span><code>${escapeHtml(row.citations[0]?.path ?? "No citation")}</code><span class="badge">${escapeHtml(row.state.toUpperCase())}</span></div>`).join("")}</div>`;
      if (output.trace.reviewMode === "shadow") result.innerHTML += "<p class=\"shadow-note\">SHADOW MODE: neutral publication; this review does not block merging.</p>";
    } else if (action.value === "conflicts") {
      const conflictCount = output.conflictCount ?? output.trace?.changedPaths?.length ?? 0;
      result.innerHTML = `<h2>MERGE CONFLICTS ${output.trace ? (output.trace.applied ? "RESOLVED" : "SUGGESTED") : "DETECTED"}</h2><p>${conflictCount} conflict hunks &middot; ${output.trace ? `Model: ${escapeHtml(output.trace.model)}` : "read-only inspection"}</p><p>${escapeHtml(output.summary || "Resolve active conflicts before merging.")}</p>${output.patch ? `<pre class="patch">${escapeHtml(output.patch)}</pre>` : ""}`;
    } else if (action.value === "docstrings") {
      result.innerHTML = `<h2>DOCSTRINGS SUGGESTED</h2><p>Model: ${escapeHtml(output.trace.model)} &middot; ${output.trace.changedPaths.length} documentation paths</p><p>${escapeHtml(output.summary)}</p><pre class="patch">${escapeHtml(output.patch || "No documentation patch was proposed.")}</pre>`;
  } else if (action.value === "agent" || action.value === "autopilot" || action.value === "task" || action.value === "implement" || action.value === "recipe" || action.value === "autofix") {
      const title = action.value === "autofix" ? "REVIEW-THREAD AUTOFIX" : action.value === "autopilot" ? "AUTOPILOT CORRECTION LOOP" : `SANDBOX AGENT ${output.trace.verified && output.trace.reReviewPassed !== false ? "VERIFIED" : "SUGGESTED"}`;
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
    if (action.value === "autopilot") {
      button.innerHTML = "Run autopilot correction loop <span>&rarr;</span>";
      targetLabel.textContent = "Natural-language change request";
      input.placeholder = "Add rate limiting to the login endpoint";
      apply.disabled = false;
      verify.disabled = false;
      reReview.disabled = true;
    }
  }
});
