import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";

export type ReviewState = {
  paused: boolean;
  ignoredPullRequests: string[];
  autoPausedPullRequests: string[];
  reviewedCommitCounts: Record<string, number>;
  autoPauseAfterReviewedCommits?: number;
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
      autoPausedPullRequests: Array.isArray(value.autoPausedPullRequests) ? value.autoPausedPullRequests.filter((item): item is string => typeof item === "string").map(normalizeUrl).filter(Boolean).slice(-MAX_IGNORED) : [],
      reviewedCommitCounts: value.reviewedCommitCounts && typeof value.reviewedCommitCounts === "object" ? Object.fromEntries(Object.entries(value.reviewedCommitCounts).filter(([key, count]) => typeof key === "string" && Number.isInteger(count) && Number(count) >= 0).slice(-MAX_IGNORED).map(([key, count]) => [normalizeUrl(key), Number(count)])) : {},
      ...(Number.isInteger(value.autoPauseAfterReviewedCommits) && Number(value.autoPauseAfterReviewedCommits) > 0 ? { autoPauseAfterReviewedCommits: Number(value.autoPauseAfterReviewedCommits) } : {}),
      ...(typeof value.updatedAt === "string" ? { updatedAt: value.updatedAt } : {}),
      ...(typeof value.reason === "string" ? { reason: value.reason.slice(0, 500) } : {}),
    };
  } catch {
    return { paused: false, ignoredPullRequests: [], autoPausedPullRequests: [], reviewedCommitCounts: {} };
  }
}

async function writeReviewState(root: string, state: ReviewState): Promise<ReviewState> {
  const repositoryRoot = resolve(root);
  await fs.mkdir(join(repositoryRoot, ".mergeproof"), { recursive: true });
  const next: ReviewState = { paused: state.paused, ignoredPullRequests: [...new Set(state.ignoredPullRequests.map(normalizeUrl).filter(Boolean))].slice(-MAX_IGNORED), autoPausedPullRequests: [...new Set(state.autoPausedPullRequests.map(normalizeUrl).filter(Boolean))].slice(-MAX_IGNORED), reviewedCommitCounts: Object.fromEntries(Object.entries(state.reviewedCommitCounts).slice(-MAX_IGNORED)), ...(state.autoPauseAfterReviewedCommits && state.autoPauseAfterReviewedCommits > 0 ? { autoPauseAfterReviewedCommits: Math.min(1000, Math.floor(state.autoPauseAfterReviewedCommits)) } : {}), updatedAt: new Date().toISOString(), ...(state.reason ? { reason: state.reason.slice(0, 500) } : {}) };
  await fs.writeFile(join(repositoryRoot, STATE_FILE), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function updateReviewState(root: string, update: { paused?: boolean; ignorePullRequest?: string; unignorePullRequest?: string; autoPauseAfterReviewedCommits?: number; reason?: string }): Promise<ReviewState> {
  const current = await readReviewState(root);
  const ignored = new Set(current.ignoredPullRequests);
  const autoPaused = new Set(current.autoPausedPullRequests);
  const reviewedCommitCounts = { ...current.reviewedCommitCounts };
  if (update.ignorePullRequest) ignored.add(normalizeUrl(update.ignorePullRequest));
  if (update.unignorePullRequest) ignored.delete(normalizeUrl(update.unignorePullRequest));
  if (update.paused === false) {
    for (const pullRequestUrl of autoPaused) delete reviewedCommitCounts[pullRequestUrl];
    autoPaused.clear();
  }
  return writeReviewState(root, { ...current, ...(update.paused === undefined ? {} : { paused: update.paused }), ignoredPullRequests: [...ignored], autoPausedPullRequests: [...autoPaused], reviewedCommitCounts, ...(update.autoPauseAfterReviewedCommits === undefined ? {} : update.autoPauseAfterReviewedCommits > 0 ? { autoPauseAfterReviewedCommits: update.autoPauseAfterReviewedCommits } : { autoPauseAfterReviewedCommits: undefined }), ...(update.reason === undefined ? {} : { reason: update.reason }) });
}

export async function checkReviewAutoPause(root: string, pullRequestUrl: string, commitCount: number): Promise<{ suppressed: boolean; reason?: "auto-paused" }> {
  if (!Number.isInteger(commitCount) || commitCount < 1) return { suppressed: false };
  const state = await readReviewState(root);
  const normalized = normalizeUrl(pullRequestUrl);
  if (state.autoPausedPullRequests.includes(normalized)) return { suppressed: true, reason: "auto-paused" };
  const previous = state.reviewedCommitCounts[normalized];
  if (state.autoPauseAfterReviewedCommits && previous !== undefined && commitCount - previous >= state.autoPauseAfterReviewedCommits) {
    await writeReviewState(root, { ...state, autoPausedPullRequests: [...state.autoPausedPullRequests, normalized], reason: `Auto-paused after ${state.autoPauseAfterReviewedCommits} unreviewed commits.` });
    return { suppressed: true, reason: "auto-paused" };
  }
  return { suppressed: false };
}

export async function markReviewCompleted(root: string, pullRequestUrl: string, commitCount: number): Promise<ReviewState> {
  const state = await readReviewState(root);
  if (!Number.isInteger(commitCount) || commitCount < 1) return state;
  return writeReviewState(root, { ...state, reviewedCommitCounts: { ...state.reviewedCommitCounts, [normalizeUrl(pullRequestUrl)]: commitCount } });
}

export async function reviewSuppression(root: string, pullRequestUrl?: string): Promise<{ suppressed: boolean; reason?: "paused" | "ignored" | "auto-paused" }> {
  const state = await readReviewState(root);
  if (state.paused) return { suppressed: true, reason: "paused" };
  if (pullRequestUrl && state.autoPausedPullRequests.includes(normalizeUrl(pullRequestUrl))) return { suppressed: true, reason: "auto-paused" };
  if (pullRequestUrl && state.ignoredPullRequests.includes(normalizeUrl(pullRequestUrl))) return { suppressed: true, reason: "ignored" };
  return { suppressed: false };
}
