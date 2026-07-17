import { describe, expect, it } from "vitest";
import { parseConflictMarkers } from "./conflicts";

describe("merge conflict inspection", () => {
  it("extracts current and incoming sides with line numbers", () => {
    const conflicts = parseConflictMarkers("before\n<<<<<<< HEAD\ncurrent\n=======\nincoming\n>>>>>>> feature\nafter\n");
    expect(conflicts).toEqual([{ startLine: 2, current: "current", incoming: "incoming" }]);
  });
});
