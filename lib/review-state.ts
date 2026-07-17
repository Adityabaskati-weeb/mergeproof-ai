import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";

export type ReviewState = {
  paused: boolean;
  ignoredPullRequests: string[];
  updatedAt?: string;
  reason?: string;
};

const STATE_FILE = ".mergeproof/review-state.json";
const MAX_IGNORED = 500;

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/$/, "");
}

export async function readReviewState(root: string): Promise<ReviewState> {
  try {
    const value = JSON.parse(await fs.readFile(join(resolve(root), STATE_FILE), "utf8")) as Partial<ReviewState>;
    return {
      paused: value.paused === true,
      ignoredPullRequests: Array.isArray(value.ignoredPullRequests) ? value.ignoredPullRequests.filter((item): item is string => typeof item === "string").map(normalizeUrl).filter(Boolean).slice(-MAX_IGNORED) : [],
      ...(typeof value.updatedAt === "string" ? { updatedAt: value.updatedAt } : {}),
      ...(typeof value.reason === "string" ? { reason: value.reason.slice(0, 500) } : {}),
    };
  } catch {
    return { paused: false, ignoredPullRequests: [] };
  }
}

async function writeReviewState(root: string, state: ReviewState): Promise<ReviewState> {
  const repositoryRoot = resolve(root);
  await fs.mkdir(join(repositoryRoot, ".mergeproof"), { recursive: true });
  const next: ReviewState = { paused: state.paused, ignoredPullRequests: [...new Set(state.ignoredPullRequests.map(normalizeUrl).filter(Boolean))].slice(-MAX_IGNORED), updatedAt: new Date().toISOString(), ...(state.reason ? { reason: state.reason.slice(0, 500) } : {}) };
  await fs.writeFile(join(repositoryRoot, STATE_FILE), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function updateReviewState(root: string, update: { paused?: boolean; ignorePullRequest?: string; unignorePullRequest?: string; reason?: string }): Promise<ReviewState> {
  const current = await readReviewState(root);
  const ignored = new Set(current.ignoredPullRequests);
  if (update.ignorePullRequest) ignored.add(normalizeUrl(update.ignorePullRequest));
  if (update.unignorePullRequest) ignored.delete(normalizeUrl(update.unignorePullRequest));
  return writeReviewState(root, { ...current, ...(update.paused === undefined ? {} : { paused: update.paused }), ignoredPullRequests: [...ignored], ...(update.reason === undefined ? {} : { reason: update.reason }) });
}

export async function reviewSuppression(root: string, pullRequestUrl?: string): Promise<{ suppressed: boolean; reason?: "paused" | "ignored" }> {
  const state = await readReviewState(root);
  if (state.paused) return { suppressed: true, reason: "paused" };
  if (pullRequestUrl && state.ignoredPullRequests.includes(normalizeUrl(pullRequestUrl))) return { suppressed: true, reason: "ignored" };
  return { suppressed: false };
}
