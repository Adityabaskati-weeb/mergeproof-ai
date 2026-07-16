import { createSign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Octokit } from "@octokit/rest";

let cachedInstallationToken: { value: string; expiresAt: number } | undefined;

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function appJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  return `${unsigned}.${base64Url(signer.sign(privateKey))}`;
}

export async function resolveGithubToken(required = false, allowGhCli = false): Promise<string | undefined> {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    if (!allowGhCli) throw new Error("gh auth fallback disabled");
    if (process.env.MERGEPROOF_DISABLE_GH_AUTH === "1") throw new Error("gh auth disabled");
    const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8", timeout: 3_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (token) return token;
  } catch {
    // Public GitHub REST requests can still work without a local CLI token.
  }
  const appId = process.env.GITHUB_APP_ID;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
  const privateKey = process.env.GITHUB_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!appId || !installationId || !privateKey) {
    if (required) throw new Error("GITHUB_TOKEN or GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, and GITHUB_PRIVATE_KEY are required.");
    return undefined;
  }
  if (cachedInstallationToken && cachedInstallationToken.expiresAt > Date.now() + 60_000) return cachedInstallationToken.value;
  const response = await fetch(`https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
    method: "POST",
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${appJwt(appId, privateKey)}`, "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!response.ok) throw new Error(`GitHub App installation token request failed with HTTP ${response.status}.`);
  const payload = await response.json() as { token?: string; expires_at?: string };
  if (!payload.token) throw new Error("GitHub App installation token response did not include a token.");
  cachedInstallationToken = { value: payload.token, expiresAt: payload.expires_at ? Date.parse(payload.expires_at) : Date.now() + 3_000_000 };
  return payload.token;
}

export async function createGithubClient(required = false): Promise<Octokit> {
  const token = await resolveGithubToken(required, true);
  return new Octokit({ ...(token ? { auth: token } : {}), request: { timeout: 15_000 } });
}
