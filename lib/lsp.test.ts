import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readLspConfig, renderLspConfig, testLspServers } from "./lsp";

describe("repository LSP configuration", () => {
  it("loads the supported repository config and reports bounded server availability", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergeproof-lsp-"));
    try {
      await mkdir(join(root, ".github"), { recursive: true });
      await writeFile(join(root, ".github", "lsp.json"), JSON.stringify({ lspServers: { node: { command: process.execPath, args: ["-e", "process.exit(0)"], fileExtensions: { ".ts": "node" } }, bad: { command: "mergeproof-command-that-does-not-exist" } } }), "utf8");
      const config = await readLspConfig(root);
      expect(config.servers.map((server) => server.name)).toEqual(["node", "bad"]);
      expect(testLspServers(config)).toEqual(expect.arrayContaining([expect.objectContaining({ name: "node", available: true }), expect.objectContaining({ name: "bad", available: false })]));
      expect(renderLspConfig(config)).toContain(".github\\lsp.json");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
