const input = document.querySelector("#pr-url");
const button = document.querySelector("#analyze");
const empty = document.querySelector("#empty");
const result = document.querySelector("#result");

button.addEventListener("click", async () => {
  if (!input.value.trim()) return;
  button.disabled = true;
  button.textContent = "Analyzing...";
  result.classList.add("hidden");
  try {
    const analysis = await window.__TAURI__.core.invoke("analyze_pr", { prUrl: input.value.trim() });
    empty.classList.add("hidden");
    result.innerHTML = `<h2>${analysis.decision.replaceAll("-", " ").toUpperCase()}</h2><p>Model: ${analysis.trace.model} · ${analysis.trace.citedSources} cited sources · ${analysis.trace.elapsedMs}ms</p><div class="evidence">${analysis.rows.map((row) => `<div class="row"><span>${row.criterion}</span><code>${row.citations[0]?.path ?? "No citation"}</code><span class="badge">${row.state.toUpperCase()}</span></div>`).join("")}</div>`;
    result.classList.remove("hidden");
  } catch (error) {
    empty.classList.add("hidden");
    result.innerHTML = `<h2>ANALYSIS FAILED</h2><p>${String(error)}</p>`;
    result.classList.remove("hidden");
  } finally { button.disabled = false; button.innerHTML = "Analyze change <span>→</span>"; }
});
