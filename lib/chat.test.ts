import { describe, expect, it } from "vitest";
import { parseChatInput } from "./chat";

describe("interactive chat input", () => {
  it("maps explicit slash commands and bare questions", () => {
    expect(parseChatInput("/plan add rate limiting")).toEqual({ action: "plan", request: "add rate limiting" });
    expect(parseChatInput("review https://github.com/acme/app/pull/1")).toEqual({ action: "review", request: "https://github.com/acme/app/pull/1" });
    expect(parseChatInput("How does auth work?")).toEqual({ action: "ask", request: "How does auth work?" });
    expect(parseChatInput("/quit")).toEqual({ action: "exit", request: "" });
  });
});
