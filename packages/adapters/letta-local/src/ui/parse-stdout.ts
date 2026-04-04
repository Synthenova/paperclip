import type { TranscriptEntry } from "@paperclipai/adapter-utils";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function parseLettaStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const parsed = asRecord(safeJsonParse(line));
  if (!parsed) return [{ kind: "stdout", ts, text: line }];

  const type = typeof parsed.type === "string" ? parsed.type : "";
  if (type === "init") {
    return [{
      kind: "init",
      ts,
      model: typeof parsed.model === "string" ? parsed.model : "unknown",
      sessionId:
        typeof parsed.conversationId === "string"
          ? parsed.conversationId
          : typeof parsed.sessionId === "string"
            ? parsed.sessionId
            : "",
    }];
  }

  if (type === "system" && parsed.subtype === "agent_created") {
    const agentId = typeof parsed.agentId === "string" ? parsed.agentId : "unknown";
    const rotated = parsed.rotated === true;
    return [{ kind: "system", ts, text: `${rotated ? "rotated" : "created"} Letta agent ${agentId}` }];
  }

  if (type === "system" && parsed.subtype === "agent_reused") {
    const agentId = typeof parsed.agentId === "string" ? parsed.agentId : "unknown";
    return [{ kind: "system", ts, text: `reused Letta agent ${agentId}` }];
  }

  if (type === "assistant") {
    const text = typeof parsed.content === "string" ? parsed.content : "";
    return text ? [{ kind: "assistant", ts, text, delta: true }] : [];
  }

  if (type === "reasoning") {
    const text = typeof parsed.content === "string" ? parsed.content : "";
    return text ? [{ kind: "thinking", ts, text, delta: true }] : [];
  }

  if (type === "tool_call") {
    return [{
      kind: "tool_call",
      ts,
      name: typeof parsed.toolName === "string" ? parsed.toolName : "unknown",
      toolUseId: typeof parsed.toolCallId === "string" ? parsed.toolCallId : undefined,
      input: asRecord(parsed.toolInput) ?? {},
    }];
  }

  if (type === "tool_result") {
    return [{
      kind: "tool_result",
      ts,
      toolUseId: typeof parsed.toolCallId === "string" ? parsed.toolCallId : "",
      content: typeof parsed.content === "string" ? parsed.content : "",
      isError: parsed.isError === true,
    }];
  }

  if (type === "retry") {
    return [{
      kind: "system",
      ts,
      text: `retry ${parsed.attempt ?? "?"}/${parsed.maxAttempts ?? "?"}: ${typeof parsed.reason === "string" ? parsed.reason : "unknown"}`,
    }];
  }

  if (type === "error") {
    const text =
      (typeof parsed.errorDetail === "string" && parsed.errorDetail) ||
      (typeof parsed.message === "string" && parsed.message) ||
      "Letta error";
    return [{ kind: "stderr", ts, text }];
  }

  if (type === "result") {
    return [{
      kind: "result",
      ts,
      text:
        parsed.success === false && typeof parsed.result === "string"
          ? parsed.result
          : "",
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      costUsd:
        typeof parsed.totalCostUsd === "number" && Number.isFinite(parsed.totalCostUsd)
          ? parsed.totalCostUsd
          : 0,
      subtype: typeof parsed.stopReason === "string" ? parsed.stopReason : "result",
      isError: parsed.success === false,
      errors:
        parsed.success === false
          ? [
              (typeof parsed.errorDetail === "string" && parsed.errorDetail) ||
                (typeof parsed.error === "string" && parsed.error) ||
                "Letta run failed",
            ]
          : [],
    }];
  }

  return [{ kind: "stdout", ts, text: line }];
}
