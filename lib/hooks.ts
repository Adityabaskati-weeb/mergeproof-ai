import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const hookSchema = z.object({ enabled: z.boolean().default(false), beforeReview: z.array(z.string()).default([]), afterReview: z.array(z.string()).default([]) }).strict();
const commands = {
  "npm-test": { executable: process.platform === "win32" ? "npm.cmd" : "npm", args: ["test"] },
  "npm-build": { executable: process.platform === "win32" ? "npm.cmd" : "npm", args: ["run", "build"] },
  "npm-typecheck": { executable: process.platform === "win32" ? "npm.cmd" : "npm", args: ["run", "typecheck"] },
  "pytest": { executable: "pytest", args: [] },
  "cargo-test": { executable: "cargo", args: ["test"] },
  "go-test": { executable: "go", args: ["test", "./..."] },
} as const;

export type HookPhase = "beforeReview" | "afterReview";
export type HookReport = { enabled: boolean; before: string[]; after: string[]; failed: string[] };

export async function loadHooks(root: string): Promise<z.infer<typeof hookSchema>> {
  try {
    const value = hookSchema.parse(JSON.parse(await readFile(join(root, ".mergeproof", "hooks.json"), "utf8")));
    for (const hook of [...value.beforeReview, ...value.afterReview]) if (!(hook in commands)) throw new Error(`Unsupported MergeProof hook: ${hook}. Allowed hooks: ${Object.keys(commands).join(", ")}.`);
    return value;
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unsupported MergeProof hook")) throw error;
    return { enabled: false, beforeReview: [], afterReview: [] };
  }
}

export async function runHooks(root: string, phase: HookPhase, requested = false): Promise<HookReport> {
  const config = await loadHooks(root);
  const report: HookReport = { enabled: Boolean(requested && config.enabled), before: [], after: [], failed: [] };
  if (!report.enabled) return report;
  const selected = config[phase];
  report[phase === "beforeReview" ? "before" : "after"].push(...selected);
  for (const name of selected) {
    const command = commands[name as keyof typeof commands];
    try {
      const env = { ...process.env };
      for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GITHUB_TOKEN", "GH_TOKEN", "SLACK_BOT_TOKEN"]) delete env[key];
      execFileSync(command.executable, command.args, { cwd: root, env, timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      report.failed.push(name);
    }
  }
  return report;
}
