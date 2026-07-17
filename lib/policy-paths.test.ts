import { describe, expect, it } from "vitest";
import { filterPathsByPolicy } from "./policy";

describe("policy path filters", () => {
  it("supports include and exclusion globs", () => {
    const files = [{ path: "src/app.ts" }, { path: "src/app.test.ts" }, { path: "docs/readme.md" }, { path: "package-lock.json" }];
    expect(filterPathsByPolicy(files, ["src/**", "!**/*.test.ts"])).toEqual([{ path: "src/app.ts" }]);
    expect(filterPathsByPolicy(files, ["!docs/**"])).toEqual([{ path: "src/app.ts" }, { path: "src/app.test.ts" }, { path: "package-lock.json" }]);
    expect(filterPathsByPolicy(files, ["!**/*.json"])).toEqual([{ path: "src/app.ts" }, { path: "src/app.test.ts" }, { path: "docs/readme.md" }]);
  });
});
