import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMcpContext, renderMcpArguments } from "./mcp";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("MCP context boundary", () => {
  it("renders bounded repository-specific arguments", () => {
    vi.stubEnv("TEST_MCP_TOKEN", "secret");
    expect(renderMcpArguments({ query: "{{title}} {{criteria}}", token: "${TEST_MCP_TOKEN}" }, { title: "Fix retry", criteria: "tests", prUrl: "", body: "", headSha: "" })).toEqual({ query: "Fix retry tests", token: "secret" });
  });

  it("calls only an explicitly read-only configured tool and returns provenance", async () => {
    const root = await fs.mkdtemp(join(process.env.TEMP ?? ".", "mergeproof-mcp-"));
    temporaryDirectories.push(root);
    await fs.mkdir(join(root, ".mergeproof"));
    await fs.writeFile(join(root, ".mergeproof", "mcp.json"), JSON.stringify({ servers: [{ name: "linear", url: "https://mcp.example.test", tool: "search_issues", arguments: { query: "{{title}}" } }] }), "utf8");
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { method: string };
      calls.push(body.method);
      const result = body.method === "tools/list" ? { tools: [{ name: "search_issues", annotations: { readOnlyHint: true } }] } : body.method === "tools/call" ? { content: [{ type: "text", text: "Issue evidence" }] } : {};
      return new Response(JSON.stringify({ jsonrpc: "2.0", result }), { headers: { "content-type": "application/json" } });
    }));
    const result = await fetchMcpContext(root, { ref: { owner: "acme", repo: "payments", number: 1, url: "https://github.com/acme/payments/pull/1" }, title: "Fix retry", body: "body", headSha: "sha" }, ["tests"], true);
    expect(calls).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/call"]);
    expect(result.successful).toEqual(["linear"]);
    expect(result.failed).toEqual([]);
    expect(result.discussion[0]).toMatchObject({ author: "mcp:linear", body: "Issue evidence" });
  });
});
