import { describe, expect, it, vi } from "vitest";

vi.mock("./web-context", () => ({ searchWebContext: vi.fn() }));
vi.mock("./models", () => ({ createModelProvider: vi.fn(() => ({ name: "test:model", answer: vi.fn(async () => ({ answer: "Evidence-backed synthesis [1]." })) })) }));
import { searchWebContext } from "./web-context";
import { researchTopic } from "./research";

describe("opt-in research", () => {
  it("returns an explicit unavailable result without sources", async () => {
    vi.mocked(searchWebContext).mockResolvedValueOnce({ discussion: [], sources: [], resultCount: 0, unavailable: "credentials missing" });
    const result = await researchTopic("latest repository security patterns", { repoPath: process.cwd() });
    expect(result.sources).toHaveLength(0);
    expect(result.trace.network).toBe("opt-in");
    expect(result.trace.unavailable).toBe("credentials missing");
  });

  it("keeps source URLs beside the model synthesis", async () => {
    vi.mocked(searchWebContext).mockResolvedValueOnce({ discussion: [{ author: "web:test", body: "Primary source\nA useful snippet", url: "https://example.com/source" }], sources: ["https://example.com/source"], resultCount: 1 });
    const result = await researchTopic("repository security", { repoPath: process.cwd() });
    expect(result.answer).toContain("Evidence-backed");
    expect(result.sources).toEqual([{ title: "Primary source", url: "https://example.com/source", snippet: "A useful snippet" }]);
    expect(result.trace.model).toBe("test:model");
  });
});
