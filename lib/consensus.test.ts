import { describe, expect, it } from "vitest";
import { summarizeConsensus } from "./consensus";
import type { Analysis } from "./types";

function analysis(model: string, state: "pass" | "warn" | "fail", decision: Analysis["decision"]): Analysis {
  return { decision, contract: { promise: "p", code: "c", tests: "t", release: "r" }, rows: [{ criterion: "criterion", evidence: `${model} evidence`, state, citations: [{ path: "src/a.ts", commitSha: "sha", url: "https://github.com/acme/app/blob/sha/src/a.ts" }] }], trace: { fetchedSources: 2, citedSources: 1, unsupportedClaims: 0, model, elapsedMs: 1 } };
}

describe("consensus", () => {
  it("requires unanimous ready decisions before returning ready", () => {
    const result = summarizeConsensus([analysis("a", "pass", "ready"), analysis("b", "warn", "needs-evidence")]);
    expect(result.decision).toBe("needs-evidence");
    expect(result.disagreements).toHaveLength(1);
    expect(result.trace.agreement).toBe(0.5);
  });

  it("returns ready for unanimous evidence-backed analyses", () => {
    expect(summarizeConsensus([analysis("a", "pass", "ready"), analysis("b", "pass", "ready")]).decision).toBe("ready");
  });
});
