import { execute } from "./execute.js";
import { testEnvironment } from "./test.js";
import { parseClawJsonOutput, isClawUnknownSessionError } from "./parse.js";
import type { AdapterSessionCodec } from "@paperclipai/adapter-utils";

export { execute, testEnvironment, parseClawJsonOutput, isClawUnknownSessionError };

/**
 * Session codec for claw_local adapter.
 *
 * Persists:
 * - sessionId: the claw session ID for resume
 * - cwd: the working directory (for cwd-aware resume validation)
 */
export const sessionCodec: AdapterSessionCodec = {
  deserialize(raw) {
    if (!raw || typeof raw !== "object") return null;

    const obj = raw as Record<string, unknown>;
    const sessionId = typeof obj.sessionId === "string" ? obj.sessionId : null;
    const cwd = typeof obj.cwd === "string" ? obj.cwd : null;

    if (!sessionId) return null;

    return {
      sessionId,
      ...(cwd ? { cwd } : {}),
    };
  },

  serialize(params) {
    if (!params) return null;

    const sessionId = typeof params.sessionId === "string" ? params.sessionId : null;
    if (!sessionId) return null;

    return {
      sessionId,
      ...(typeof params.cwd === "string" ? { cwd: params.cwd } : {}),
    };
  },

  getDisplayId(params) {
    if (!params) return null;
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : null;
    return sessionId;
  },
};
