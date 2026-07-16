const input = document.querySelector("#pr-url");
const button = document.querySelector("#run");
const empty = document.querySelector("#empty");
const result = document.querySelector("#result");
const model = document.querySelector("#model");
const provider = document.querySelector("#provider");
const action = document.querySelector("#action");
const repo = document.querySelector("#repo");
const apply = document.querySelector("#apply");

function updateActionLabel() {
  const labels = { analyze: "Analyze change", plan: "Generate plan", fix: "Suggest safe fix" };
  button.innerHTML = `${labels[action.value]} <span>&rarr;</span>`;
  apply.disabled = action.value !== "fix";
  if (action.value !== "fix") apply.checked = false;
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
  if (!input.value.trim()) return;
  button.disabled = true;
  button.textContent = "Working...";
  result.classList.add("hidden");
  try {
    const output = await window.__TAURI__.core.invoke("run_cli", { commandName: action.value, prUrl: input.value.trim(), model: model.value || null, provider: provider.value || null, repoPath: repo.value || null, apply: apply.checked });
    empty.classList.add("hidden");
    if (action.value === "analyze") {
      const retrieval = output.trace.retrieval?.enabled ? ` &middot; ${output.trace.retrieval.selectedChunks}/${output.trace.retrieval.indexedChunks} repository chunks` : "";
      result.innerHTML = `<h2>${escapeHtml(output.decision.replaceAll("-", " ").toUpperCase())}</h2><p>Model: ${escapeHtml(output.trace.model)} &middot; ${output.trace.citedSources} cited sources${retrieval} &middot; ${output.trace.elapsedMs}ms</p><div class="evidence">${output.rows.map((row) => `<div class="row"><span>${escapeHtml(row.criterion)}</span><code>${escapeHtml(row.citations[0]?.path ?? "No citation")}</code><span class="badge">${escapeHtml(row.state.toUpperCase())}</span></div>`).join("")}</div>`;
    } else if (action.value === "plan") {
      result.innerHTML = `<h2>IMPLEMENTATION PLAN</h2><p>Model: ${escapeHtml(output.trace.model)} &middot; ${output.trace.citedSources}/${output.trace.fetchedSources} citations verified</p><p>${escapeHtml(output.summary)}</p><div class="evidence">${output.steps.map((step, index) => `<div class="row"><span>${index + 1}. ${escapeHtml(step.title)}<br /><small>${escapeHtml(step.detail)}</small></span><code>${escapeHtml(step.citations[0]?.path ?? "No citation")}</code><span class="badge">PLAN</span></div>`).join("")}</div>`;
    } else {
      result.innerHTML = `<h2>SAFE FIX ${output.trace.applied ? "APPLIED" : "SUGGESTED"}</h2><p>Model: ${escapeHtml(output.trace.model)} &middot; ${output.trace.changedPaths.length} changed paths</p><p>${escapeHtml(output.summary)}</p><pre class="patch">${escapeHtml(output.patch || "No patch was proposed.")}</pre>`;
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
