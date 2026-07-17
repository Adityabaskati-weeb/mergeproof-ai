import { describe, expect, it } from "vitest";
import { readAuthStatus, renderAuthStatus } from "./auth";

describe("integration auth diagnostics", () => {
  it("reports configured integrations without exposing credential values", () => {
    const report = readAuthStatus({ OPENAI_API_KEY: "secret-value", GH_TOKEN: "gh-secret", MERGEPROOF_PROVIDER: "openai-compatible", SLACK_BOT_TOKEN: "xoxb-secret" });
    expect(report.provider).toBe("openai-compatible");
    expect(report.entries.find((entry) => entry.id === "openai")?.status).toBe("configured");
    expect(report.entries.find((entry) => entry.id === "github")?.status).toBe("configured");
    const rendered = renderAuthStatus(report);
    expect(rendered).not.toContain("secret-value");
    expect(rendered).not.toContain("gh-secret");
    expect(rendered).toContain("CONFIGURED openai");
  });
});
