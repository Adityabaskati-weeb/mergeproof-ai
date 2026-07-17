import { describe, expect, it } from "vitest";
import { summarizeFleetAnswers, type FleetAskAgent } from "./fleet";

function answer(fingerprint: string): FleetAskAgent {
  return { answer: fingerprint, model: fingerprint, provider: "test", fingerprint, trace: { model: fingerprint, headSha: "sha", evidenceSources: 2, indexedChunks: 3, elapsedMs: 1, readOnly: true } };
}

describe("evidence-quorum fleet", () => {
  it("reports disagreement instead of hiding minority answers", () => {
    expect(summarizeFleetAnswers([answer("same"), answer("same"), answer("different")])).toEqual({ agreement: 2 / 3, disagreements: true });
  });
});

