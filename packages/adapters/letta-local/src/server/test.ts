import path from "node:path";
import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import { asString, ensureAbsoluteDirectory, parseObject } from "@paperclipai/adapter-utils/server-utils";
import { createAgent, createSession } from "@letta-ai/letta-code-sdk";
import { DEFAULT_LETTA_LOCAL_MODEL } from "../index.js";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function applyScopedEnv(env: Record<string, string>) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const cwd = asString(config.cwd, process.cwd());

  try {
    await ensureAbsoluteDirectory(cwd, { createIfMissing: true });
    checks.push({
      code: "letta_cwd_valid",
      level: "info",
      message: `Working directory is valid: ${cwd}`,
    });
  } catch (err) {
    checks.push({
      code: "letta_cwd_invalid",
      level: "error",
      message: err instanceof Error ? err.message : "Invalid working directory",
      detail: cwd,
    });
  }

  try {
    await import("@letta-ai/letta-code-sdk");
    checks.push({
      code: "letta_sdk_importable",
      level: "info",
      message: "Letta Code SDK is installed and importable.",
    });
  } catch (err) {
    checks.push({
      code: "letta_sdk_missing",
      level: "error",
      message: err instanceof Error ? err.message : "Letta Code SDK is not available",
    });
  }

  const envConfig = parseObject(config.env);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }

  const hasApiKey = typeof env.LETTA_API_KEY === "string" && env.LETTA_API_KEY.trim().length > 0;
  if (hasApiKey || (process.env.LETTA_API_KEY ?? "").trim().length > 0) {
    checks.push({
      code: "letta_api_key_present",
      level: "info",
      message: "LETTA_API_KEY is configured.",
      detail: hasApiKey ? "Detected in adapter env." : "Detected in server environment.",
    });
  } else {
    checks.push({
      code: "letta_api_key_missing",
      level: "warn",
      message: "LETTA_API_KEY is not set. Letta can still work when CLI OAuth is already configured.",
      hint: "If SDK auth is not already working through CLI login, configure LETTA_API_KEY or complete Letta CLI login first.",
    });
  }

  const canRunProbe = checks.every((check) => check.level !== "error");
  if (canRunProbe) {
    const restoreEnv = applyScopedEnv({ ...env, HOME: env.HOME ?? process.env.HOME ?? "" });
    try {
      const agentId = await createAgent({
        model: asString(config.model, DEFAULT_LETTA_LOCAL_MODEL),
        cwd,
        memfs: true,
        permissionMode: "bypassPermissions",
      });
      await using session = createSession(agentId, {
        cwd,
        memfs: true,
        permissionMode: "bypassPermissions",
      });
      await session.send("Respond with hello.");
      let saidHello = false;
      for await (const message of session.stream()) {
        if (message.type === "assistant" && /\bhello\b/i.test(message.content)) {
          saidHello = true;
        }
        if (message.type === "result") {
          if (/\bhello\b/i.test(message.result ?? "")) {
            saidHello = true;
          }
          break;
        }
      }
      checks.push({
        code: saidHello ? "letta_hello_probe_passed" : "letta_hello_probe_unexpected_output",
        level: saidHello ? "info" : "warn",
        message: saidHello
          ? "Letta hello probe succeeded."
          : "Letta probe ran but did not return `hello` as expected.",
        ...(saidHello
          ? {}
          : {
              hint: "Retry the probe manually after checking Letta auth, model access, and memfs support.",
            }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      checks.push({
        code: "letta_hello_probe_failed",
        level: /auth|login|unauthorized|forbidden|api key/i.test(message) ? "warn" : "error",
        message: "Letta hello probe failed.",
        detail: message,
        hint: path.basename(cwd)
          ? "Verify Letta CLI/OAuth auth, model access, and that memfs is available for your Letta environment."
          : undefined,
      });
    } finally {
      restoreEnv();
    }
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
