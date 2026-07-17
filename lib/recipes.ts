import { promises as fs } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fetchChangeRequest, parseChangeRequestUrl } from "./change-request";
import { createGithubClient } from "./github-auth";
import { extractAcceptanceCriteria } from "./criteria";
import { createModelProvider } from "./models";
import { loadPolicy } from "./policy";
import { combineInstructions, loadAgentProfile } from "./agents";
import { retrieveRepositoryEvidence } from "./retrieval";
import { validatePatchPaths } from "./fix";
import { reviewWorkingTree } from "./local-review";
import { runVerificationCommand, type VerificationCommand } from "./local-agent";

const RECIPE_FILE = ".mergeproof/recipes.json";
const MAX_RECIPES = 20;

export type Recipe = { name: string; description: string; instructions: string; paths?: string[] };
export type RecipeOptions = { repoPath?: string; provider?: string; agent?: string; apply?: boolean; createPr?: boolean; branch?: string; verify?: VerificationCommand; reReview?: boolean; recipeDefinition?: Recipe };
export type RecipeRun = { recipe: Recipe; summary: string; patch: string; trace: { model: string; headSha: string; changedPaths: string[]; sandboxed: boolean; applied: boolean; verified: boolean; verificationCommand?: VerificationCommand; verificationOutput?: string; reReviewDecision?: string; reReviewPassed?: boolean; branch?: string; pullRequestUrl?: string } };

function validName(value: string): boolean { return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value); }

export async function loadRecipes(root: string): Promise<Recipe[]> {
  try {
    const raw = JSON.parse(await fs.readFile(join(resolve(root), RECIPE_FILE), "utf8")) as unknown;
    const values = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { recipes?: unknown[] }).recipes) ? (raw as { recipes: unknown[] }).recipes : [];
    return values.slice(0, MAX_RECIPES).flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const item = value as Partial<Recipe>;
      if (typeof item.name !== "string" || !validName(item.name) || typeof item.instructions !== "string" || !item.instructions.trim()) return [];
      return [{ name: item.name, description: typeof item.description === "string" ? item.description.slice(0, 500) : item.name, instructions: item.instructions.slice(0, 20_000), paths: Array.isArray(item.paths) ? item.paths.filter((path): path is string => typeof path === "string" && Boolean(path.trim())).slice(0, 50) : undefined }];
    });
  } catch {
    return [];
  }
}

function git(root: string, args: string[], input?: string): string { return execFileSync("git", args, { cwd: root, input, encoding: "utf8", stdio: input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"] }).toString().trim(); }
function normalizePatch(value: string): string { return value.replace(/^```(?:diff|patch)?\s*/i, "").replace(/\s*```$/, "").trim(); }
function ownerFromRemote(root: string, fallback: string): string { try { return git(root, ["config", "--get", "remote.origin.url"]).match(/github\.com[/:]([^/]+)\//i)?.[1] ?? fallback; } catch { return fallback; } }
function branchName(value: string): string { const branch = value.trim(); if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith("-") || branch.includes("..")) throw new Error("Unsafe recipe branch name."); return branch; }
function pathAllowed(path: string, paths?: string[]): boolean { return !paths?.length || paths.some((allowed) => path === allowed || path.startsWith(`${allowed.replace(/\/$/, "")}/`)); }

export async function runRecipe(prUrl: string, recipeName: string, model?: string, options: RecipeOptions = {}): Promise<RecipeRun> {
  const repositoryRoot = options.repoPath ? resolve(options.repoPath) : undefined;
  const recipes = options.recipeDefinition ? [] : await loadRecipes(repositoryRoot || process.cwd());
  const recipe = options.recipeDefinition ?? recipes.find((item) => item.name.toLowerCase() === recipeName.trim().toLowerCase());
  if (!recipe) throw new Error(`Recipe '${recipeName}' was not found in ${RECIPE_FILE}.`);
  const target = parseChangeRequestUrl(prUrl);
  if (options.createPr && !repositoryRoot) throw new Error("Recipe PR handoff requires --repo.");
  if (options.createPr && target.provider !== "github") throw new Error("Recipe PR handoff currently supports GitHub pull requests only.");
  if (options.createPr && !options.apply) options = { ...options, apply: true };
  const context = await fetchChangeRequest(target);
  const policy = await loadPolicy(repositoryRoot || process.cwd());
  const profile = await loadAgentProfile(repositoryRoot || process.cwd(), options.agent);
  const retrieval = repositoryRoot && target.provider === "github" ? await retrieveRepositoryEvidence(repositoryRoot, target.ref, context.headSha, `${context.title} ${context.body} ${recipe.instructions}`, policy.retrievalTopK ?? 8) : { chunks: [], indexedChunks: 0 };
  const criteria = [...extractAcceptanceCriteria(context.body).criteria, recipe.instructions].filter(Boolean);
  const providerName = (options.provider || policy.provider || process.env.MERGEPROOF_PROVIDER || "openai").toLowerCase();
  const selectedModel = model || policy.model || (providerName === "anthropic" ? process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514" : process.env.OPENAI_MODEL || "gpt-5.6");
  const provider = createModelProvider(selectedModel, providerName as Parameters<typeof createModelProvider>[1]);
  const result = await provider.recipe({ ...context, repositoryEvidence: retrieval.chunks, customInstructions: combineInstructions(policy.instructions, profile) }, [`${recipe.name}: ${recipe.instructions}`], AbortSignal.timeout(60_000));
  const patch = normalizePatch(result.patch);
  const changedPaths = patch ? validatePatchPaths(patch) : [];
  if (changedPaths.some((path) => !pathAllowed(path, recipe.paths))) throw new Error(`Recipe '${recipe.name}' proposed a path outside its configured scope.`);
  const baseTrace = { model: provider.name, headSha: context.headSha, changedPaths, sandboxed: false, applied: false, verified: false };
  if (!patch || !options.apply) return { recipe, summary: result.summary, patch, trace: baseTrace };
  if (!repositoryRoot) throw new Error("Applying a recipe requires --repo.");
  if (git(repositoryRoot, ["rev-parse", "HEAD"]) !== context.headSha) throw new Error(`Checkout SHA does not match the pull-request head ${context.headSha}.`);
  let sandbox: string | undefined;
  let branch: string | undefined;
  let verified = false;
  let verificationOutput = "";
  let reReviewDecision: string | undefined;
  let reReviewPassed: boolean | undefined;
  let pullRequestUrl: string | undefined;
  try {
    sandbox = await mkdtemp(join(tmpdir(), "mergeproof-recipe-"));
    git(repositoryRoot, ["worktree", "add", "--detach", sandbox, context.headSha]);
    if (options.createPr) { branch = branchName(options.branch || `mergeproof/recipe-${recipe.name}-${Date.now()}`); git(sandbox, ["checkout", "-b", branch]); }
    git(sandbox, ["apply", "--check", "--whitespace=error"], patch);
    git(sandbox, ["apply", "--whitespace=error"], patch);
    if (options.verify) { try { verificationOutput = runVerificationCommand(sandbox, options.verify); verified = true; } catch (error) { verificationOutput = error instanceof Error ? error.message : "Verification failed."; } } else verified = true;
    if (options.reReview) { if (!verified) { reReviewPassed = false; reReviewDecision = "needs-evidence"; } else { const review = await reviewWorkingTree(model, { repoPath: sandbox, provider: options.provider, agent: options.agent }); reReviewDecision = review.decision; reReviewPassed = review.decision === "ready"; } }
    if (options.createPr) {
      if (!verified || options.reReview && !reReviewPassed) throw new Error("Refusing to create a recipe PR because verification or re-review did not pass.");
      git(sandbox, ["add", "-A"]); git(sandbox, ["config", "user.name", "MergeProof Recipe Agent"]); git(sandbox, ["config", "user.email", "mergeproof-recipe@users.noreply.github.com"]); git(sandbox, ["commit", "-m", `Run MergeProof recipe ${recipe.name}`]); git(sandbox, ["push", "--set-upstream", "origin", branch!]);
      const owner = ownerFromRemote(repositoryRoot, target.ref.owner);
      const client = await createGithubClient(true);
      const body = [`This pull request was created by the explicit MergeProof recipe '${recipe.name}'.`, ``, `- Source PR: ${target.ref.url}`, `- Recipe: ${recipe.description}`, `- Verified against: ${context.headSha}`, `- Verification: ${options.verify ?? "patch application only"}`, options.reReview ? `- Re-review: ${reReviewDecision}` : "", ``, `The original pull-request branch was not modified.`].filter(Boolean).join("\n");
      const created = await client.rest.pulls.create({ owner: target.ref.owner, repo: target.ref.repo, title: `MergeProof recipe: ${recipe.description}`, head: owner === target.ref.owner ? branch! : `${owner}:${branch!}`, base: context.baseBranch ?? "main", body });
      pullRequestUrl = created.data.html_url;
    } else {
      git(repositoryRoot, ["apply", "--check", "--whitespace=error"], patch); git(repositoryRoot, ["apply", "--whitespace=error"], patch);
    }
  } finally {
    if (sandbox) { try { git(repositoryRoot, ["worktree", "remove", "--force", sandbox]); } catch { /* best effort */ } await rm(sandbox, { recursive: true, force: true }); }
  }
  return { recipe, summary: result.summary, patch, trace: { ...baseTrace, sandboxed: true, applied: true, verified, ...(options.verify ? { verificationCommand: options.verify, verificationOutput } : {}), ...(options.reReview ? { reReviewDecision, reReviewPassed } : {}), ...(branch ? { branch } : {}), ...(pullRequestUrl ? { pullRequestUrl } : {}) } };
}

export async function runRecipeInstruction(prUrl: string, recipe: Recipe, model?: string, options: Omit<RecipeOptions, "recipeDefinition"> = {}): Promise<RecipeRun> {
  return runRecipe(prUrl, recipe.name, model, { ...options, recipeDefinition: recipe });
}
