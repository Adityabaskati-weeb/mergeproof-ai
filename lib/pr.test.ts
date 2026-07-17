import { describe, expect, it } from "vitest";
import { parseGithubRemote } from "./pr";

describe("GitHub pull-request lifecycle", () => {
  it("parses HTTPS and SSH GitHub remotes", () => {
    expect(parseGithubRemote("https://github.com/acme/payments.git")).toEqual({ owner: "acme", repo: "payments" });
    expect(parseGithubRemote("git@github.com:acme/payments.git")).toEqual({ owner: "acme", repo: "payments" });
  });

  it("rejects non-GitHub remotes", () => {
    expect(() => parseGithubRemote("https://gitlab.com/acme/payments.git")).toThrow("github.com/owner/repo");
  });
});
