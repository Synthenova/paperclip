import { describe, expect, it, vi } from "vitest";
import { listLettaModels, parseLettaJsonl } from "@paperclipai/adapter-letta-local/server";
import { parseLettaStdoutLine } from "@paperclipai/adapter-letta-local/ui";
import { printLettaStreamEvent } from "@paperclipai/adapter-letta-local/cli";

describe("letta_local parser", () => {
  it("extracts init metadata and final result", () => {
    const stdout = [
      JSON.stringify({ type: "init", agentId: "agent-1", sessionId: "session-1", conversationId: "conv-1", model: "gpt-5.4" }),
      JSON.stringify({ type: "assistant", content: "working" }),
      JSON.stringify({ type: "result", success: true, result: "done", totalCostUsd: 0.12, conversationId: "conv-1" }),
    ].join("\n");

    expect(parseLettaJsonl(stdout)).toEqual({
      agentId: "agent-1",
      sessionId: "session-1",
      conversationId: "conv-1",
      model: "gpt-5.4",
      summary: "done",
      errorMessage: null,
      resultJson: {
        type: "result",
        success: true,
        result: "done",
        totalCostUsd: 0.12,
        conversationId: "conv-1",
      },
      costUsd: 0.12,
    });
  });
});

describe("letta_local model catalog", () => {
  it("fetches live models from the Letta API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { handle: "anthropic/claude-sonnet-4-6", display_name: "Claude Sonnet 4.6", model_type: "llm" },
        { name: "text-embedding-3-large", display_name: "Embedding", model_type: "embedding" },
        { name: "gpt-5.4", display_name: "GPT-5.4", model_type: "llm" },
      ],
    });

    const originalApiKey = process.env.LETTA_API_KEY;
    const originalBaseUrl = process.env.LETTA_BASE_URL;
    process.env.LETTA_API_KEY = "at-test-key";
    process.env.LETTA_BASE_URL = "https://api.letta.com";
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(listLettaModels()).resolves.toEqual([
        { id: "gpt-5.4", label: "GPT-5.4" },
        { id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        new URL("https://api.letta.com/v1/models/"),
        expect.objectContaining({
          headers: { Authorization: "Bearer at-test-key" },
          method: "GET",
        }),
      );
    } finally {
      if (originalApiKey === undefined) delete process.env.LETTA_API_KEY;
      else process.env.LETTA_API_KEY = originalApiKey;
      if (originalBaseUrl === undefined) delete process.env.LETTA_BASE_URL;
      else process.env.LETTA_BASE_URL = originalBaseUrl;
      vi.unstubAllGlobals();
    }
  });
});

describe("letta_local ui stdout parser", () => {
  it("parses init, tool calls, tool results, and failures", () => {
    const ts = "2026-04-01T00:00:00.000Z";

    expect(
      parseLettaStdoutLine(
        JSON.stringify({ type: "init", model: "gpt-5.4", conversationId: "conv-1" }),
        ts,
      ),
    ).toEqual([{ kind: "init", ts, model: "gpt-5.4", sessionId: "conv-1" }]);

    expect(
      parseLettaStdoutLine(
        JSON.stringify({ type: "tool_call", toolCallId: "call-1", toolName: "Read", toolInput: { file: "README.md" } }),
        ts,
      ),
    ).toEqual([{ kind: "tool_call", ts, name: "Read", toolUseId: "call-1", input: { file: "README.md" } }]);

    expect(
      parseLettaStdoutLine(
        JSON.stringify({ type: "tool_result", toolCallId: "call-1", content: "ok", isError: false }),
        ts,
      ),
    ).toEqual([{ kind: "tool_result", ts, toolUseId: "call-1", content: "ok", isError: false }]);

    expect(
      parseLettaStdoutLine(
        JSON.stringify({ type: "assistant", content: "I" }),
        ts,
      ),
    ).toEqual([{ kind: "assistant", ts, text: "I", delta: true }]);

    expect(
      parseLettaStdoutLine(
        JSON.stringify({ type: "system", subtype: "agent_reused", agentId: "agent-1" }),
        ts,
      ),
    ).toEqual([{ kind: "system", ts, text: "reused Letta agent agent-1" }]);

    expect(
      parseLettaStdoutLine(
        JSON.stringify({ type: "result", success: false, errorDetail: "conversation not found", totalCostUsd: 0.01 }),
        ts,
      ),
    ).toEqual([
      {
        kind: "result",
        ts,
        text: "",
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        costUsd: 0.01,
        subtype: "result",
        isError: true,
        errors: ["conversation not found"],
      },
    ]);

    expect(
      parseLettaStdoutLine(
        JSON.stringify({ type: "result", success: true, result: "done", totalCostUsd: 0.01 }),
        ts,
      ),
    ).toEqual([
      {
        kind: "result",
        ts,
        text: "",
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        costUsd: 0.01,
        subtype: "result",
        isError: false,
        errors: [],
      },
    ]);
  });
});

describe("letta_local cli formatter", () => {
  it("prints lifecycle and result events", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      printLettaStreamEvent(JSON.stringify({ type: "init", model: "gpt-5.4", conversationId: "conv-1" }), false);
      printLettaStreamEvent(JSON.stringify({ type: "assistant", content: "hello" }), false);
      printLettaStreamEvent(JSON.stringify({ type: "tool_call", toolName: "Read", toolInput: { file: "README.md" } }), false);
      printLettaStreamEvent(JSON.stringify({ type: "result", success: true, result: "done", totalCostUsd: 0.12 }), false);

      const output = spy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
      expect(output).toContain("Letta initialized");
      expect(output).toContain("assistant: hello");
      expect(output).toContain("tool_call: Read");
      expect(output).toContain("cost=$0.120000");
    } finally {
      spy.mockRestore();
    }
  });
});
