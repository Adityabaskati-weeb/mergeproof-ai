import { describe, expect, it } from "vitest";
import { VERIFICATION_COMMANDS } from "./local-agent";

describe("sandbox agent verification", () => {
  it("exposes only explicit, bounded verification commands", () => {
    expect(VERIFICATION_COMMANDS).toEqual(["npm test", "npm run build", "npm run typecheck", "pytest", "cargo test", "go test ./..."]);
    expect(VERIFICATION_COMMANDS).not.toContain("powershell -EncodedCommand ..." as never);
  });
});
