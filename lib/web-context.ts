import type { PullRequestContext } from "./github";

const MAX_RESULTS = 5;
const MAX_SNIPPET_CHARS = 2_000;

export type WebSearchResult = { title: string; url: string; snippet: string };
export type WebSearchReport = { discussion: NonNullable<PullRequestContext["discussion"]>; sources: string[]; provider?: string; resultCount: number; unavailable?: string };
type SearchItem = { title?: string; url?: string; description?: string; content?: string; snippet?: string };

function validUrl(value: unknown): value is string {
  try {
    return typeof value === "string" && new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeResults(value: unknown): WebSearchResult[] {
  const payload = value as { web?: { results?: SearchItem[] }; results?: SearchItem[] };
  const candidates = payload.web?.results ?? payload.results ?? [];
  return candidates.flatMap((item) => {
    const url = item.url;
    if (!validUrl(url)) return [];
    return [{ title: String(item.title ?? url).slice(0, 300), url, snippet: String(item.description ?? item.content ?? item.snippet ?? "").slice(0, MAX_SNIPPET_CHARS) }];
  }).filter((result, index, values) => values.findIndex((candidate) => candidate.url === result.url) === index).slice(0, MAX_RESULTS);
}

export async function searchWebContext(context: Pick<PullRequestContext, "title" | "body">, criteria: string[], enabled = false): Promise<WebSearchReport> {
  const empty = { discussion: [], sources: [], resultCount: 0 } satisfies WebSearchReport;
  if (!enabled) return empty;
  const query = `${context.title} ${criteria.join(" ")} ${context.body.slice(0, 1500)}`.trim().slice(0, 4_000);
  try {
    let provider: string;
    let response: Response;
    if (process.env.TAVILY_API_KEY) {
      provider = "tavily";
      response = await fetch("https://api.tavily.com/search", { method: "POST", signal: AbortSignal.timeout(8_000), headers: { "content-type": "application/json" }, body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, max_results: MAX_RESULTS, include_answer: false }) });
    } else if (process.env.BRAVE_SEARCH_API_KEY) {
      provider = "brave";
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(MAX_RESULTS));
      response = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { accept: "application/json", "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY } });
    } else {
      return { ...empty, unavailable: "web search credentials are not configured" };
    }
    if (!response.ok) return { ...empty, provider, unavailable: `web search failed with HTTP ${response.status}` };
    const results = normalizeResults(await response.json());
    return { provider, resultCount: results.length, sources: results.map((result) => result.url), discussion: results.map((result) => ({ author: `web:${provider}`, body: `${result.title}\n${result.snippet}`, url: result.url })) };
  } catch (error) {
    return { ...empty, unavailable: error instanceof Error ? error.message : "web search failed" };
  }
}
