import { access, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type WorkspacePlugin = { kind: "plugin" | "agent" | "skill" | "command" | "client"; name: string; path: string; detail: string };

async function exists(path: string): Promise<boolean> { try { await access(path); return true; } catch { return false; } }

async function filesIn(root: string, directory: string, suffix: string, kind: WorkspacePlugin["kind"], output: WorkspacePlugin[]): Promise<void> {
  try {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(suffix) || output.length >= 200) continue;
      const path = join(directory, entry.name).replace(/\\/g, "/");
      output.push({ kind, name: entry.name.replace(new RegExp(`${suffix.replace(".", "\\.")}$`), ""), path, detail: `Repository ${kind} package` });
    }
  } catch { /* Optional package directories are allowed to be absent. */ }
}

export async function discoverWorkspacePlugins(root: string): Promise<WorkspacePlugin[]> {
  const repository = resolve(root);
  const output: WorkspacePlugin[] = [];
  for (const manifest of ["plugin.json", ".claude-plugin/plugin.json", ".cursor-plugin/plugin.json"]) {
    const path = join(repository, manifest);
    if (!await exists(path)) continue;
    let name = manifest;
    try { const value = JSON.parse(await readFile(path, "utf8")) as { name?: unknown; id?: unknown }; name = typeof value.name === "string" ? value.name : typeof value.id === "string" ? value.id : manifest; } catch { /* Keep the manifest path when metadata is invalid. */ }
    output.push({ kind: "plugin", name, path: manifest, detail: "Portable agent/plugin manifest" });
  }
  await filesIn(repository, ".github/agents", ".md", "agent", output);
  await filesIn(repository, "commands", ".md", "command", output);
  try {
    for (const entry of await readdir(join(repository, "skills"), { withFileTypes: true })) if (entry.isDirectory() && await exists(join(repository, "skills", entry.name, "SKILL.md"))) output.push({ kind: "skill", name: entry.name, path: `skills/${entry.name}/SKILL.md`, detail: "Portable agent skill" });
  } catch { /* Optional skills directory. */ }
  for (const client of [["VS Code", "apps/vscode"], ["JetBrains", "apps/jetbrains"], ["Desktop", "apps/desktop"]] as const) if (await exists(join(repository, client[1]))) output.push({ kind: "client", name: client[0], path: client[1], detail: "Supported client surface" });
  return output.slice(0, 200);
}

export function renderWorkspacePlugins(plugins: WorkspacePlugin[]): string {
  return [`MergeProof workspace surfaces: ${plugins.length}`, ...plugins.map((plugin) => `${plugin.kind.toUpperCase()} ${plugin.name} - ${plugin.path} (${plugin.detail})`)].join("\n");
}
