import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { DEFAULT_MCP_URL, PLUGIN_ID, PLUGIN_VERSION } from "./constants.js";
import { GSC_TOOL_DEFINITIONS } from "./tool-defs.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Google Search Console MCP",
  description: "Google Search Console connector that proxies a Super Gateway MCP endpoint into Paperclip agent tools.",
  author: "Paperclip",
  categories: ["connector"],
  capabilities: [
    "http.outbound",
    "agent.tools.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      mcpUrl: {
        type: "string",
        title: "MCP URL",
        default: DEFAULT_MCP_URL,
        description: "Base Super Gateway URL or full /mcp endpoint for the Google Search Console MCP server.",
      },
    },
  },
  tools: GSC_TOOL_DEFINITIONS,
};

export default manifest;
