import { describe, expect, it } from "vitest";
import { scanSlopSignals } from "./slop";
import type { PullRequestContext } from "./github";

describe("quality signals", () => {
  it("flags placeholders and missing tests for large changes", () => {
    const context: PullRequestContext = { ref: { owner: "acme", repo: "app", number: 1, url: "https://github.com/acme/app/pull/1" }, title: "large", body: "", headSha: "sha", baseSha: "base", files: [{ path: "src/large.ts", patch: `@@ -0,0 +1,801 @@\n${Array.from({ length: 800 }, (_, index) => `+const value${index} = ${index};`).join("\n")}\n+// TODO: implement`, status: "added", additions: 801, deletions: 0, url: "https://github.com/acme/app/blob/sha/src/large.ts" }], checks: [], sources: new Set() };
    const findings = scanSlopSignals(context);
    expect(findings.map((finding) => finding.id)).toEqual(expect.arrayContaining(["placeholder:src/large.ts:801", "large-uncovered-change"]));
  });
});
