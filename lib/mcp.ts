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
export type McpValidation = { path: string; valid: boolean; servers: McpServerConfig[]; errors: string[] };
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

function mcpConfigPath(root: string): string {
  return process.env.MERGEPROOF_MCP_CONFIG || join(resolve(root), ".mergeproof", "mcp.json");
}

function validateServer(server: unknown, index: number): { server?: McpServerConfig; errors: string[] } {
  const errors: string[] = [];
  if (!server || typeof server !== "object") return { errors: [`Server ${index + 1} must be an object.`] };
  const value = server as Partial<McpServerConfig>;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const url = typeof value.url === "string" ? value.url.trim() : "";
  const tool = typeof value.tool === "string" ? value.tool.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) errors.push(`Server ${index + 1} has an unsafe or missing name.`);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") errors.push(`Server ${name || index + 1} must use http or https.`);
  } catch { errors.push(`Server ${name || index + 1} has an invalid URL.`); }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(tool)) errors.push(`Server ${name || index + 1} has an unsafe or missing tool name.`);
  const headers = value.headers ?? {};
  if (typeof headers !== "object" || Array.isArray(headers)) errors.push(`Server ${name || index + 1} headers must be an object.`);
  else for (const [key, headerValue] of Object.entries(headers)) if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/.test(key) || typeof headerValue !== "string" || headerValue.length > 500 || /[\r\n]/.test(headerValue)) errors.push(`Server ${name || index + 1} contains an invalid header.`);
  const argumentsValue = value.arguments ?? {};
  if (!argumentsValue || typeof argumentsValue !== "object" || Array.isArray(argumentsValue)) errors.push(`Server ${name || index + 1} arguments must be an object.`);
  if (errors.length) return { errors };
  return { server: { name, url, tool, ...(Object.keys(headers).length ? { headers: headers as Record<string, string> } : {}), ...(Object.keys(argumentsValue as Record<string, unknown>).length ? { arguments: argumentsValue as Record<string, unknown> } : {}) }, errors };
}

async function readMcpFile(root: string): Promise<{ path: string; config: McpConfig }> {
  const path = mcpConfigPath(root);
  try { return { path, config: JSON.parse(await fs.readFile(path, "utf8")) as McpConfig }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path, config: { servers: [] } }; throw new Error(`Unable to read MCP configuration: ${error instanceof Error ? error.message : "invalid JSON"}`); }
}

export async function validateMcpConfig(root: string): Promise<McpValidation> {
  const { path, config } = await readMcpFile(root);
  const raw = Array.isArray(config.servers) ? config.servers : [];
  const errors: string[] = [];
  if (raw.length > MAX_SERVERS) errors.push(`MCP configuration allows at most ${MAX_SERVERS} servers.`);
  const servers: McpServerConfig[] = [];
  const names = new Set<string>();
  raw.slice(0, MAX_SERVERS).forEach((value, index) => {
    const result = validateServer(value, index);
    errors.push(...result.errors);
    if (result.server) {
      if (names.has(result.server.name.toLowerCase())) errors.push(`MCP server names must be unique: ${result.server.name}.`);
      names.add(result.server.name.toLowerCase());
      servers.push(result.server);
    }
  });
  return { path, valid: errors.length === 0, servers, errors };
}

export async function upsertMcpServer(root: string, input: McpServerConfig): Promise<McpValidation> {
  const normalized = validateServer(input, 0);
  if (!normalized.server || normalized.errors.length) throw new Error(normalized.errors.join(" "));
  const validation = await validateMcpConfig(root);
  if (!validation.valid) throw new Error(`Cannot update invalid MCP configuration: ${validation.errors.join(" ")}`);
  const servers = [...validation.servers.filter((server) => server.name.toLowerCase() !== normalized.server!.name.toLowerCase()), normalized.server];
  if (servers.length > MAX_SERVERS) throw new Error(`MCP configuration allows at most ${MAX_SERVERS} servers.`);
  await fs.mkdir(join(resolve(root), ".mergeproof"), { recursive: true });
  await fs.writeFile(validation.path, `${JSON.stringify({ servers }, null, 2)}\n`, "utf8");
  return validateMcpConfig(root);
}

export async function removeMcpServer(root: string, name: string): Promise<McpValidation> {
  const validation = await validateMcpConfig(root);
  if (!validation.valid) throw new Error(`Cannot update invalid MCP configuration: ${validation.errors.join(" ")}`);
  const remaining = validation.servers.filter((server) => server.name.toLowerCase() !== name.trim().toLowerCase());
  if (remaining.length === validation.servers.length) throw new Error(`MCP server not found: ${name}`);
  await fs.mkdir(join(resolve(root), ".mergeproof"), { recursive: true });
  await fs.writeFile(validation.path, `${JSON.stringify({ servers: remaining }, null, 2)}\n`, "utf8");
  return validateMcpConfig(root);
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
