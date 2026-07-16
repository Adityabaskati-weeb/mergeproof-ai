import type { Analysis } from "@/lib/types";

export function EvidenceMatrix({ analysis }: { analysis: Analysis }) {
  return <section className="card" id="evidence"><h3>Change contract</h3><p className="card-intro">Generated from PR acceptance criteria and cited GitHub evidence.</p><div className="contract"><div><h4>What was promised</h4><p>{analysis.contract.promise}</p></div><div><h4>Code evidence</h4><p>{analysis.contract.code}</p></div><div><h4>Test evidence</h4><p>{analysis.contract.tests}</p></div><div><h4>Release evidence</h4><p>{analysis.contract.release}</p></div></div><div className="evidence">{analysis.rows.map((row) => <div className="row" key={row.criterion}><span>{row.criterion}</span><code>{row.citations[0]?.path ?? "No citation"}</code><span>{row.evidence}</span><span className={`badge ${row.state}`}>{row.stateLabel ?? row.state.toUpperCase()}</span></div>)}</div></section>;
}
