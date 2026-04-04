import type { AdapterExecutionResult } from "@paperclipai/adapter-utils";
import { asString, parseJson } from "@paperclipai/adapter-utils/server-utils";

export interface LettaParsedStream {
  agentId: string | null;
  sessionId: string | null;
  conversationId: string | null;
  model: string | null;
  summary: string;
  errorMessage: string | null;
  resultJson: Record<string, unknown> | null;
  costUsd: number | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function parseLettaJsonl(stdout: string): LettaParsedStream {
  let agentId: string | null = null;
  let sessionId: string | null = null;
  let conversationId: string | null = null;
  let model: string | null = null;
  let errorMessage: string | null = null;
  let resultJson: Record<string, unknown> | null = null;
  let costUsd: number | null = null;
  const assistantTexts: string[] = [];

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parsed = asRecord(parseJson(line));
    if (!parsed) continue;

    const type = asString(parsed.type, "");
    if (type === "init") {
      agentId = asString(parsed.agentId, agentId ?? "") || agentId;
      sessionId = asString(parsed.sessionId, sessionId ?? "") || sessionId;
      conversationId = asString(parsed.conversationId, conversationId ?? "") || conversationId;
      model = asString(parsed.model, model ?? "") || model;
      continue;
    }

    if (type === "assistant") {
      const text = asString(parsed.content, "").trim();
      if (text) assistantTexts.push(text);
      continue;
    }

    if (type === "error") {
      const text = asString(parsed.message, "").trim();
      if (text) errorMessage = text;
      continue;
    }

    if (type === "result") {
      resultJson = parsed;
      const text = asString(parsed.result, "").trim();
      if (text) {
        assistantTexts.length = 0;
        assistantTexts.push(text);
      }
      const err = asString(parsed.errorDetail, "").trim() || asString(parsed.error, "").trim();
      if (err) errorMessage = err;
      const rawCost = parsed.totalCostUsd;
      if (typeof rawCost === "number" && Number.isFinite(rawCost)) {
        costUsd = rawCost;
      }
      continue;
    }
  }

  return {
    agentId,
    sessionId,
    conversationId,
    model,
    summary: assistantTexts.join("\n\n").trim(),
    errorMessage,
    resultJson,
    costUsd,
  };
}

export function isLettaUnknownSessionError(errorMessage: string | null | undefined): boolean {
  const text = (errorMessage ?? "").trim();
  if (!text) return false;
  return /unknown\s+(?:session|conversation)|not\s+found|missing\s+(?:session|conversation|agent)|invalid\s+(?:session|conversation|agent)/i.test(text);
}

export function buildLettaFailure(result: Record<string, unknown> | null): string | null {
  if (!result) return null;
  const detail =
    asString(result.errorDetail, "").trim() ||
    asString(result.error, "").trim() ||
    asString(result.stopReason, "").trim();
  if (!detail) return null;
  return `Letta run failed: ${detail}`;
}

export function toAdapterResult(parsed: LettaParsedStream): Pick<
  AdapterExecutionResult,
  "model" | "costUsd" | "resultJson" | "summary" | "errorMessage"
> {
  return {
    model: parsed.model,
    costUsd: parsed.costUsd,
    resultJson: parsed.resultJson,
    summary: parsed.summary || null,
    errorMessage: parsed.errorMessage,
  };
}
