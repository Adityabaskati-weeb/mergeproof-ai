import { describe, expect, it } from "vitest";
import { scanPullRequestPrivacy } from "./privacy";
import type { PullRequestContext } from "./github";

const context: PullRequestContext = { ref: { owner: "acme", repo: "app", number: 1, url: "https://github.com/acme/app/pull/1" }, title: "data", body: "", headSha: "sha", baseSha: "base", files: [{ path: "src/data.ts", patch: "@@ -0,0 +1,2 @@\n+const ssn = '123-45-6789';\n+const card = '4111 1111 1111 1111';", status: "added", additions: 2, deletions: 0, url: "https://github.com/acme/app/blob/sha/src/data.ts" }], checks: [], sources: new Set() };

describe("privacy scanner", () => {
  it("detects high-confidence sensitive literals", () => {
    const findings = scanPullRequestPrivacy(context);
    expect(findings.map((finding) => finding.title)).toEqual(expect.arrayContaining(["Possible US Social Security number", "Possible payment card number"]));
    expect(findings.every((finding) => finding.category === "privacy")).toBe(true);
  });
});
