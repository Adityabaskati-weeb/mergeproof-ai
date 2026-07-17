import { describe, expect, it } from "vitest";
import { selectPostMergeActions } from "./post-merge";

describe("post-merge actions", () => {
  const actions = [
    { name: "changelog", prompt: "Draft a changelog entry." },
    { name: "disabled", prompt: "Do not run this.", enabled: false },
  ];

  it("selects only enabled actions and supports an explicit name", () => {
    expect(selectPostMergeActions(actions).map((action) => action.name)).toEqual(["changelog"]);
    expect(selectPostMergeActions(actions, "CHANGELOG")).toHaveLength(1);
  });

  it("rejects unknown or disabled actions", () => {
    expect(() => selectPostMergeActions(actions, "disabled")).toThrow("not found or disabled");
  });
});
