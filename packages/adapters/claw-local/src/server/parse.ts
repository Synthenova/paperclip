import { parseJson, asString, asNumber, parseObject } from "@paperclipai/adapter-utils/server-utils";

interface ParsedClawOutput {
  sessionId: string | null;
  summary: string | null;
  errorMessage: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
  } | null;
  costUsd: number | null;
  model: string | null;
  resultJson: Record<string, unknown> | null;
}

/**
 * Parse claw JSON output from --output-format json mode.
 *
 * Claw JSON output structure (single-shot mode):
 * - message: string (final response)
 * - model: string
 * - usage: { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, ... }
 * - estimated_cost: string
 * - iterations: number
 * - tool_uses: array
 * - tool_results: array
 * - auto_compaction: object | null
 * - prompt_cache_events: array
 *
 * Claw JSON output structure (session/REPL mode):
 * - session_id: string
 * - result: string (final response)
 * - usage: { input_tokens, output_tokens, ... }
 * - error: string | null
 * - model: string
 */
export function parseClawJsonOutput(stdout: string): ParsedClawOutput {
  const parsed = parseJson(stdout);

  if (!parsed) {
    return {
      sessionId: null,
      summary: null,
      errorMessage: "Failed to parse claw JSON output",
      usage: null,
      costUsd: null,
      model: null,
      resultJson: { stdout, stderr: "" },
    };
  }

  const usageObj = parseObject(parsed.usage);
  const usage = usageObj ? {
    inputTokens: asNumber(usageObj.input_tokens, 0),
    outputTokens: asNumber(usageObj.output_tokens, 0),
    cachedInputTokens: asNumber(usageObj.cache_read_input_tokens, 0) || asNumber(usageObj.cache_creation_input_tokens, 0) || undefined,
  } : null;

  const errorRaw = parsed.error;
  const error = typeof errorRaw === "string" ? errorRaw : "";
  const errorMessage = error && error.trim().length > 0 ? error : null;

  const sessionIdRaw = parsed.session_id;
  // Support both "result" (session mode) and "message" (single-shot mode)
  const resultRaw = parsed.result ?? parsed.message;
  const costUsdRaw = parsed.cost_usd ?? parsed.estimated_cost;
  const modelRaw = parsed.model;

  // Parse estimated_cost string to number if needed
  let costUsd: number | null = typeof costUsdRaw === "number" ? costUsdRaw : null;
  if (typeof costUsdRaw === "string" && costUsdRaw.startsWith("$")) {
    costUsd = parseFloat(costUsdRaw.slice(1));
    if (isNaN(costUsd)) costUsd = null;
  }

  return {
    sessionId: typeof sessionIdRaw === "string" ? sessionIdRaw : null,
    summary: typeof resultRaw === "string" ? resultRaw : null,
    errorMessage,
    usage,
    costUsd,
    model: typeof modelRaw === "string" ? modelRaw : null,
    resultJson: parsed,
  };
}

/**
 * Check if the error indicates an unknown/invalid session.
 * This is used for session retry logic.
 */
export function isClawUnknownSessionError(parsed: Record<string, unknown>): boolean {
  const error = asString(parsed.error, "");
  if (!error) return false;

  const errorLower = error.toLowerCase();
  return (
    errorLower.includes("unknown session") ||
    errorLower.includes("session not found") ||
    errorLower.includes("invalid session") ||
    errorLower.includes("session.*not found")
  );
}

/**
 * Detect if claw needs authentication (OAuth login required).
 */
export function detectClawAuthRequired(input: {
  parsed: Record<string, unknown> | null;
  stdout: string;
  stderr: string;
}): { requiresAuth: boolean; authHint: string | null } {
  const { parsed, stdout, stderr } = input;

  const combinedOutput = `${stdout}\n${stderr}`.toLowerCase();

  if (combinedOutput.includes("authentication required") ||
      combinedOutput.includes("login required") ||
      combinedOutput.includes("please run claw login")) {
    return {
      requiresAuth: true,
      authHint: "Run 'claw login' to authenticate with OAuth",
    };
  }

  const error = asString(parsed?.error, "");
  if (error && (error.toLowerCase().includes("auth") || error.toLowerCase().includes("unauthorized"))) {
    return {
      requiresAuth: true,
      authHint: "Authentication failed. Check ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or run 'claw login'",
    };
  }

  return { requiresAuth: false, authHint: null };
}

/**
 * Describe a claw failure in human-readable terms.
 */
export function describeClawFailure(parsed: Record<string, unknown> | null): string | null {
  if (!parsed) return null;

  const error = asString(parsed.error, "");
  if (error) return error;

  const exitCode = parsed.exit_code ?? parsed.exitCode;
  if (exitCode !== null && exitCode !== undefined && exitCode !== 0) {
    return `Claw exited with code ${exitCode}`;
  }

  return null;
}
