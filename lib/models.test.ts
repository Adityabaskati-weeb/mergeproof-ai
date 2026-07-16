import { afterEach, describe, expect, it, vi } from "vitest";
import { createModelProvider } from "./models";

afterEach(() => vi.unstubAllEnvs());

describe("createModelProvider", () => {
  it("routes OpenAI-compatible models through the configurable endpoint", () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_BASE_URL", "https://example.test/v1");
    expect(createModelProvider("local-model", "openai-compatible").name).toBe("openai-compatible:local-model");
  });

  it("allows local OpenAI-compatible endpoints without a cloud API key", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_BASE_URL", "http://127.0.0.1:11434/v1");
    expect(createModelProvider("qwen2.5-coder", "openai-compatible").name).toBe("openai-compatible:qwen2.5-coder");
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
