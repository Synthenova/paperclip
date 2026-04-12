import pc from "picocolors";

/**
 * Format claw stdout events for terminal output.
 *
 * Claw outputs JSON with:
 * - session_id, model, result, usage, error
 */
export function printClawStreamEvent(raw: string, debug: boolean): void {
  const trimmed = raw.trim();
  if (!trimmed) return;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;

    // Print result (assistant response)
    const result = typeof parsed.result === "string" ? parsed.result : null;
    if (result && result.trim().length > 0) {
      console.log(pc.green(result));
    }

    // Print model info
    const model = typeof parsed.model === "string" ? parsed.model : null;
    const sessionId = typeof parsed.session_id === "string" ? parsed.session_id : null;
    if (model || sessionId) {
      const parts = [];
      if (model) parts.push(pc.cyan(model));
      if (sessionId) parts.push(pc.dim(`session: ${sessionId}`));
      console.log(pc.blue(parts.join(" | ")));
    }

    // Print usage
    const usage = parsed.usage as Record<string, unknown> | undefined;
    if (usage) {
      const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
      const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
      const cachedTokens = typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : 0;

      let usageText = `${pc.yellow("tokens:")} ${inputTokens} in, ${outputTokens} out`;
      if (cachedTokens > 0) {
        usageText += `, ${cachedTokens} cached`;
      }
      console.log(pc.dim(usageText));
    }

    // Print error
    const error = typeof parsed.error === "string" ? parsed.error : null;
    if (error && error.trim().length > 0) {
      console.log(pc.red(error));
    }

    // Print cost if available
    const costUsd = typeof parsed.cost_usd === "number" ? parsed.cost_usd : null;
    if (costUsd !== null && costUsd > 0) {
      console.log(pc.dim(`cost: $${costUsd.toFixed(4)}`));
    }
  } catch {
    // Not JSON, print as-is
    if (debug) {
      console.log(pc.gray(`[unparsed] ${trimmed}`));
    } else {
      console.log(trimmed);
    }
  }
}
