import fs from "node:fs/promises";
import path from "node:path";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import type { RunProcessResult } from "@paperclipai/adapter-utils/server-utils";
import {
  asString,
  asNumber,
  asBoolean,
  asStringArray,
  parseObject,
  buildPaperclipEnv,
  joinPromptSections,
  buildInvocationEnvForLogs,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  resolveCommandForLogs,
  renderTemplate,
  runChildProcess,
} from "@paperclipai/adapter-utils/server-utils";
import {
  parseClawJsonOutput,
  isClawUnknownSessionError,
  detectClawAuthRequired,
  describeClawFailure,
} from "./parse.js";

/**
 * Strip ANSI escape codes from terminal output.
 * Claw uses ANSI codes for progress indicators and thinking states.
 */
function stripAnsi(text: string): string {
  return text
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

const DEFAULT_PROMPT_TEMPLATE =
  "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work.";
const DEFAULT_TIMEOUT_SEC = 600;
const DEFAULT_GRACE_SEC = 20;

/**
 * Build the runtime configuration for claw execution.
 */
async function buildClawRuntimeConfig(input: {
  runId: string;
  agent: AdapterExecutionContext["agent"];
  config: Record<string, unknown>;
  context: Record<string, unknown>;
  authToken?: string;
}) {
  const { runId, agent, config, context, authToken } = input;

  const command = asString(config.command, "claw");
  const configuredCwd = asString(config.cwd, "");
  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const agentHome = asString(workspaceContext.agentHome, "");

  const cwd = workspaceCwd || configuredCwd || process.cwd();
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  const envConfig = parseObject(config.env);
  const env: Record<string, string> = { ...buildPaperclipEnv(agent) };
  env.PAPERCLIP_RUN_ID = runId;

  // Inject Paperclip context variables
  const wakeTaskId =
    (typeof context.taskId === "string" && context.taskId.trim().length > 0 && context.taskId.trim()) ||
    (typeof context.issueId === "string" && context.issueId.trim().length > 0 && context.issueId.trim()) ||
    null;
  const wakeReason =
    typeof context.wakeReason === "string" && context.wakeReason.trim().length > 0
      ? context.wakeReason.trim()
      : null;
  const wakeCommentId =
    (typeof context.wakeCommentId === "string" && context.wakeCommentId.trim().length > 0 && context.wakeCommentId.trim()) ||
    (typeof context.commentId === "string" && context.commentId.trim().length > 0 && context.commentId.trim()) ||
    null;
  const approvalId =
    typeof context.approvalId === "string" && context.approvalId.trim().length > 0
      ? context.approvalId.trim()
      : null;
  const approvalStatus =
    typeof context.approvalStatus === "string" && context.approvalStatus.trim().length > 0
      ? context.approvalStatus.trim()
      : null;
  const linkedIssueIds = Array.isArray(context.issueIds)
    ? context.issueIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  if (wakeTaskId) env.PAPERCLIP_TASK_ID = wakeTaskId;
  if (wakeReason) env.PAPERCLIP_WAKE_REASON = wakeReason;
  if (wakeCommentId) env.PAPERCLIP_WAKE_COMMENT_ID = wakeCommentId;
  if (approvalId) env.PAPERCLIP_APPROVAL_ID = approvalId;
  if (approvalStatus) env.PAPERCLIP_APPROVAL_STATUS = approvalStatus;
  if (linkedIssueIds.length > 0) env.PAPERCLIP_LINKED_ISSUE_IDS = linkedIssueIds.join(",");

  // Layer in user-provided env vars
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }

  // Inject Paperclip API key if no explicit key in config
  const hasExplicitApiKey =
    typeof envConfig.PAPERCLIP_API_KEY === "string" && envConfig.PAPERCLIP_API_KEY.trim().length > 0;
  if (!hasExplicitApiKey && authToken) {
    env.PAPERCLIP_API_KEY = authToken;
  }

  const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });
  await ensureCommandResolvable(command, cwd, runtimeEnv);
  const resolvedCommand = await resolveCommandForLogs(command, cwd, runtimeEnv);
  const loggedEnv = buildInvocationEnvForLogs(env, {
    runtimeEnv,
    includeRuntimeKeys: ["HOME", "CLAW_CONFIG_DIR", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"],
    resolvedCommand,
  });

  const timeoutSec = asNumber(config.timeoutSec, DEFAULT_TIMEOUT_SEC);
  const graceSec = asNumber(config.graceSec, DEFAULT_GRACE_SEC);
  const extraArgs = asStringArray(config.extraArgs);

  return {
    command,
    resolvedCommand,
    cwd,
    env,
    loggedEnv,
    timeoutSec,
    graceSec,
    extraArgs,
  };
}

/**
 * Serialize an event for logging to the run transcript.
 */
function serializeEvent(event: unknown): string {
  return `${JSON.stringify(event)}\n`;
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, onMeta, authToken } = ctx;

  const promptTemplate = asString(
    config.promptTemplate,
    DEFAULT_PROMPT_TEMPLATE,
  );
  const model = asString(config.model, "");
  const dangerouslySkipPermissions = asBoolean(config.dangerouslySkipPermissions, false);
  const timeoutSec = asNumber(config.timeoutSec, DEFAULT_TIMEOUT_SEC);
  const graceSec = asNumber(config.graceSec, DEFAULT_GRACE_SEC);

  // Detect if this is a chat run - chat runs need stable session IDs for persistence
  const isChatRun = asBoolean(context.chatMode, false) || (asString(context.taskKey, "").startsWith("chat:"));
  const chatThreadId = asString(context.chatThreadId, "") || null;

  const runtimeConfig = await buildClawRuntimeConfig({
    runId,
    agent,
    config,
    context,
    authToken,
  });
  const { command, resolvedCommand, cwd, env, loggedEnv, extraArgs } = runtimeConfig;

  // Session ID from runtime (used as fallback for chat session persistence)
  const runtimeSessionParams = parseObject(runtime.sessionParams);
  const runtimeSessionId = asString(runtimeSessionParams.sessionId, runtime.sessionId ?? "");

  // Build prompt
  const templateData = {
    agentId: agent.id,
    companyId: agent.companyId,
    runId,
    company: { id: agent.companyId },
    agent,
    run: { id: runId, source: "on_demand" },
    context,
  };
  const renderedPrompt = renderTemplate(promptTemplate, templateData);
  const sessionHandoffNote = asString(context.paperclipSessionHandoffMarkdown, "").trim();
  const prompt = joinPromptSections([sessionHandoffNote, renderedPrompt]);
  const promptMetrics = {
    promptChars: prompt.length,
    sessionHandoffChars: sessionHandoffNote.length,
    heartbeatPromptChars: renderedPrompt.length,
  };

  const buildClawArgs = () => {
    const args = [
      "--output-format", "json",
    ];

    if (dangerouslySkipPermissions) {
      args.push("--dangerously-skip-permissions");
    }
    if (model) {
      args.push("--model", model);
    }
    if (extraArgs.length > 0) {
      args.push(...extraArgs);
    }

    // Add the prompt as the final argument (non-interactive mode)
    args.push(prompt);

    return args;
  };

  const runAttempt = async () => {
    const args = buildClawArgs();

    if (onMeta) {
      await onMeta({
        adapterType: "claw_local",
        command: resolvedCommand,
        cwd,
        commandArgs: args,
        commandNotes: [],
        env: loggedEnv,
        prompt,
        promptMetrics,
        context,
      });
    }

    // Stream intermediate output by capturing raw stdout and stripping ANSI codes
    let stdoutRemainder = "";
    let lastThinkingContent = "";

    const proc = await runChildProcess(runId, command, args, {
      cwd,
      env,
      timeoutSec,
      graceSec,
      onLog: async (stream, chunk) => {
        if (stream === "stderr") {
          await onLog("stderr", chunk);
          return;
        }
        // Capture stdout and extract thinking/progress content
        stdoutRemainder += chunk;
        const lines = stdoutRemainder.split(/\r?\n/);
        stdoutRemainder = lines.pop() ?? "";

        for (const rawLine of lines) {
          const cleaned = stripAnsi(rawLine).trim();
          if (!cleaned) continue;

          // Extract thinking content (e.g., "Thinking (123 chars hidden)" or "Thinking...")
          const thinkingMatch = cleaned.match(/^▶?\s*Thinking\s*(?:\(([^)]*)\)|\.\.\.)?$/i);
          if (thinkingMatch) {
            const thinkingDetail = thinkingMatch[1] || "";
            if (thinkingDetail && thinkingDetail !== lastThinkingContent) {
              lastThinkingContent = thinkingDetail;
              await onLog("stdout", `[thinking] ${thinkingDetail}\n`);
            }
            continue;
          }

          // Extract done/completion markers
          if (/✔?\s*Done/i.test(cleaned)) {
            continue; // Skip the "Done" marker
          }

          // Pass through any other content (final response text)
          await onLog("stdout", `${cleaned}\n`);
        }
      },
    });

    // Process any remaining content
    if (stdoutRemainder.trim()) {
      const cleaned = stripAnsi(stdoutRemainder).trim();
      if (cleaned && !/^(▶?\s*Thinking|✔?\s*Done)/i.test(cleaned)) {
        await onLog("stdout", `${cleaned}\n`);
      }
    }

    const parsed = parseClawJsonOutput(proc.stdout);
    return { proc, parsed };
  };

  const toAdapterResult = (
    attempt: { proc: RunProcessResult; parsed: ReturnType<typeof parseClawJsonOutput> },
    opts: { fallbackSessionId: string | null; clearSessionOnMissingSession?: boolean },
  ): AdapterExecutionResult => {
    const { proc, parsed } = attempt;

    const authMeta = detectClawAuthRequired({
      parsed: parsed.resultJson,
      stdout: proc.stdout,
      stderr: proc.stderr,
    });

    const errorMeta = authMeta.requiresAuth ? { authHint: authMeta.authHint } : undefined;

    if (proc.timedOut) {
      return {
        exitCode: proc.exitCode,
        signal: proc.signal,
        timedOut: true,
        errorMessage: `Timed out after ${timeoutSec}s`,
        errorCode: "timeout",
        errorMeta,
        clearSession: Boolean(opts.clearSessionOnMissingSession),
      };
    }

    if (!parsed.resultJson || parsed.errorMessage) {
      return {
        exitCode: proc.exitCode,
        signal: proc.signal,
        timedOut: false,
        errorMessage: parsed.errorMessage || `Claw exited with code ${proc.exitCode ?? -1}`,
        errorCode: authMeta.requiresAuth ? "claw_auth_required" : null,
        errorMeta,
        resultJson: {
          stdout: proc.stdout,
          stderr: proc.stderr,
        },
        clearSession: Boolean(opts.clearSessionOnMissingSession),
      };
    }

    // For chat runs, use the chat thread ID as the session ID if claw doesn't return one
    // This ensures chat sessions persist correctly in agent_task_sessions
    const clawSessionId = parsed.sessionId;
    const resolvedSessionId = isChatRun && chatThreadId && !clawSessionId
      ? `chat:${chatThreadId}`
      : clawSessionId || opts.fallbackSessionId;

    const resolvedSessionParams = resolvedSessionId
      ? {
          sessionId: resolvedSessionId,
          cwd,
        } as Record<string, unknown>
      : null;

    return {
      exitCode: proc.exitCode,
      signal: proc.signal,
      timedOut: false,
      errorMessage:
        (proc.exitCode ?? 0) === 0
          ? null
          : describeClawFailure(parsed.resultJson) ?? `Claw exited with code ${proc.exitCode ?? -1}`,
      errorCode: authMeta.requiresAuth ? "claw_auth_required" : null,
      errorMeta,
      usage: parsed.usage || undefined,
      sessionId: resolvedSessionId,
      sessionParams: resolvedSessionParams,
      sessionDisplayId: resolvedSessionId,
      provider: "anthropic",
      biller: "anthropic",
      model: parsed.model || model || null,
      billingType: env.ANTHROPIC_API_KEY ? "api" : env.ANTHROPIC_AUTH_TOKEN ? "subscription" : "unknown",
      costUsd: parsed.costUsd,
      resultJson: parsed.resultJson,
      summary: parsed.summary,
      clearSession: Boolean(opts.clearSessionOnMissingSession && !resolvedSessionId),
    };
  };

  try {
    const result = await runAttempt();
    return toAdapterResult(result, { fallbackSessionId: runtimeSessionId || runtime.sessionId });
  } finally {
    // Cleanup if needed
  }
}
