import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createAcpConnection } from "./acp";

type Message = { result?: any; error?: any; params?: any };

async function request(lines: unknown[]): Promise<Message[]> {
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on("data", (chunk) => chunks.push(chunk.toString()));
  const handle = createAcpConnection({ repoPath: process.cwd() }, output);
  for (const line of lines) await handle(JSON.stringify(line));
  return chunks.join("").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Message);
}

describe("MergeProof ACP transport", () => {
  it("negotiates, creates sessions, and advertises safe commands", async () => {
    const messages = await request([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {} } },
      { jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: process.cwd(), mcpServers: [] } },
    ]);
    expect(messages[0].result.protocolVersion).toBe(1);
    expect(messages[1].result.sessionId).toMatch(/^mergeproof-/);
    expect(messages[2].params.update.sessionUpdate).toBe("available_commands_update");
    expect(messages[2].params.update.availableCommands.map((value: { name: string }) => value.name)).toEqual(["ask", "plan", "review", "session"]);
  });

  it("rejects session methods before initialize and mutation-shaped modes", async () => {
    const messages = await request([
      { jsonrpc: "2.0", id: 1, method: "session/new", params: {} },
      { jsonrpc: "2.0", id: 2, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 3, method: "session/new", params: {} },
    ]);
    expect(messages[0].error.code).toBe(-32002);
    expect(messages[1].result.agentInfo.name).toBe("mergeproof");
    expect(messages[2].result.modes.availableModes.map((value: { id: string }) => value.id)).not.toContain("implement");
  });
});
