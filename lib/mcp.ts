import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import type { PullRequestContext } from "./github";

const MAX_SERVERS = 4;
const MAX_CONTEXT_CHARS = 20_000;
const MCP_PROTOCOL_VERSION = "2025-06-18";

export type McpServerConfig = {
  name: string;
  url: string;
  tool: string;
  headers?: Record<string, string>;
  arguments?: Record<string, unknown>;
};

export type McpConfig = { servers?: McpServerConfig[] };
export type McpContextResult = {
  discussion: NonNullable<PullRequestContext["discussion"]>;
  sources: string[];
  successful: string[];
  failed: string[];
};

type JsonRpcEnvelope = { result?: unknown; error?: { message?: string } };

function interpolate(value: string, context: Record<string, string>): string {
  return value.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => context[key] ?? "");
}

function resolveConfigValue(value: unknown, context: Record<string, string>): unknown {
  if (typeof value === "string") return interpolate(value, context).replace(/\$\{([A-Z0-9_]+)\}/g, (_, key: string) => process.env[key] ?? "");
  if (Array.isArray(value)) return value.map((item) => resolveConfigValue(item, context));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveConfigValue(item, context)]));
  return value;
}

function parseResponse(text: string, contentType: string): unknown {
  if (contentType.includes("text/event-stream")) {
    const events = text.split(/\r?\n\r?\n/).flatMap((block) => block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean));
    const data = events.at(-1);
    return data ? JSON.parse(data) : {};
  }
  return JSON.parse(text || "{}");
}

export function parseMcpResponse(text: string, contentType = "application/json"): JsonRpcEnvelope {
  return parseResponse(text, contentType) as JsonRpcEnvelope;
}

export function renderMcpArguments(argumentsTemplate: Record<string, unknown> | undefined, context: Record<string, string>): Record<string, unknown> {
  return (resolveConfigValue(argumentsTemplate ?? {}, context) ?? {}) as Record<string, unknown>;
}

export async function loadMcpConfig(root?: string): Promise<McpConfig> {
  const configPath = process.env.MERGEPROOF_MCP_CONFIG || (root ? join(resolve(root), ".mergeproof", "mcp.json") : undefined);
  if (!configPath) return {};
  try {
    const value = JSON.parse(await fs.readFile(configPath, "utf8")) as McpConfig;
    return { servers: (value.servers ?? []).slice(0, MAX_SERVERS).filter((server) => Boolean(server?.name && server?.url && server?.tool)) };
  } catch {
    return {};
  }
}

async function request(url: string, headers: Record<string, string>, id: number, method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { method: "POST", signal, headers: { accept: "application/json, text/event-stream", "content-type": "application/json", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
  if (!response.ok) throw new Error(`MCP request failed with HTTP ${response.status}.`);
  const envelope = parseMcpResponse(await response.text(), response.headers.get("content-type") ?? "application/json");
  if (envelope.error) throw new Error(envelope.error.message ?? "MCP server returned an error.");
  return envelope.result;
}

function resultText(value: unknown): string {
  const result = value as { content?: Array<{ type?: string; text?: string }> };
  const text = Array.isArray(result?.content) ? result.content.filter((item) => item.type === "text" && item.text).map((item) => item.text).join("\n") : JSON.stringify(value);
  return text.slice(0, MAX_CONTEXT_CHARS);
}

export async function fetchMcpContext(root: string | undefined, context: Pick<PullRequestContext, "ref" | "title" | "body" | "headSha">, criteria: string[], enabled = false): Promise<McpContextResult> {
  if (!enabled) return { discussion: [], sources: [], successful: [], failed: [] };
  const config = await loadMcpConfig(root);
  const output: McpContextResult = { discussion: [], sources: [], successful: [], failed: [] };
  const templateContext = { prUrl: context.ref.url, title: context.title, body: context.body.slice(0, 6000), headSha: context.headSha, criteria: criteria.join("\n") };
  for (const server of config.servers ?? []) {
    try {
      const headers = Object.fromEntries(Object.entries(server.headers ?? {}).map(([key, value]) => [key, interpolate(value, templateContext).replace(/\$\{([A-Z0-9_]+)\}/g, (_, env: string) => process.env[env] ?? "")]));
      const signal = AbortSignal.timeout(10_000);
      await request(server.url, headers, 1, "initialize", { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "mergeproof", version: "0.5.0" } }, signal);
      await request(server.url, headers, 2, "notifications/initialized", {}, signal).catch(() => undefined);
      const tools = await request(server.url, headers, 3, "tools/list", {}, signal) as { tools?: Array<{ name?: string; annotations?: { readOnlyHint?: boolean } }> };
      const tool = tools.tools?.find((candidate) => candidate.name === server.tool);
      if (!tool || tool.annotations?.readOnlyHint !== true) throw new Error(`Configured MCP tool is not an explicitly read-only tool: ${server.tool}`);
      const result = await request(server.url, headers, 4, "tools/call", { name: server.tool, arguments: renderMcpArguments(server.arguments, templateContext) }, signal);
      const text = resultText(result);
      if (!text) throw new Error("MCP tool returned no text context.");
      const source = `${server.url}#mcp=${encodeURIComponent(server.name)}:${encodeURIComponent(server.tool)}`;
      output.sources.push(source);
      output.successful.push(server.name);
      output.discussion.push({ author: `mcp:${server.name}`, body: text, url: source });
    } catch (error) {
      output.failed.push(`${server.name}: ${error instanceof Error ? error.message : "request failed"}`);
    }
  }
  return output;
}
