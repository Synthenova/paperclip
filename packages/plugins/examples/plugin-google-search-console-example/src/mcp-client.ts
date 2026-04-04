import type { ToolResult } from "@paperclipai/plugin-sdk";

export interface McpJsonRpcSuccess<T> {
  jsonrpc: "2.0";
  id: string | number | null;
  result: T;
}

export interface McpJsonRpcError {
  jsonrpc: "2.0";
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

type McpToolCallResult = {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export function normalizeMcpUrl(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  return raw.endsWith("/mcp") ? raw : `${raw.replace(/\/+$/, "")}/mcp`;
}

export async function callMcp<T>(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
  url: string,
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      method,
      params,
    }),
  });

  const payloadText = await response.text();
  if (!response.ok) {
    throw new Error(`MCP request failed with HTTP ${response.status}: ${payloadText}`);
  }

  const message = parseMcpPayload(payloadText);
  if ("error" in message) {
    throw new Error(`MCP error ${message.error.code}: ${message.error.message}`);
  }
  return message.result as T;
}

export function parseMcpPayload(
  payloadText: string,
): McpJsonRpcSuccess<unknown> | McpJsonRpcError {
  const trimmed = payloadText.trim();
  if (!trimmed) {
    throw new Error("MCP response was empty");
  }

  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as McpJsonRpcSuccess<unknown> | McpJsonRpcError;
  }

  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  if (dataLines.length === 0) {
    throw new Error(`Unable to parse MCP SSE payload: ${trimmed}`);
  }

  return JSON.parse(dataLines.join("\n")) as McpJsonRpcSuccess<unknown> | McpJsonRpcError;
}

export function toPaperclipToolResult(result: McpToolCallResult): ToolResult {
  const textParts = (result.content ?? [])
    .filter((entry) => entry.type === "text" && typeof entry.text === "string")
    .map((entry) => entry.text?.trim() ?? "")
    .filter(Boolean);
  const text = textParts.join("\n\n");
  const structuredResult = result.structuredContent?.result;

  if (result.isError) {
    return {
      error:
        typeof structuredResult === "string" && structuredResult.trim().length > 0
          ? structuredResult
          : text || "The MCP server returned an error.",
      data: result.structuredContent ?? {},
    };
  }

  return {
    content:
      typeof structuredResult === "string" && structuredResult.trim().length > 0
        ? structuredResult
        : text || "The MCP server returned no text content.",
    data: result.structuredContent ?? {},
  };
}
