import { execFileSync } from "node:child_process";

export type AuthStatus = "configured" | "missing" | "available";
export type AuthEntry = { id: string; status: AuthStatus; source: string; scope: string; remediation?: string };
export type AuthReport = { provider: string; entries: AuthEntry[] };

function hasAny(environment: NodeJS.ProcessEnv, names: string[]): string | undefined {
  return names.find((name) => Boolean(environment[name]?.trim()));
}

function githubCliAvailable(): boolean {
  try {
    execFileSync(process.platform === "win32" ? "gh.exe" : "gh", ["auth", "status", "--hostname", "github.com"], { stdio: "ignore", timeout: 5_000 });
    return true;
  } catch { return false; }
}

export function readAuthStatus(environment: NodeJS.ProcessEnv = process.env): AuthReport {
  const entries: AuthEntry[] = [];
  const githubToken = hasAny(environment, ["GH_TOKEN", "GITHUB_TOKEN"]);
  entries.push(githubToken || githubCliAvailable() ? { id: "github", status: "configured", source: githubToken ? "environment token" : "gh auth", scope: "GitHub repositories, pull requests, checks, and publication" } : { id: "github", status: "missing", source: "none", scope: "GitHub repositories, pull requests, checks, and publication", remediation: "Run `gh auth login` or set GH_TOKEN for private repositories." });
  entries.push(hasAny(environment, ["OPENAI_API_KEY", "OPENAI_BASE_URL"]) ? { id: "openai", status: "configured", source: "environment", scope: "OpenAI or OpenAI-compatible model calls" } : { id: "openai", status: "missing", source: "none", scope: "OpenAI or OpenAI-compatible model calls", remediation: "Set OPENAI_API_KEY or OPENAI_BASE_URL." });
  entries.push(environment.ANTHROPIC_API_KEY?.trim() ? { id: "anthropic", status: "configured", source: "environment", scope: "Anthropic model calls" } : { id: "anthropic", status: "missing", source: "none", scope: "Anthropic model calls", remediation: "Set ANTHROPIC_API_KEY when using the anthropic provider." });
  entries.push(environment.SLACK_BOT_TOKEN?.trim() || environment.SLACK_SIGNING_SECRET?.trim() ? { id: "slack", status: "configured", source: "environment", scope: "Slack summaries, agents, and signed event handling" } : { id: "slack", status: "missing", source: "none", scope: "Slack summaries, agents, and signed event handling" });
  entries.push(environment.DISCORD_PUBLIC_KEY?.trim() ? { id: "discord", status: "configured", source: "environment", scope: "Discord signed interaction handling" } : { id: "discord", status: "missing", source: "none", scope: "Discord signed interaction handling" });
  entries.push(environment.JIRA_BASE_URL?.trim() && hasAny(environment, ["JIRA_API_TOKEN", "JIRA_TOKEN"]) ? { id: "jira", status: "configured", source: "environment", scope: "Jira issue enrichment and follow-up creation" } : { id: "jira", status: "missing", source: "none", scope: "Jira issue enrichment and follow-up creation" });
  entries.push(environment.LINEAR_API_KEY?.trim() ? { id: "linear", status: "configured", source: "environment", scope: "Linear issue follow-up creation" } : { id: "linear", status: "missing", source: "none", scope: "Linear issue follow-up creation" });
  entries.push(hasAny(environment, ["TAVILY_API_KEY", "BRAVE_SEARCH_API_KEY"]) ? { id: "web-search", status: "configured", source: "environment", scope: "Opt-in external research context" } : { id: "web-search", status: "missing", source: "disabled by default", scope: "Opt-in external research context", remediation: "Set TAVILY_API_KEY or BRAVE_SEARCH_API_KEY only when external search is wanted." });
  return { provider: (environment.MERGEPROOF_PROVIDER || "openai").toLowerCase(), entries };
}

export function renderAuthStatus(report: AuthReport): string {
  return [`MergeProof auth status (model provider: ${report.provider})`, ...report.entries.map((entry) => `${entry.status === "configured" ? "CONFIGURED" : entry.status === "available" ? "AVAILABLE" : "MISSING"} ${entry.id}: ${entry.scope}${entry.source !== "none" ? ` [${entry.source}]` : ""}${entry.remediation ? ` - ${entry.remediation}` : ""}`)].join("\n");
}

export function runGithubAuth(action: "login" | "logout"): void {
  execFileSync(process.platform === "win32" ? "gh.exe" : "gh", ["auth", action, "--hostname", "github.com"], { stdio: "inherit" });
}
