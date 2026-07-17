import { describe, expect, it, vi } from "vitest";

vi.mock("./models", () => ({
  createModelProvider: () => ({ name: "test:reporter", answer: async (context: { headSha: string; repositoryEvidence: Array<{ content: string }> }) => ({ answer: `digest=${context.headSha.replace("report:", "")}; bytes=${context.repositoryEvidence[0]?.content.length ?? 0}` }) }),
}));

import { generateCustomReport } from "./report-ai";
import type { ReviewReport } from "./report";

const report: ReviewReport = { generatedAt: "2026-07-17T00:00:00.000Z", reviews: { total: 2, actions: { analyze: 2 }, decisions: { ready: 1, "needs-evidence": 1 }, models: { "test:model": 2 }, attested: 2, targets: 1 }, outcomes: { total: 0, labels: {}, decisions: {} }, activityByDay: { "2026-07-17": 2 } };

describe("custom reports", () => {
  it("binds the read-only report prompt to a stable source digest", async () => {
    const result = await generateCustomReport("Which decisions need attention?", report, { repoPath: process.cwd() });
    expect(result).toMatchObject({ trace: { model: "test:reporter", readOnly: true } });
    expect(result.report).toMatch(/^digest=[a-f0-9]{64}; bytes=/);
  });

  it("rejects an empty prompt", async () => {
    await expect(generateCustomReport(" ", report)).rejects.toThrow("must not be empty");
  });
});
