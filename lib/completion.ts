import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { execFileSync } from "node:child_process";
import { extname, relative, resolve } from "node:path";
import { createModelProvider } from "./models";

const MAX_FILE_BYTES = 500_000;
const MAX_BEFORE = 16_000;
const MAX_AFTER = 8_000;

export type CompletionOptions = {
  repoPath?: string;
  line?: number;
  column?: number;
  language?: string;
  request?: string;
  content?: string;
  provider?: string;
  signal?: AbortSignal;
};

export type CompletionResult = {
  completion: string;
  trace: { model: string; filePath: string; line: number; column: number; sourceDigest: string; elapsedMs: number; nonMutating: true };
};

function languageFor(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  return ({ ".ts": "typescript", ".tsx": "typescriptreact", ".js": "javascript", ".jsx": "javascriptreact", ".py": "python", ".go": "go", ".rs": "rust", ".java": "java", ".kt": "kotlin", ".cs": "csharp", ".rb": "ruby", ".php": "php", ".cpp": "cpp", ".c": "c", ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".md": "markdown" } as Record<string, string>)[extension] ?? "text";
}

function gitHead(root: string): string | undefined {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return undefined; }
}

function cursorOffset(content: string, line = 1, column = 1): { offset: number; line: number; column: number } {
  const safeLine = Math.max(1, Math.floor(line));
  const safeColumn = Math.max(1, Math.floor(column));
  const lines = content.split(/\r?\n/);
  const actualLine = Math.min(safeLine, Math.max(1, lines.length));
  const actualColumn = Math.min(safeColumn, lines[actualLine - 1].length + 1);
  let offset = 0;
  for (let index = 0; index < actualLine - 1; index += 1) offset += lines[index].length + 1;
  return { offset: offset + actualColumn - 1, line: actualLine, column: actualColumn };
}

export async function completeFile(filePath: string, model?: string, options: CompletionOptions = {}): Promise<CompletionResult> {
  const started = Date.now();
  const repositoryRoot = resolve(options.repoPath || process.cwd());
  const absolutePath = resolve(repositoryRoot, filePath);
  const relativePath = relative(repositoryRoot, absolutePath).replace(/\\/g, "/");
  if (!relativePath || relativePath.startsWith("..") || relativePath.includes(":")) throw new Error("Completion file must remain inside the repository.");
  const content = options.content ?? await fs.readFile(absolutePath, "utf8");
  if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) throw new Error(`Completion file exceeds the ${MAX_FILE_BYTES}-byte safety limit.`);
  const cursor = cursorOffset(content, options.line, options.column);
  const before = content.slice(Math.max(0, cursor.offset - MAX_BEFORE), cursor.offset);
  const after = content.slice(cursor.offset, Math.min(content.length, cursor.offset + MAX_AFTER));
  const providerName = (options.provider || process.env.MERGEPROOF_PROVIDER || "openai").toLowerCase();
  const selectedModel = model || process.env.OPENAI_MODEL || (providerName === "anthropic" ? process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514" : "gpt-5.6");
  const provider = createModelProvider(selectedModel, providerName as Parameters<typeof createModelProvider>[1]);
  if (!provider.complete) throw new Error(`Provider ${provider.name} does not support code completion.`);
  const result = await provider.complete({ filePath: relativePath, language: options.language || languageFor(relativePath), before, after, request: options.request, repository: repositoryRoot, headSha: gitHead(repositoryRoot) }, options.signal ?? AbortSignal.timeout(30_000));
  return { completion: result.completion, trace: { model: provider.name, filePath: relativePath, line: cursor.line, column: cursor.column, sourceDigest: createHash("sha256").update(`${relativePath}\0${content}`).digest("hex"), elapsedMs: Date.now() - started, nonMutating: true } };
}
