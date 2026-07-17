import { describe, expect, it } from "vitest";
import { renderAgentReviewError, renderAgentReviewEvents, renderAgentReviewSkipped, toAgentReviewEvents } from "./agent-review";
import type { Analysis } from "./types";

function analysis(): Analysis {
  return {
    decision: "needs-evidence",
    contract: { promise: "promise", code: "code", tests: "tests", release: "release" },
    rows: [{ criterion: "Tests cover the change", evidence: "No test citation was found.", state: "warn", citations: [] }],
    securityFindings: [{ id: "secret", title: "Credential literal added", severity: "high", path: "src/app.ts", line: 4, detail: "A credential was added.", citation: { path: "src/app.ts", commitSha: "abc", url: "https://github.com/acme/app/blob/abc/src/app.ts#L4" }, category: "security" }],
    trace: { fetchedSources: 3, citedSources: 1, unsupportedClaims: 2, model: "test:model", elapsedMs: 12, headSha: "abc", scope: "pull-request", attestation: { algorithm: "sha256", digest: "digest" } },
  };
}

describe("agent review stream", () => {
  it("emits context, evidence findings, security findings, and completion", () => {
    const events = toAgentReviewEvents(analysis());
    expect(events.map((event) => event.type)).toEqual(["status", "review_context", "heartbeat", "finding", "finding", "status", "complete"]);
    expect(events.find((event) => event.type === "finding" && event.source === "security")).toMatchObject({ severity: "critical", fileName: "src/app.ts", line: 4 });
    expect(events.at(-1)).toMatchObject({ type: "complete", status: "needs-evidence", findings: 2, unsupportedClaims: 2 });
  });

  it("renders parseable newline-delimited JSON", () => {
    const lines = renderAgentReviewEvents(analysis()).trim().split("\n").map((line) => JSON.parse(line) as { type: string });
    expect(lines[1]?.type).toBe("review_context");
    expect(lines.at(-1)?.type).toBe("complete");
  });

  it("supports structured skipped and error terminal streams", () => {
    expect(renderAgentReviewSkipped().trim().split("\n").map((line) => JSON.parse(line).type)).toEqual(["review_context", "status", "complete"]);
    expect(JSON.parse(renderAgentReviewError("failed")).type).toBe("error");
  });
});
