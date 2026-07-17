import { describe, expect, it } from "vitest";
import { parseIssueUrl } from "./issue-plan";

describe("issue planning URLs", () => {
  it("parses Jira and Linear issue URLs", () => {
    expect(parseIssueUrl("https://acme.atlassian.net/browse/PLAT-42")).toEqual({ provider: "jira", key: "PLAT-42", url: "https://acme.atlassian.net/browse/PLAT-42" });
    expect(parseIssueUrl("https://linear.app/acme/issue/PLAT-42/add-retries")).toMatchObject({ provider: "linear", key: "PLAT-42" });
    expect(() => parseIssueUrl("https://example.com/task/42")).toThrow();
  });

  it("parses GitHub issue URLs for issue planning", () => {
    expect(parseIssueUrl("https://github.com/acme/widget/issues/42/")).toEqual({ provider: "github", key: "#42", url: "https://github.com/acme/widget/issues/42", owner: "acme", repo: "widget", number: 42 });
  });
});
