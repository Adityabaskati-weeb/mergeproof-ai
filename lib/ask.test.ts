import { describe, expect, it } from "vitest";
import { askRepository } from "./ask";

describe("repository ask", () => {
  it("rejects empty questions before loading a model or repository", async () => {
    await expect(askRepository("   ")).rejects.toThrow("non-empty question");
  });
});
