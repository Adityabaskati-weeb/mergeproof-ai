"use client";

import { FormEvent, useState } from "react";
import { EvidenceMatrix } from "@/components/evidence-matrix";
import { demoAnalysis } from "@/lib/demo-data";
import type { Analysis } from "@/lib/types";

export default function Home() {
  const [prUrl, setPrUrl] = useState("");
  const [analysis, setAnalysis] = useState<Analysis>(demoAnalysis);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const response = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prUrl }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Analysis failed.");
      setAnalysis(payload.analysis);
    } catch (err) { setError(err instanceof Error ? err.message : "Analysis failed."); }
    finally { setLoading(false); }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">merge<span>proof</span></div>
        <div className="eyebrow">Workspace</div>
        <nav className="nav" aria-label="Main navigation">
          <a className="active" href="#overview">Overview</a>
          <a href="#evidence">Evidence contracts</a>
          <a href="#integrations">Integrations</a>
        </nav>
        <div className="side-note"><strong>Human approval required</strong>MergeProof can draft Jira and Slack actions, but never sends them without your approval.</div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div><div className="eyebrow">Merge readiness / live analysis</div><h1>Does this PR prove its case?</h1><p className="subhead">Evidence-backed decisions for changes that move from ticket to production.</p></div>
          <div className="repo">{analysis.trace.model === "demo" ? "Demo analysis" : `Model: ${analysis.trace.model}`}</div>
        </header>
        <form className="analyze-form" onSubmit={analyze}><input aria-label="GitHub pull request URL" value={prUrl} onChange={(event) => setPrUrl(event.target.value)} placeholder="https://github.com/owner/repo/pull/123" /><button type="submit" disabled={loading}>{loading ? "Analyzing..." : "Analyze PR"}</button></form>
        {error && <div className="error" role="alert">{error}</div>}
        <section className="hero"><div><h2>{analysis.decision === "ready" ? "Ready to merge" : analysis.decision === "needs-owner" ? "Needs owner decision" : "Needs evidence before merge"}</h2><p>{analysis.decision === "ready" ? "Every acceptance criterion has model-supported evidence and valid citations." : "Review the evidence gaps below before making a merge decision."}</p></div><div className="status">● HUMAN DECISION</div></section>
        <div className="grid">
          <EvidenceMatrix analysis={demoAnalysis} />
          <section className="card" id="integrations"><h3>Analysis provenance</h3><p className="card-intro">Context used to build this decision.</p><div className="metric"><span>Evidence items</span><strong>{analysis.trace.fetchedSources}</strong></div><div className="metric"><span>Cited sources</span><strong>{analysis.trace.citedSources}</strong></div><div className="metric"><span>Unsupported claims</span><strong>{analysis.trace.unsupportedClaims}</strong></div><div className="metric"><span>Analysis time</span><strong>{analysis.trace.elapsedMs}ms</strong></div><div className="source-list"><div className="source"><i className="source-dot" />GitHub PR context<small>changed files · commits · checks</small></div><div className="source"><i className="source-dot" />Citation validator<small>every citation checked against fetched sources</small></div><div className="source"><i className="source-dot" />Human approval<small>MergeProof never merges automatically</small></div></div></section>
        </div>
      </main>
    </div>
  );
}
