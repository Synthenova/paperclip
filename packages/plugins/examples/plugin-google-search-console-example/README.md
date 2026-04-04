# Google Search Console MCP

Paperclip connector plugin that exposes a Google Search Console MCP server, running behind Super Gateway, as agent tools.

## What it does

- registers the Google Search Console MCP tools as Paperclip plugin tools
- proxies tool calls to a configured MCP endpoint over streamable HTTP
- defaults to `http://72.61.251.227:8788/mcp`
- uses the built-in Paperclip plugin settings form for configuration

## Development

```bash
pnpm --filter @paperclipai/plugin-google-search-console-example typecheck
pnpm --filter @paperclipai/plugin-google-search-console-example test
pnpm --filter @paperclipai/plugin-google-search-console-example build
```

## Install Into Paperclip

From Plugin Manager, install the example plugin entry if it is listed.

Or install by local path:

```bash
curl -X POST http://127.0.0.1:3100/api/plugins/install \
  -H "Content-Type: application/json" \
  -d '{"packageName":"/home/lamrin/paperclip/packages/plugins/examples/plugin-google-search-console-example","isLocalPath":true}'
```

After install, open the plugin settings page and confirm the `MCP URL`.
