import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";

export type PermissionAction = "read" | "review" | "plan" | "implement" | "apply" | "publish" | "resolve" | "remote";
export type PermissionPolicy = { default?: "allow" | "deny"; actions?: Partial<Record<PermissionAction, "allow" | "deny">>; allowedPaths?: string[]; deniedPaths?: string[]; requireVerification?: boolean };
export type PermissionCheck = { paths?: string[]; verified?: boolean };

const ACTIONS: PermissionAction[] = ["read", "review", "plan", "implement", "apply", "publish", "resolve", "remote"];

function patterns(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).map((entry) => entry.trim().replace(/\\/g, "/")).slice(0, 100) : [];
}

function globToRegExp(pattern: string): RegExp {
  let expression = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") { expression += ".*"; index += 1; }
    else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${expression}$`, "i");
}

function pathMatches(path: string, patternsToCheck: string[]): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  return patternsToCheck.some((pattern) => globToRegExp(pattern).test(normalized));
}

export async function readPermissionPolicy(root: string): Promise<PermissionPolicy> {
  try {
    const value = JSON.parse(await fs.readFile(join(resolve(root), ".mergeproof", "permissions.json"), "utf8")) as PermissionPolicy;
    if (!value || typeof value !== "object") return {};
    const actions = value.actions && typeof value.actions === "object" ? Object.fromEntries(ACTIONS.filter((action) => value.actions?.[action] === "allow" || value.actions?.[action] === "deny").map((action) => [action, value.actions?.[action]])) as PermissionPolicy["actions"] : undefined;
    return { default: value.default === "deny" ? "deny" : value.default === "allow" ? "allow" : undefined, actions, allowedPaths: patterns(value.allowedPaths), deniedPaths: patterns(value.deniedPaths), requireVerification: value.requireVerification === true };
  } catch {
    return {};
  }
}

export async function assertPermission(root: string, action: PermissionAction, check: PermissionCheck = {}): Promise<void> {
  const policy = await readPermissionPolicy(root);
  const decision = policy.actions?.[action] ?? policy.default ?? "allow";
  if (decision === "deny") throw new Error(`MergeProof permission denied for action: ${action}.`);
  if (action === "apply" && policy.requireVerification && check.verified !== true) throw new Error("MergeProof policy requires verification before applying a patch.");
  const paths = (check.paths ?? []).map((path) => path.replace(/\\/g, "/"));
  const allowedPaths = policy.allowedPaths ?? [];
  if (paths.length && allowedPaths.length && paths.some((path) => !pathMatches(path, allowedPaths))) throw new Error("MergeProof permission denied because a changed path is outside allowedPaths.");
  if (paths.some((path) => pathMatches(path, policy.deniedPaths ?? []))) throw new Error("MergeProof permission denied because a changed path matches deniedPaths.");
}

export function renderPermissionPolicy(policy: PermissionPolicy): string {
  return JSON.stringify({ default: policy.default ?? "allow", actions: policy.actions ?? {}, allowedPaths: policy.allowedPaths ?? [], deniedPaths: policy.deniedPaths ?? [], requireVerification: policy.requireVerification === true }, null, 2);
}
