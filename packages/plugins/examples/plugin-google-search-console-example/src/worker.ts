import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";
import { DEFAULT_MCP_URL } from "./constants.js";
import { callMcp, normalizeMcpUrl, toPaperclipToolResult } from "./mcp-client.js";
import { GSC_TOOL_DEFINITIONS } from "./tool-defs.js";

type McpToolListResult = {
  tools?: Array<{ name?: string }>;
};

type McpToolCallResult = {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

async function getConfiguredMcpUrl(ctx: { config: { get(): Promise<Record<string, unknown>> } }) {
  const config = await ctx.config.get();
  return normalizeMcpUrl(config.mcpUrl) || DEFAULT_MCP_URL;
}

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    for (const tool of GSC_TOOL_DEFINITIONS) {
      ctx.tools.register(tool.name, {
        displayName: tool.displayName,
        description: tool.description,
        parametersSchema: tool.parametersSchema,
      }, async (params: unknown) => {
        const mcpUrl = await getConfiguredMcpUrl(ctx);
        const result = await callMcp<McpToolCallResult>(
          ctx.http.fetch,
          mcpUrl,
          "tools/call",
          {
            name: tool.name,
            arguments: typeof params === "object" && params !== null ? params as Record<string, unknown> : {},
          },
        );
        return toPaperclipToolResult(result);
      });
    }

    ctx.logger.info("Google Search Console MCP plugin setup complete", {
      toolsRegistered: GSC_TOOL_DEFINITIONS.length,
    });
  },

  async onHealth() {
    return { status: "ok", message: "Plugin worker is running" };
  },

  async onValidateConfig(config: Record<string, unknown>) {
    const mcpUrl = normalizeMcpUrl(config.mcpUrl) || DEFAULT_MCP_URL;
    try {
      const result = await callMcp<McpToolListResult>(fetch, mcpUrl, "tools/list", {});
      const toolCount = Array.isArray(result.tools) ? result.tools.length : 0;
      return {
        ok: true,
        warnings: [`Connected successfully. Discovered ${toolCount} MCP tool${toolCount === 1 ? "" : "s"}.`],
        errors: [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        warnings: [],
        errors: [message],
      };
    }
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
