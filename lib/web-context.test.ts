import { afterEach, describe, expect, it, vi } from "vitest";
import { searchWebContext } from "./web-context";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("web context boundary", () => {
  it("returns bounded HTTPS search evidence and provenance", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "secret");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ web: { results: [{ title: "Docs", url: "https://docs.example.test/api", description: "API reference" }, { title: "HTTP", url: "http://unsafe.example.test", description: "ignore" }] } }), { headers: { "content-type": "application/json" } })));
    const report = await searchWebContext({ title: "API change", body: "body" }, ["preserve behavior"], true);
    expect(report).toMatchObject({ provider: "brave", resultCount: 1, sources: ["https://docs.example.test/api"] });
    expect(report.discussion[0]).toMatchObject({ author: "web:brave", url: "https://docs.example.test/api" });
  });

  it("abstains when no search credentials are configured", async () => {
    await expect(searchWebContext({ title: "API change", body: "body" }, [], true)).resolves.toMatchObject({ resultCount: 0, unavailable: "web search credentials are not configured" });
  });
});
