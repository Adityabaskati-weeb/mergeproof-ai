import { describe, expect, it } from "vitest";
import { isTestPath } from "./tests";

describe("test patch safety", () => {
  it("allows common test locations", () => {
    expect(isTestPath("src/api.test.ts")).toBe(true);
    expect(isTestPath("tests/api.ts")).toBe(true);
    expect(isTestPath("src/api.ts")).toBe(false);
  });
});
