import { describe, expect, it } from "vitest";
import type { PullRequestContext } from "./github";
import { scanPullRequestSecurity } from "./security";

const baseContext: PullRequestContext = {
  ref: { owner: "acme", repo: "payments", number: 42, url: "https://github.com/acme/payments/pull/42" },
  title: "Add endpoint",
  body: "",
  headSha: "abc123",
  baseSha: "def456",
  files: [{ path: "src/api.ts", patch: "@@ -1,1 +1,3 @@\n import x from 'x';\n+const token = 'ghp_123456789012345678901234';\n+eval(input);\n", status: "modified", additions: 2, deletions: 0, url: "https://github.com/acme/payments/blob/abc123/src/api.ts" }],
  checks: [],
  sources: new Set(),
};

describe("pull request security scanner", () => {
  it("scans only added lines and returns commit-pinned citations", () => {
    const findings = scanPullRequestSecurity(baseContext);
    expect(findings.map((finding) => finding.id)).toContain("github-token:src/api.ts:2");
    expect(findings.map((finding) => finding.id)).toContain("dynamic-eval:src/api.ts:3");
    expect(findings.every((finding) => finding.citation.commitSha === "abc123")).toBe(true);
    expect(findings[0].citation.url).toContain("#L");
  });

  it("does not flag removed lines", () => {
    const context = { ...baseContext, files: [{ ...baseContext.files[0], patch: "@@ -1,2 +1,1 @@\n-const token = 'ghp_123456789012345678901234';\n import x from 'x';\n" }] };
    expect(scanPullRequestSecurity(context)).toHaveLength(0);
  });
});
