import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";

function mockSseResponse(payload: unknown) {
  return new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
    },
  });
}

describe("google search console MCP plugin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers tools and proxies calls to the MCP endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockSseResponse({
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [{ type: "text", text: "properties here" }],
          structuredContent: { result: "properties here" },
          isError: false,
        },
      }),
    );
    const harness = createTestHarness({ manifest, capabilities: manifest.capabilities });
    harness.setConfig({ mcpUrl: "http://example.test:8788" });

    await plugin.definition.setup(harness.ctx);
    const result = await harness.executeTool("list_properties", {});

    expect(result.content).toBe("properties here");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://example.test:8788/mcp");

    const init = fetchMock.mock.calls[0]?.[1];
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    expect(body?.method).toBe("tools/call");
    expect(body?.params).toEqual({ name: "list_properties", arguments: {} });
  });

  it("validates the configured endpoint by listing MCP tools", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockSseResponse({
        jsonrpc: "2.0",
        id: 2,
        result: {
          tools: [{ name: "list_properties" }, { name: "get_search_analytics" }],
        },
      }),
    );
    const harness = createTestHarness({ manifest, capabilities: manifest.capabilities });

    const result = await plugin.definition.onValidateConfig?.(
      { mcpUrl: "http://example.test:8788/mcp" },
    );

    expect(result?.ok).toBe(true);
    expect(result?.warnings?.[0]).toContain("Discovered 2 MCP tools");
  });
});
