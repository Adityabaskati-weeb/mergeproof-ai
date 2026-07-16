import { afterEach, describe, expect, it, vi } from "vitest";
import { createModelProvider } from "./models";

afterEach(() => vi.unstubAllEnvs());

describe("createModelProvider", () => {
  it("routes OpenAI-compatible models through the configurable endpoint", () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_BASE_URL", "https://example.test/v1");
    expect(createModelProvider("local-model", "openai-compatible").name).toBe("openai-compatible:local-model");
  });

  it("supports Anthropic as a first-class provider", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    expect(createModelProvider("claude-test", "anthropic").name).toBe("anthropic:claude-test");
  });

  it("rejects unsupported providers", () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    expect(() => createModelProvider("test", "unknown" as never)).toThrow("Unsupported model provider");
  });
});
