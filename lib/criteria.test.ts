import { describe, expect, it } from "vitest";
import { extractAcceptanceCriteria } from "./criteria";

describe("extractAcceptanceCriteria", () => {
  it("extracts bullets until the next heading", () => {
    const result = extractAcceptanceCriteria("## Acceptance Criteria\n- Retries twice\n- Uses backoff\n\n## Notes\n- Ignore this");
    expect(result.criteria).toEqual(["Retries twice", "Uses backoff"]);
    expect(result.section).toBe("Acceptance Criteria");
  });

  it("returns no criteria when the section is absent", () => {
    expect(extractAcceptanceCriteria("## Notes\n- Nothing specified").criteria).toEqual([]);
  });
});
