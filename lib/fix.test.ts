import { describe, expect, it } from "vitest";
import { extractPatchPaths, validatePatchPaths } from "./fix";

describe("fix patch safety", () => {
  it("extracts ordinary unified-diff paths without corrupting filenames", () => {
    const patch = "--- a/backend.ts\n+++ b/backend.ts\n@@ -1 +1 @@\n-old\n+new\n";
    expect(extractPatchPaths(patch)).toEqual(["backend.ts", "backend.ts"]);
  });

  it("rejects traversal and absolute patch paths", () => {
    expect(() => validatePatchPaths("--- a/../secrets.txt\n+++ b/../secrets.txt\n")).toThrow("unsafe path");
    expect(() => validatePatchPaths("--- /tmp/secrets.txt\n+++ /tmp/secrets.txt\n")).toThrow("unsafe path");
  });

  it("requires a real patch path before applying a suggestion", () => {
    expect(() => validatePatchPaths("No safe patch is available.")).toThrow("no applicable patch paths");
  });
});
