import { describe, it, expect } from "vitest";
import { parseClawJsonOutput, isClawUnknownSessionError } from "./server/parse.js";

describe("claw-local parser", () => {
  it("should parse valid claw JSON output", () => {
    const sampleOutput = JSON.stringify({
      session_id: "session-123",
      result: "Hello, this is a test response",
      model: "claude-sonnet-4-6",
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 20,
      },
      cost_usd: 0.0015,
    });

    const parsed = parseClawJsonOutput(sampleOutput);

    expect(parsed.sessionId).toBe("session-123");
    expect(parsed.summary).toBe("Hello, this is a test response");
    expect(parsed.model).toBe("claude-sonnet-4-6");
    expect(parsed.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 20,
    });
    expect(parsed.costUsd).toBe(0.0015);
    expect(parsed.errorMessage).toBeNull();
  });

  it("should handle error responses", () => {
    const sampleOutput = JSON.stringify({
      error: "Authentication required. Please run 'claw login'.",
      session_id: null,
      result: null,
    });

    const parsed = parseClawJsonOutput(sampleOutput);

    expect(parsed.errorMessage).toBe("Authentication required. Please run 'claw login'.");
    expect(parsed.sessionId).toBeNull();
    expect(parsed.summary).toBeNull();
  });

  it("should detect unknown session errors", () => {
    const parsed1 = { error: "Unknown session ID: abc123" };
    const parsed2 = { error: "Session not found" };
    const parsed3 = { error: "Invalid session format" };
    const parsed4 = { error: "Some other error" };

    expect(isClawUnknownSessionError(parsed1)).toBe(true);
    expect(isClawUnknownSessionError(parsed2)).toBe(true);
    expect(isClawUnknownSessionError(parsed3)).toBe(true);
    expect(isClawUnknownSessionError(parsed4)).toBe(false);
  });

  it("should handle malformed JSON", () => {
    const parsed = parseClawJsonOutput("not valid json");

    expect(parsed.errorMessage).toBe("Failed to parse claw JSON output");
    expect(parsed.sessionId).toBeNull();
    expect(parsed.summary).toBeNull();
  });
});
