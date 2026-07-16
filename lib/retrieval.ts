import { promises as fs } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, extname, join, relative, resolve } from "node:path";
import type { PullRequestRef } from "./github";
import type { EvidenceChunk } from "./types";

const INDEX_VERSION = 1;
const IGNORED_DIRECTORIES = new Set([".git", ".mergeproof", "node_modules", "target", "dist", "build", ".next", "coverage"]);
const SENSITIVE_FILE_NAMES = new Set([".env", ".env.local", ".env.production", ".env.development", "id_rsa", "credentials.json"]);
const SENSITIVE_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx"]);
const MAX_FILE_BYTES = 250_000;
const CHUNK_LINES = 100;
const CHUNK_OVERLAP = 20;

type IndexedChunk = { path: string; startLine: number; endLine: number; content: string };
export type RepositoryIndex = { version: number; commitSha: string; chunks: IndexedChunk[] };
export type RetrievalResult = { chunks: EvidenceChunk[]; indexedChunks: number; indexCommitSha?: string };

function gitValue(root: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? [];
}

async function walk(root: string, current: string, paths: string[]): Promise<void> {
  if (paths.length >= 5000) return;
  for (const entry of await fs.readdir(current, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) await walk(root, absolute, paths);
    else if (entry.isFile()) paths.push(relative(root, absolute));
  }
}

export async function indexRepository(root: string): Promise<{ path: string; index: RepositoryIndex }> {
  const repositoryRoot = resolve(root);
  const paths: string[] = [];
  await walk(repositoryRoot, repositoryRoot, paths);
  const chunks: IndexedChunk[] = [];
  for (const path of paths) {
    const absolute = join(repositoryRoot, path);
    if (SENSITIVE_FILE_NAMES.has(basename(path).toLowerCase()) || SENSITIVE_EXTENSIONS.has(extname(path).toLowerCase())) continue;
    const stat = await fs.stat(absolute);
    if (stat.size > MAX_FILE_BYTES) continue;
    const content = await fs.readFile(absolute);
    if (content.includes(0)) continue;
    const lines = content.toString("utf8").split(/\r?\n/);
    for (let start = 0; start < lines.length; start += CHUNK_LINES - CHUNK_OVERLAP) {
      const end = Math.min(lines.length, start + CHUNK_LINES);
      const chunk = lines.slice(start, end).join("\n").trim();
      if (chunk) chunks.push({ path, startLine: start + 1, endLine: end, content: chunk });
      if (end === lines.length) break;
    }
  }
  const index: RepositoryIndex = { version: INDEX_VERSION, commitSha: gitValue(repositoryRoot, ["rev-parse", "HEAD"]) ?? "working-tree", chunks };
  const output = join(repositoryRoot, ".mergeproof", "index.json");
  await fs.mkdir(join(repositoryRoot, ".mergeproof"), { recursive: true });
  await fs.writeFile(output, JSON.stringify(index), "utf8");
  return { path: output, index };
}

async function loadIndex(root: string): Promise<RepositoryIndex | undefined> {
  try {
    const value = JSON.parse(await fs.readFile(join(resolve(root), ".mergeproof", "index.json"), "utf8")) as RepositoryIndex;
    return value.version === INDEX_VERSION ? value : undefined;
  } catch {
    return undefined;
  }
}

function remoteMatches(root: string, ref: PullRequestRef): boolean {
  const remote = gitValue(root, ["config", "--get", "remote.origin.url"]);
  if (!remote) return false;
  return new RegExp(`(?:github\\.com[:/])${ref.owner}/${ref.repo}(?:\\.git)?$`, "i").test(remote.replace(/\/$/, ""));
}

export async function retrieveRepositoryEvidence(root: string, ref: PullRequestRef, headSha: string, query: string, topK = 8): Promise<RetrievalResult> {
  const repositoryRoot = resolve(root);
  if (!remoteMatches(repositoryRoot, ref)) return { chunks: [], indexedChunks: 0 };
  let index = await loadIndex(repositoryRoot);
  if (!index) index = (await indexRepository(repositoryRoot)).index;
  if (index.commitSha !== headSha) return { chunks: [], indexedChunks: index.chunks.length, indexCommitSha: index.commitSha };
  const queryTokens = new Set(tokenize(query));
  const ranked = index.chunks.map((chunk) => {
    const contentTokens = tokenize(`${chunk.path} ${chunk.content}`);
    const score = contentTokens.reduce((total, token) => total + (queryTokens.has(token) ? 1 : 0), 0);
    return { chunk, score };
  }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || a.chunk.path.localeCompare(b.chunk.path)).slice(0, Math.max(1, topK));
  const urlBase = `https://github.com/${ref.owner}/${ref.repo}/blob/${headSha}`;
  return {
    indexedChunks: index.chunks.length,
    indexCommitSha: index.commitSha,
    chunks: ranked.map(({ chunk }) => ({ ...chunk, path: chunk.path.replace(/\\/g, "/"), commitSha: headSha, url: `${urlBase}/${chunk.path.replace(/\\/g, "/")}#L${chunk.startLine}-L${chunk.endLine}` })),
  };
}
