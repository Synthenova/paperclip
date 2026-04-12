import type { TranscriptEntry } from "@paperclipai/adapter-utils";

/**
 * Parse a single line of claw JSON output into transcript entries.
 *
 * Claw outputs one JSON object per run with:
 * - session_id + result (session/REPL mode)
 * - message (single-shot mode)
 * - usage stats
 * - tool calls (if any in the output)
 */
export function parseClawStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;

    const entries: TranscriptEntry[] = [];

    // Handle init event (session start)
    if (parsed.type === "init" || (parsed.session_id && !parsed.result && !parsed.message)) {
      const model = typeof parsed.model === "string" && parsed.model ? parsed.model : "unknown";
      const sessionId = typeof parsed.session_id === "string" && parsed.session_id ? parsed.session_id : "unknown";
      entries.push({
        kind: "init",
        ts,
        model,
        sessionId,
      });
    }

    // Handle result/message event (final output) - supports both session mode (result) and single-shot mode (message)
    const result = typeof parsed.result === "string" ? parsed.result : (typeof parsed.message === "string" ? parsed.message : null);
    if (result && result.trim().length > 0) {
      entries.push({
        kind: "assistant",
        ts,
        text: result,
      });
    }

    // Handle usage statistics - emit as a system message since result kind requires specific fields
    const usageObj = parsed.usage as Record<string, unknown> | undefined;
    if (usageObj) {
      const inputTokens = typeof usageObj.input_tokens === "number" ? usageObj.input_tokens : 0;
      const outputTokens = typeof usageObj.output_tokens === "number" ? usageObj.output_tokens : 0;
      const cachedTokens = typeof usageObj.cache_read_input_tokens === "number" ? usageObj.cache_read_input_tokens : (typeof usageObj.cache_creation_input_tokens === "number" ? usageObj.cache_creation_input_tokens : 0);

      entries.push({
        kind: "system",
        ts,
        text: `Usage: ${inputTokens} input, ${outputTokens} output${cachedTokens > 0 ? `, ${cachedTokens} cached` : ""}`,
      });
    }

    // Handle error
    const error = typeof parsed.error === "string" ? parsed.error : null;
    if (error && error.trim().length > 0) {
      entries.push({
        kind: "stderr",
        ts,
        text: error,
      });
    }

    // If we couldn't parse anything meaningful, fall back to stdout
    if (entries.length === 0) {
      entries.push({
        kind: "stdout",
        ts,
        text: trimmed,
      });
    }

    return entries;
  } catch {
    // Not valid JSON, treat as plain stdout
    return [
      {
        kind: "stdout",
        ts,
        text: trimmed,
      },
    ];
  }
}
