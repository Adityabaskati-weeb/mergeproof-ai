import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertSlackScope } from "./slack-scopes";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe("Slack scopes", () => {
  it("supports default-deny channel and action allowlists", async () => {
    const root = await fs.mkdtemp(join(process.env.TEMP ?? ".", "mergeproof-slack-scopes-"));
    roots.push(root);
    await fs.mkdir(join(root, ".mergeproof"), { recursive: true });
    await fs.writeFile(join(root, ".mergeproof", "slack-scopes.json"), JSON.stringify({ default: "deny", scopes: [{ name: "engineering", channelIds: ["C1"], userIds: ["U1"], actions: ["review", "plan"], maxRequestsPerHour: 2 }] }), "utf8");
    await expect(assertSlackScope(root, { action: "review", prUrl: "https://github.com/acme/app/pull/1" }, { channelId: "C1", userId: "U1" })).resolves.toBeUndefined();
    await expect(assertSlackScope(root, { action: "autofix", prUrl: "https://github.com/acme/app/pull/1" }, { channelId: "C1", userId: "U1" })).rejects.toThrow("Slack scope denied");
    await expect(assertSlackScope(root, { action: "review", prUrl: "https://github.com/acme/app/pull/1" }, { channelId: "C2", userId: "U1" })).rejects.toThrow("Slack scope denied");
  });

  it("enforces a durable hourly request budget", async () => {
    const root = await fs.mkdtemp(join(process.env.TEMP ?? ".", "mergeproof-slack-budget-"));
    roots.push(root);
    await fs.mkdir(join(root, ".mergeproof"), { recursive: true });
    await fs.writeFile(join(root, ".mergeproof", "slack-scopes.json"), JSON.stringify({ default: "deny", scopes: [{ name: "review-only", channelIds: ["C1"], userIds: ["U1"], actions: ["review"], maxRequestsPerHour: 1 }] }), "utf8");
    const command = { action: "review" as const, prUrl: "https://github.com/acme/app/pull/1" };
    await expect(assertSlackScope(root, command, { channelId: "C1", userId: "U1" })).resolves.toBeUndefined();
    await expect(assertSlackScope(root, command, { channelId: "C1", userId: "U1" })).rejects.toThrow("hourly request budget");
  });
});
