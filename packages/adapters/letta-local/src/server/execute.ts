import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import {
  asString,
  asStringArray,
  parseObject,
  buildInvocationEnvForLogs,
  buildPaperclipEnv,
  ensureAbsoluteDirectory,
  joinPromptSections,
  readPaperclipRuntimeSkillEntries,
  renderTemplate,
  resolvePaperclipDesiredSkillNames,
} from "@paperclipai/adapter-utils/server-utils";
import { createAgent, createSession, type CreateAgentOptions, type CreateSessionOptions } from "@letta-ai/letta-code-sdk";
import { DEFAULT_LETTA_LOCAL_MODEL } from "../index.js";
import { ensureLettaProjectSkillsInjected, resolveLettaProjectSkillsDir } from "./skills.js";

const DEFAULT_PROMPT_TEMPLATE =
  "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work.";
const DEFAULT_SKILL_SOURCES = ["bundled", "global", "agent", "project"] as const;
const LETTA_AGENT_STATE_FILE = "letta-agent.json";
const LETTA_TMPDIR_NAME = "tmp";
const DEFAULT_SYSTEM_PROMPT_PRESET = "default" as const;
const __moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MEMORY_PRESETS = ["persona", "human", "skills", "loaded_skills"] as const;

type LettaSkillSource = NonNullable<CreateSessionOptions["skillSources"]>[number];

let lettaExecutionLock: Promise<void> = Promise.resolve();

function normalizeNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeBaseUrl(value: string | null): string {
  if (!value) return "https://api.letta.com";
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function buildConfigSignature(input: {
  model: string;
  systemPromptPreset: typeof DEFAULT_SYSTEM_PROMPT_PRESET;
  systemPromptAppend: string;
  skillSources: LettaSkillSource[];
  tags: string[];
}) {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

async function readPersistedLettaAgentState(agentHome: string | null): Promise<{
  agentId: string;
  configSignature: string | null;
} | null> {
  if (!agentHome) return null;
  try {
    const raw = await fs.readFile(`${agentHome}/${LETTA_AGENT_STATE_FILE}`, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const agentId = normalizeNonEmptyString(parsed.agentId);
    if (!agentId) return null;
    return {
      agentId,
      configSignature: normalizeNonEmptyString(parsed.configSignature),
    };
  } catch {
    return null;
  }
}

async function writePersistedLettaAgentState(input: {
  agentHome: string | null;
  agentId: string;
  configSignature: string;
}) {
  if (!input.agentHome) return;
  await fs.mkdir(input.agentHome, { recursive: true });
  await fs.writeFile(
    `${input.agentHome}/${LETTA_AGENT_STATE_FILE}`,
    JSON.stringify(
      {
        agentId: input.agentId,
        configSignature: input.configSignature,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function readLettaApiKeyFromSettings(homeDir: string | null): Promise<string | null> {
  if (!homeDir) return null;
  try {
    const raw = await fs.readFile(path.join(homeDir, ".letta", "settings.json"), "utf8");
    const parsed = JSON.parse(raw) as { env?: { LETTA_API_KEY?: unknown } };
    return normalizeNonEmptyString(parsed.env?.LETTA_API_KEY);
  } catch {
    return null;
  }
}

async function readLettaBaseUrlFromSettings(homeDir: string | null): Promise<string | null> {
  if (!homeDir) return null;
  for (const filename of ["settings.local.json", "settings.json"]) {
    try {
      const raw = await fs.readFile(path.join(homeDir, ".letta", filename), "utf8");
      const parsed = JSON.parse(raw) as { env?: { LETTA_BASE_URL?: unknown } };
      const value = normalizeNonEmptyString(parsed.env?.LETTA_BASE_URL);
      if (value) return normalizeBaseUrl(value);
    } catch {
      // Ignore missing or unreadable settings files.
    }
  }
  return null;
}

async function resolveLettaApiAuthToken(env: Record<string, string>): Promise<string | null> {
  const envToken = normalizeNonEmptyString(env.LETTA_API_KEY);
  if (envToken) return envToken;
  return readLettaApiKeyFromSettings(normalizeNonEmptyString(env.HOME));
}

async function resolveLettaBaseUrl(env: Record<string, string>): Promise<string> {
  const envBaseUrl = normalizeNonEmptyString(env.LETTA_BASE_URL);
  if (envBaseUrl) return normalizeBaseUrl(envBaseUrl);
  return (await readLettaBaseUrlFromSettings(normalizeNonEmptyString(env.HOME))) ?? "https://api.letta.com";
}

async function syncLettaAgentName(input: {
  agentId: string;
  desiredName: string;
  env: Record<string, string>;
  onLog: AdapterExecutionContext["onLog"];
}) {
  const desiredName = normalizeNonEmptyString(input.desiredName);
  if (!desiredName) return;

  const authToken = await resolveLettaApiAuthToken(input.env);
  if (!authToken) {
    await input.onLog(
      "stdout",
      `[paperclip] Warning: could not sync Letta agent name for ${input.agentId} because no Letta API key was available.\n`,
    );
    return;
  }
  const baseUrl = await resolveLettaBaseUrl(input.env);

  try {
    const response = await fetch(new URL(`/v1/agents/${input.agentId}`, baseUrl), {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: desiredName }),
    });

    if (!response.ok) {
      const body = await response.text();
      await input.onLog(
        "stdout",
        `[paperclip] Warning: could not sync Letta agent name for ${input.agentId} (${response.status}) via ${baseUrl}: ${body}\n`,
      );
      return;
    }

    await input.onLog(
      "stdout",
      `[paperclip] Synced Letta agent ${input.agentId} name to "${desiredName}".\n`,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await input.onLog(
      "stdout",
      `[paperclip] Warning: could not sync Letta agent name for ${input.agentId} via ${baseUrl}: ${reason}\n`,
    );
  }
}

function serializeEvent(event: unknown) {
  return `${JSON.stringify(event)}\n`;
}

function buildScopedEnv(input: {
  ctx: AdapterExecutionContext;
  cwd: string;
  tmpDir: string;
  envConfig: Record<string, unknown>;
}) {
  const { ctx, cwd, tmpDir, envConfig } = input;
  const env: Record<string, string> = { ...buildPaperclipEnv(ctx.agent) };
  env.PAPERCLIP_RUN_ID = ctx.runId;

  const wakeTaskId =
    normalizeNonEmptyString(ctx.context.taskId) ?? normalizeNonEmptyString(ctx.context.issueId);
  const wakeReason = normalizeNonEmptyString(ctx.context.wakeReason);
  const wakeCommentId =
    normalizeNonEmptyString(ctx.context.wakeCommentId) ?? normalizeNonEmptyString(ctx.context.commentId);
  const approvalId = normalizeNonEmptyString(ctx.context.approvalId);
  const approvalStatus = normalizeNonEmptyString(ctx.context.approvalStatus);

  if (wakeTaskId) env.PAPERCLIP_TASK_ID = wakeTaskId;
  if (wakeReason) env.PAPERCLIP_WAKE_REASON = wakeReason;
  if (wakeCommentId) env.PAPERCLIP_WAKE_COMMENT_ID = wakeCommentId;
  if (approvalId) env.PAPERCLIP_APPROVAL_ID = approvalId;
  if (approvalStatus) env.PAPERCLIP_APPROVAL_STATUS = approvalStatus;

  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }

  if (!normalizeNonEmptyString(env.HOME) && normalizeNonEmptyString(process.env.HOME)) {
    env.HOME = process.env.HOME as string;
  }
  env.PWD = cwd;
  env.TMPDIR = tmpDir;
  env.TMP = tmpDir;
  env.TEMP = tmpDir;

  if (!normalizeNonEmptyString(env.PAPERCLIP_API_KEY) && ctx.authToken) {
    env.PAPERCLIP_API_KEY = ctx.authToken;
  }

  return env;
}

async function withSerializedLettaEnv<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const waitFor = lettaExecutionLock;
  let release: () => void = () => {};
  lettaExecutionLock = new Promise<void>((resolve) => {
    release = resolve;
  });

  await waitFor;

  const previous = new Map<string, string | undefined>();
  try {
    for (const [key, value] of Object.entries(env)) {
      previous.set(key, process.env[key]);
      process.env[key] = value;
    }
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    release();
  }
}

function buildSdkSessionOptions(input: {
  cwd: string;
  model: string;
  skillSources: LettaSkillSource[];
}): CreateSessionOptions {
  return {
    cwd: input.cwd,
    model: input.model,
    memfs: true,
    permissionMode: "bypassPermissions",
    skillSources: input.skillSources,
    disallowedTools: ["Task"],
    canUseTool: () => ({ behavior: "allow" }),
    maxApprovalRecoveryAttempts: 0,
  };
}

function buildSdkCreateOptions(input: {
  cwd: string;
  model: string;
  systemPrompt: string;
  persona: string;
  human: string;
  skillSources: LettaSkillSource[];
  tags: string[];
}): CreateAgentOptions {
  return {
    cwd: input.cwd,
    model: input.model,
    systemPrompt: input.systemPrompt,
    memory: [...DEFAULT_MEMORY_PRESETS],
    persona: input.persona,
    human: input.human,
    memfs: true,
    permissionMode: "bypassPermissions",
    skillSources: input.skillSources,
    tags: input.tags,
    disallowedTools: ["Task"],
    canUseTool: () => ({ behavior: "allow" }),
  };
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const promptTemplate = asString(ctx.config.promptTemplate, DEFAULT_PROMPT_TEMPLATE);
  const bootstrapPromptTemplate = asString(ctx.config.bootstrapPromptTemplate, "");
  const model = asString(ctx.config.model, DEFAULT_LETTA_LOCAL_MODEL);
  const configuredCwd = asString(ctx.config.cwd, "");
  const workspaceContext = parseObject(ctx.context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const agentHome = asString(workspaceContext.agentHome, "");
  const cwd = workspaceCwd || configuredCwd || process.cwd();
  const tmpDir = agentHome ? `${agentHome}/${LETTA_TMPDIR_NAME}` : `${cwd}/.paperclip-letta-tmp`;
  const envConfig = parseObject(ctx.config.env);
  const skillSources: LettaSkillSource[] = (() => {
    const configured = asStringArray(ctx.config.skillSources).filter((item): item is LettaSkillSource =>
      DEFAULT_SKILL_SOURCES.includes(item as LettaSkillSource),
    );
    return configured.length > 0 ? configured : [...DEFAULT_SKILL_SOURCES];
  })();
  const tags = (() => {
    const configured = asStringArray(ctx.config.tags).map((item) => item.trim()).filter(Boolean);
    return configured.length > 0 ? configured : ["paperclip", `company:${ctx.agent.companyId}`, `agent:${ctx.agent.id}`];
  })();
  const instructionsFilePath = asString(ctx.config.instructionsFilePath, "").trim();
  const instructionsDir = instructionsFilePath ? `${path.dirname(instructionsFilePath)}/` : "";

  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });
  await fs.mkdir(tmpDir, { recursive: true });

  const env = buildScopedEnv({ ctx, cwd, tmpDir, envConfig });
  const loggedEnv = buildInvocationEnvForLogs(env, {
    runtimeEnv: { ...process.env, ...env },
    includeRuntimeKeys: ["HOME", "LETTA_CLI_PATH", "LETTA_BASE_URL", "TMPDIR", "TMP", "TEMP"],
    resolvedCommand: "@letta-ai/letta-code-sdk",
  });

  const lettaSkillEntries = await readPaperclipRuntimeSkillEntries(ctx.config, __moduleDir);
  const desiredSkillNames = resolvePaperclipDesiredSkillNames(ctx.config, lettaSkillEntries);
  const projectSkillsDir = resolveLettaProjectSkillsDir(cwd);
  await ensureLettaProjectSkillsInjected(ctx.onLog, {
    skillsDir: projectSkillsDir,
    skillsEntries: lettaSkillEntries,
    desiredSkillNames,
  });

  let instructionsPrefix = "";
  let instructionsChars = 0;
  if (instructionsFilePath) {
    try {
      const instructionsContents = await fs.readFile(instructionsFilePath, "utf8");
      instructionsPrefix =
        `${instructionsContents}\n\n` +
        `The above agent instructions were loaded from ${instructionsFilePath}. ` +
        `Resolve any relative file references from ${instructionsDir}.\n\n`;
      instructionsChars = instructionsPrefix.length;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await ctx.onLog(
        "stdout",
        `[paperclip] Warning: could not read agent instructions file "${instructionsFilePath}": ${reason}\n`,
      );
    }
  }

  const paperclipCreationPrompt = joinPromptSections([
    instructionsPrefix,
    [
      `You are ${ctx.agent.name}, a persistent Letta agent operating inside Paperclip.`,
      `When a Paperclip run tells you to continue your Paperclip work, inspect the available skills first and follow them.`,
      `Your first Paperclip action is to use the paperclip skill and its API procedure before doing generic repo inspection, planning, or asking the human what the task is.`,
      `Fetch live task context through Paperclip APIs at run time. Do not rely on stale memory for current issue details.`,
      `If Paperclip wake/task environment exists, do not ask the human to restate the task until you have followed the paperclip skill flow.`,
      `Use other skills only after the paperclip skill has established identity, assignment, checkout, and issue context.`,
    ].join("\n"),
  ]);
  const creationPersonaMemory = [
    `I am ${ctx.agent.name}, a Paperclip company agent running through Letta.`,
    `I follow Paperclip governance and use skills before improvising.`,
    `When running under Paperclip, I start with the paperclip skill to understand identity, assignments, checkout state, and issue context.`,
  ].join("\n");
  const creationHumanMemory = [
    `The human/operator uses Paperclip to assign me work.`,
    `If a run provides Paperclip environment and skills, I should fetch the live assignment context from Paperclip instead of asking the human to restate it.`,
    `The human expects me to respect Paperclip workflow and use the injected skills in the workspace.`,
  ].join("\n");
  const configSignature = buildConfigSignature({
    model,
    systemPromptPreset: DEFAULT_SYSTEM_PROMPT_PRESET,
    systemPromptAppend: paperclipCreationPrompt,
    skillSources,
    tags,
  });

  const previousSession = parseObject(ctx.runtime.sessionParams);
  const templateData = {
    agentId: ctx.agent.id,
    companyId: ctx.agent.companyId,
    runId: ctx.runId,
    company: { id: ctx.agent.companyId },
    agent: ctx.agent,
    run: { id: ctx.runId, source: "on_demand" },
    context: ctx.context,
  };
  const renderedPrompt = renderTemplate(promptTemplate, templateData);
  const renderedBootstrapPrompt = bootstrapPromptTemplate
    ? renderTemplate(bootstrapPromptTemplate, templateData).trim()
    : "";
  const sessionHandoffNote = asString(ctx.context.paperclipSessionHandoffMarkdown, "").trim();

  return withSerializedLettaEnv(env, async () => {
    const persistedState = await readPersistedLettaAgentState(agentHome || null);
    const persistedAgentId = normalizeNonEmptyString(persistedState?.agentId);
    const persistedSignature = normalizeNonEmptyString(persistedState?.configSignature);
    const previousSignature = persistedSignature;
    const shouldRotate = Boolean(
      persistedAgentId &&
      previousSignature &&
      previousSignature !== configSignature,
    );

    let lettaAgentId = persistedAgentId;
    const isFirstPaperclipRunForAgent = !lettaAgentId || shouldRotate;
    if (!lettaAgentId || shouldRotate) {
      lettaAgentId = await createAgent(buildSdkCreateOptions({
        cwd,
        model,
        systemPrompt: paperclipCreationPrompt,
        persona: creationPersonaMemory,
        human: creationHumanMemory,
        skillSources,
        tags,
      }));
      await syncLettaAgentName({
        agentId: lettaAgentId,
        desiredName: ctx.agent.name,
        env,
        onLog: ctx.onLog,
      });
      await ctx.onLog(
        "stdout",
        serializeEvent({
          type: "system",
          subtype: "agent_created",
          agentId: lettaAgentId,
          rotated: Boolean(shouldRotate),
        }),
      );
      await writePersistedLettaAgentState({
        agentHome: agentHome || null,
        agentId: lettaAgentId,
        configSignature,
      });
    } else {
      await ctx.onLog(
        "stdout",
        serializeEvent({
          type: "system",
          subtype: "agent_reused",
          agentId: lettaAgentId,
        }),
      );
    }

    if (!lettaAgentId) {
      throw new Error("Letta agent id is missing after agent initialization.");
    }

    if (!isFirstPaperclipRunForAgent) {
      await syncLettaAgentName({
        agentId: lettaAgentId,
        desiredName: ctx.agent.name,
        env,
        onLog: ctx.onLog,
      });
    }

    await writePersistedLettaAgentState({
      agentHome: agentHome || null,
      agentId: lettaAgentId,
      configSignature,
    });
    const runPrompt = joinPromptSections([
      instructionsPrefix,
      isFirstPaperclipRunForAgent ? renderedBootstrapPrompt : "",
      sessionHandoffNote,
      renderedPrompt,
    ]);
    const promptMetrics = {
      promptChars: runPrompt.length,
      instructionsChars,
      bootstrapPromptChars: isFirstPaperclipRunForAgent ? renderedBootstrapPrompt.length : 0,
      sessionHandoffChars: sessionHandoffNote.length,
      heartbeatPromptChars: renderedPrompt.length,
    };

    await ctx.onMeta?.({
      adapterType: "letta_local",
      command: "@letta-ai/letta-code-sdk",
      cwd,
      commandNotes: [
        `Letta agent creation uses a stable custom Paperclip system prompt${instructionsFilePath ? ` built from ${instructionsFilePath}` : ""}.`,
        "Letta agent creation initializes stable memory blocks for persona, human, and skill awareness.",
        `Injected Paperclip-managed Letta skills into ${projectSkillsDir}.`,
      ],
      env: loggedEnv,
      prompt: runPrompt,
      promptMetrics,
      context: {
        sessionParams: ctx.runtime.sessionParams ?? null,
        skillSources,
        model,
        projectSkillsDir,
        lettaAgentId,
      },
    });

    await using session = createSession(lettaAgentId, buildSdkSessionOptions({ cwd, model, skillSources }));

    await session.send(runPrompt);

    let initAgentId: string | null = null;
    let sessionId: string | null = null;
    let conversationId: string | null = null;
    let effectiveModel: string | null = null;
    let summary = "";
    let resultJson: Record<string, unknown> | null = null;
    let errorMessage: string | null = null;
    let costUsd: number | null = null;
    let success = true;

    for await (const message of session.stream()) {
      if (message.type === "stream_event") continue;

      if (message.type === "init") {
        initAgentId = message.agentId;
        sessionId = message.sessionId;
        conversationId = message.conversationId;
        effectiveModel = message.model;
        await ctx.onLog("stdout", serializeEvent(message));
        continue;
      }

      if (message.type === "assistant") {
        summary = message.content.trim() || summary;
        await ctx.onLog("stdout", serializeEvent(message));
        continue;
      }

      if (message.type === "reasoning" || message.type === "tool_call" || message.type === "tool_result" || message.type === "retry") {
        await ctx.onLog("stdout", serializeEvent(message));
        continue;
      }

      if (message.type === "error") {
        errorMessage = message.errorDetail || message.message;
        await ctx.onLog("stdout", serializeEvent(message));
        continue;
      }

      if (message.type === "result") {
        success = message.success;
        summary = (message.result ?? summary).trim();
        errorMessage = message.errorDetail || message.error || errorMessage;
        costUsd = typeof message.totalCostUsd === "number" && Number.isFinite(message.totalCostUsd)
          ? message.totalCostUsd
          : null;
        resultJson = {
          success: message.success,
          result: message.result,
          error: message.error,
          errorCode: message.errorCode,
          errorDetail: message.errorDetail,
          stopReason: message.stopReason,
          durationMs: message.durationMs,
          totalCostUsd: message.totalCostUsd,
          conversationId: message.conversationId,
          runIds: message.runIds,
        };
        await ctx.onLog("stdout", serializeEvent(message));
        break;
      }
    }

    const unknownConversation = /unknown\s+(?:session|conversation)|missing\s+(?:session|conversation)|invalid\s+(?:session|conversation)|(?:session|conversation).*not\s+found/i.test(errorMessage ?? "");
    const unknownAgent = /unknown\s+agent|missing\s+agent|invalid\s+agent|agent.*not\s+found/i.test(errorMessage ?? "");
    const baseSessionParams = {
      cwd,
      model: effectiveModel ?? model,
      configSignature,
    };

    return {
      exitCode: success ? 0 : 1,
      signal: null,
      timedOut: false,
      errorMessage,
      sessionId: sessionId ?? conversationId,
      sessionDisplayId: conversationId ?? sessionId,
      sessionParams: unknownConversation
        ? baseSessionParams
        : {
            ...baseSessionParams,
            agentId: (initAgentId ?? lettaAgentId) as string,
            ...(sessionId ? { sessionId } : {}),
          },
      provider: "letta",
      biller: "letta",
      billingType: normalizeNonEmptyString(env.LETTA_API_KEY) ? "api" : "subscription_included",
      model: effectiveModel ?? model,
      costUsd,
      resultJson,
      summary: summary || null,
      clearSession: success ? false : unknownAgent,
    };
  });
}
