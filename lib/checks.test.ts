import { describe, expect, it } from "vitest";
import type { PullRequestContext } from "./github";

describe("CI evidence contract", () => {
  it("allows check summaries and annotation details to travel with the source", () => {
    const context: PullRequestContext = {
      ref: { owner: "acme", repo: "app", number: 1, url: "https://github.com/acme/app/pull/1" },
      title: "Change",
      body: "",
      headSha: "sha",
      baseSha: "base",
      files: [],
      checks: [{ name: "lint", status: "completed", conclusion: "failure", url: "https://github.com/acme/app/actions/runs/1", details: "src/app.ts:4 error: unused value" }],
      sources: new Set(["https://github.com/acme/app/actions/runs/1"]),
    };
    expect(context.checks[0].details).toContain("src/app.ts:4");
  });
});
