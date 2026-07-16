const input = document.querySelector("#pr-url");
const button = document.querySelector("#analyze");
const empty = document.querySelector("#empty");
const result = document.querySelector("#result");
const model = document.querySelector("#model");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

button.addEventListener("click", async () => {
  if (!input.value.trim()) return;
  button.disabled = true;
  button.textContent = "Analyzing...";
  result.classList.add("hidden");
  try {
    const analysis = await window.__TAURI__.core.invoke("analyze_pr", { prUrl: input.value.trim(), model: model.value || null });
    empty.classList.add("hidden");
    result.innerHTML = `<h2>${escapeHtml(analysis.decision.replaceAll("-", " ").toUpperCase())}</h2><p>Model: ${escapeHtml(analysis.trace.model)} &middot; ${analysis.trace.citedSources} cited sources &middot; ${analysis.trace.elapsedMs}ms</p><div class="evidence">${analysis.rows.map((row) => `<div class="row"><span>${escapeHtml(row.criterion)}</span><code>${escapeHtml(row.citations[0]?.path ?? "No citation")}</code><span class="badge">${escapeHtml(row.state.toUpperCase())}</span></div>`).join("")}</div>`;
    result.classList.remove("hidden");
  } catch (error) {
    empty.classList.add("hidden");
    result.innerHTML = `<h2>ANALYSIS FAILED</h2><p>${escapeHtml(error)}</p>`;
    result.classList.remove("hidden");
  } finally {
    button.disabled = false;
    button.innerHTML = "Analyze change <span>&rarr;</span>";
  }
});
