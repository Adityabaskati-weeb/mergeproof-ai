import { describe, expect, it } from "vitest";
import { parseGithubIssueUrl } from "./task-agent";

describe("issue task agent", () => {
  it("parses GitHub issue URLs", () => {
    expect(parseGithubIssueUrl("https://github.com/acme/widget/issues/42/")).toEqual({ owner: "acme", repo: "widget", number: 42, url: "https://github.com/acme/widget/issues/42" });
  });

  it("rejects pull requests and non-GitHub URLs", () => {
    expect(() => parseGithubIssueUrl("https://github.com/acme/widget/pull/42")).toThrow();
    expect(() => parseGithubIssueUrl("https://linear.app/acme/issue/ABC-42")).toThrow();
  });
});
