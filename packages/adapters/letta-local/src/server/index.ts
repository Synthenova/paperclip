export { execute } from "./execute.js";
export { listLettaModels, fallbackLettaModels } from "./models.js";
export { listLettaSkills, syncLettaSkills } from "./skills.js";
export { testEnvironment } from "./test.js";
export { parseLettaJsonl, isLettaUnknownSessionError, buildLettaFailure } from "./parse.js";
import type { AdapterSessionCodec } from "@paperclipai/adapter-utils";

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export const sessionCodec: AdapterSessionCodec = {
  deserialize(raw: unknown) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const sessionId = readNonEmptyString(record.sessionId) ?? readNonEmptyString(record.session_id);
    const conversationId = readNonEmptyString(record.conversationId) ?? readNonEmptyString(record.conversation_id);
    const cwd = readNonEmptyString(record.cwd);
    const model = readNonEmptyString(record.model);
    const configSignature = readNonEmptyString(record.configSignature) ?? readNonEmptyString(record.config_signature);
    if (!sessionId && !conversationId && !cwd && !model && !configSignature) return null;
    return {
      ...(sessionId ? { sessionId } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(cwd ? { cwd } : {}),
      ...(model ? { model } : {}),
      ...(configSignature ? { configSignature } : {}),
    };
  },
  serialize(params: Record<string, unknown> | null) {
    if (!params) return null;
    const sessionId = readNonEmptyString(params.sessionId) ?? readNonEmptyString(params.session_id);
    const conversationId = readNonEmptyString(params.conversationId) ?? readNonEmptyString(params.conversation_id);
    const cwd = readNonEmptyString(params.cwd);
    const model = readNonEmptyString(params.model);
    const configSignature = readNonEmptyString(params.configSignature) ?? readNonEmptyString(params.config_signature);
    if (!sessionId && !conversationId && !cwd && !model && !configSignature) return null;
    return {
      ...(sessionId ? { sessionId } : {}),
      ...(conversationId ? { conversationId } : {}),
      ...(cwd ? { cwd } : {}),
      ...(model ? { model } : {}),
      ...(configSignature ? { configSignature } : {}),
    };
  },
  getDisplayId(params: Record<string, unknown> | null) {
    if (!params) return null;
    return readNonEmptyString(params.conversationId)
      ?? readNonEmptyString(params.sessionId)
      ?? readNonEmptyString(params.agentId);
  },
};
