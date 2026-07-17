import { describe, expect, it } from "vitest";
import { discoverWorkspacePlugins, renderWorkspacePlugins } from "./plugins";

describe("workspace plugin discovery", () => {
  it("discovers the repository's portable agent and client surfaces", async () => {
    const plugins = await discoverWorkspacePlugins(process.cwd());
    expect(plugins.some((plugin) => plugin.path === "plugin.json")).toBe(true);
    expect(plugins.some((plugin) => plugin.kind === "skill")).toBe(true);
    expect(renderWorkspacePlugins(plugins)).toContain("VS Code");
  });
});
