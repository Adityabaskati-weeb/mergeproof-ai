import { describe, expect, it } from "vitest";
import { isDocumentationSafePath } from "./docstrings";

describe("documentation patch boundaries", () => {
  it("keeps the test-path guard available to documentation workflows", () => {
    const changed = new Set(["src/payment.test.ts", "src/payment.ts"]);
    expect(isDocumentationSafePath("src/payment.test.ts", changed)).toBe(false);
    expect(isDocumentationSafePath("src/payment.ts", changed)).toBe(true);
    expect(isDocumentationSafePath("src/other.ts", changed)).toBe(false);
  });
});
