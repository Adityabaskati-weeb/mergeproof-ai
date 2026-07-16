import { afterEach, describe, expect, it, vi } from "vitest";
import { publishChangeRequestCheck, publishChangeRequestReview } from "./change-publish";
import type { Analysis } from "./types";

afterEach(() => vi.unstubAllGlobals());

const analysis: Analysis = {
  decision: "needs-evidence",
  contract: { promise: "change", code: "code", tests: "tests", release: "release" },
  rows: [{ criterion: "keep behavior", evidence: "changed file", state: "warn", citations: [] }],
  trace: { fetchedSources: 1, citedSources: 0, unsupportedClaims: 0, model: "test:model", elapsedMs: 1, headSha: "git-sha" },
};

describe("provider publication", () => {
  it("publishes GitLab status and review note through the normalized dispatcher", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      return { ok: true, status: 200, json: async () => ({ sha: "git-sha", web_url: "https://gitlab.com/note/1" }) };
    }));

    await publishChangeRequestCheck("https://gitlab.com/acme/payments/-/merge_requests/7", analysis);
    await publishChangeRequestReview("https://gitlab.com/acme/payments/-/merge_requests/7", analysis);

    expect(calls.some((call) => call.method === "POST" && call.url.includes("/statuses/"))).toBe(true);
    expect(calls.some((call) => call.method === "POST" && call.url.includes("/notes"))).toBe(true);
  });
});
