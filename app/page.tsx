import { EvidenceMatrix } from "@/components/evidence-matrix";
import { demoAnalysis } from "@/lib/demo-data";

export default function Home() {
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
          <div className="repo">octo-labs / checkout-api #184</div>
        </header>
        <section className="hero"><div><h2>Needs evidence before merge</h2><p>One acceptance criterion is implemented, but the retrieved repository context found no regression test for the new retry path.</p></div><div className="status">● HUMAN DECISION</div></section>
        <div className="grid">
          <EvidenceMatrix analysis={demoAnalysis} />
          <section className="card" id="integrations"><h3>Analysis provenance</h3><p className="card-intro">Context used to build this decision.</p><div className="metric"><span>Evidence items</span><strong>12</strong></div><div className="metric"><span>Criteria mapped</span><strong>3/4</strong></div><div className="metric"><span>Analysis time</span><strong>38s</strong></div><div className="source-list"><div className="source"><i className="source-dot" />GitHub PR diff<small>commit 91f0c2a · 8 files</small></div><div className="source"><i className="source-dot" />Jira PAY-482<small>acceptance criteria · linked</small></div><div className="source"><i className="source-dot" />Repository RAG<small>6 cited chunks · 1 test gap</small></div><div className="source"><i className="source-dot" />GitHub checks<small>5 passed · 1 pending</small></div></div></section>
        </div>
      </main>
    </div>
  );
}
