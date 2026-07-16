import { describe, expect, it } from "vitest";
import { parsePullRequestUrl } from "./github";

describe("parsePullRequestUrl", () => {
  it("normalizes a GitHub pull request URL", () => {
    expect(parsePullRequestUrl("https://github.com/acme/payments/pull/42/")).toEqual({ owner: "acme", repo: "payments", number: 42, url: "https://github.com/acme/payments/pull/42" });
  });

  it("rejects non-PR URLs", () => {
    expect(() => parsePullRequestUrl("https://github.com/acme/payments")).toThrow();
  });
});
