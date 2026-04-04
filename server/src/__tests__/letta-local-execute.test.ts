import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { execute } from "@paperclipai/adapter-letta-local/server";

type MetaRecord = {
  prompt?: string;
  commandNotes?: string[];
  context?: Record<string, unknown>;
  promptMetrics?: Record<string, number>;
};

type CaptureRecord = {
  argv: string[];
  cwd: string;
};

async function makeSkill(root: string, skillName: string) {
  const skillDir = path.join(root, skillName);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), `---\nname: ${skillName}\n---\n`, "utf8");
  return skillDir;
}

async function writeFakeLettaCli(scriptPath: string) {
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");

const args = process.argv.slice(2);
const capturePath = process.env.PAPERCLIP_TEST_CAPTURE_PATH;
if (capturePath) {
  fs.appendFileSync(capturePath, JSON.stringify({ argv: args, cwd: process.cwd() }) + "\\n", "utf8");
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const conversationId = args.includes("--new-agent") ? "conversation-create" : "conversation-1";
const agentId = "letta-agent-1";
const sessionId = "session-1";

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\\n");
}

rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.type === "control_request" && msg.request && msg.request.subtype === "initialize") {
    send({
      type: "system",
      subtype: "init",
      agent_id: agentId,
      session_id: sessionId,
      conversation_id: conversationId,
      model: "gpt-5.4",
      tools: [],
    });
    if (args.includes("--new-agent")) {
      setTimeout(() => process.exit(0), 5);
    }
    return;
  }

  if (msg.type === "user") {
    send({ type: "message", message_type: "assistant_message", content: "working" });
    send({
      type: "result",
      subtype: "success",
      result: "done",
      duration_ms: 1,
      total_cost_usd: 0,
      conversation_id: conversationId,
      run_ids: ["run-1"],
    });
  }
});
`;
  await fs.writeFile(scriptPath, script, "utf8");
  await fs.chmod(scriptPath, 0o755);
}

async function readCaptureRecords(capturePath: string): Promise<CaptureRecord[]> {
  const body = await fs.readFile(capturePath, "utf8");
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CaptureRecord);
}

describe("letta execute", () => {
  it("creates Letta agents with a stable Paperclip system prompt and injects workspace .skills", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-letta-execute-"));
    const workspace = path.join(root, "workspace");
    const agentHome = path.join(root, "agent-home");
    const skillsRoot = path.join(root, "runtime-skills");
    const instructionsFile = path.join(root, "instructions.md");
    const lettaCliPath = path.join(root, "fake-letta.js");
    const capturePath = path.join(root, "capture.ndjson");
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(agentHome, { recursive: true });
    const paperclipSkill = await makeSkill(skillsRoot, "paperclip");
    await fs.writeFile(instructionsFile, "Follow the repo playbook.", "utf8");
    await writeFakeLettaCli(lettaCliPath);

    const metas: MetaRecord[] = [];
    const logs: string[] = [];
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const result = await execute({
        runId: "run-1",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "CEO",
          adapterType: "letta_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          cwd: workspace,
          instructionsFilePath: instructionsFile,
          promptTemplate: "Heartbeat task for {{agent.name}}.",
          bootstrapPromptTemplate: "Bootstrap for {{agent.name}}.",
          env: {
            LETTA_CLI_PATH: lettaCliPath,
            PAPERCLIP_TEST_CAPTURE_PATH: capturePath,
            LETTA_API_KEY: "test-key",
          },
          paperclipRuntimeSkills: [
            {
              key: "paperclipai/paperclip/paperclip",
              runtimeName: "paperclip",
              source: paperclipSkill,
              required: true,
            },
          ],
        },
        context: {
          paperclipWorkspace: { cwd: workspace, agentHome },
          paperclipSessionHandoffMarkdown: "Handoff context.",
        },
        authToken: "run-jwt-token",
        onLog: async (_stream, chunk) => {
          logs.push(chunk);
        },
        onMeta: async (meta) => {
          metas.push(meta as MetaRecord);
        },
      });

      expect(result.exitCode).toBe(0);
      const captures = await readCaptureRecords(capturePath);
      expect(captures).toHaveLength(2);
      const createCall = captures.find((entry) => entry.argv.includes("--new-agent"));
      const sessionCall = captures.find((entry) => entry.argv.includes("--new"));
      expect(createCall).toBeDefined();
      expect(sessionCall).toBeDefined();
      expect(createCall?.cwd).toBe(workspace);
      expect(createCall?.argv).toEqual(expect.arrayContaining(["--new-agent"]));
      expect(createCall?.argv).not.toEqual(expect.arrayContaining(["--system-append"]));
      const systemIndex = createCall?.argv.indexOf("--system-custom") ?? -1;
      expect(systemIndex).toBeGreaterThan(-1);
      const systemValue = systemIndex >= 0 ? createCall?.argv[systemIndex + 1] ?? "" : "";
      expect(systemValue).toContain("Follow the repo playbook.");
      expect(systemValue).toContain(`The above agent instructions were loaded from ${instructionsFile}.`);
      expect(systemValue).toContain("You are CEO, a persistent Letta agent operating inside Paperclip.");
      expect(systemValue).toContain("inspect the available skills first");
      expect(systemValue).toContain("use the paperclip skill");
      expect(createCall?.argv).toEqual(expect.arrayContaining(["--init-blocks", "persona,human,skills,loaded_skills"]));
      expect(createCall?.argv).toEqual(
        expect.arrayContaining([
          "--block-value",
          expect.stringContaining("persona=I am CEO, a Paperclip company agent running through Letta."),
          "--block-value",
          expect.stringContaining("human=The human/operator uses Paperclip to assign me work."),
        ]),
      );

      const injectedSkill = path.join(workspace, ".skills", "paperclip");
      expect((await fs.lstat(injectedSkill)).isSymbolicLink()).toBe(true);
      expect(await fs.realpath(injectedSkill)).toBe(await fs.realpath(paperclipSkill));
      expect(fetchCalls).toEqual([
        expect.objectContaining({
          url: "https://api.letta.com/v1/agents/letta-agent-1",
          init: expect.objectContaining({
            method: "PATCH",
            body: JSON.stringify({ name: "CEO" }),
          }),
        }),
      ]);
      expect(logs.join("")).toContain('Synced Letta agent letta-agent-1 name to "CEO".');

      expect(metas).toHaveLength(1);
      const prompt = metas[0]?.prompt ?? "";
      expect(prompt).toContain("Follow the repo playbook.");
      expect(prompt).toContain("Bootstrap for CEO.");
      expect(prompt).toContain("Handoff context.");
      expect(prompt).toContain("Heartbeat task for CEO.");
      expect(prompt.indexOf("Follow the repo playbook.")).toBeLessThan(prompt.indexOf("Bootstrap for CEO."));
      expect(prompt.indexOf("Bootstrap for CEO.")).toBeLessThan(prompt.indexOf("Handoff context."));
      expect(prompt.indexOf("Handoff context.")).toBeLessThan(prompt.indexOf("Heartbeat task for CEO."));
      expect(metas[0]?.commandNotes).toEqual(
          expect.arrayContaining([
          expect.stringContaining("stable custom Paperclip system prompt"),
          expect.stringContaining("stable memory blocks"),
          expect.stringContaining(`${workspace}/.skills`),
        ]),
      );
      expect(metas[0]?.context).toEqual(
        expect.objectContaining({
          projectSkillsDir: `${workspace}/.skills`,
        }),
      );
      expect(metas[0]?.promptMetrics).toEqual(
        expect.objectContaining({
          bootstrapPromptChars: "Bootstrap for CEO.".length,
          sessionHandoffChars: "Handoff context.".length,
          heartbeatPromptChars: "Heartbeat task for CEO.".length,
        }),
      );
    } finally {
      globalThis.fetch = originalFetch;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("reuses the same Letta agent and omits the bootstrap prompt on later runs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-letta-reuse-"));
    const workspace = path.join(root, "workspace");
    const agentHome = path.join(root, "agent-home");
    const skillsRoot = path.join(root, "runtime-skills");
    const lettaCliPath = path.join(root, "fake-letta.js");
    const capturePath = path.join(root, "capture.ndjson");
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(agentHome, { recursive: true });
    const paperclipSkill = await makeSkill(skillsRoot, "paperclip");
    await writeFakeLettaCli(lettaCliPath);

    const prompts: string[] = [];
    const baseInput = {
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "CEO",
        adapterType: "letta_local",
        adapterConfig: {},
      },
      config: {
        cwd: workspace,
        promptTemplate: "Heartbeat task for {{agent.name}}.",
        bootstrapPromptTemplate: "Bootstrap for {{agent.name}}.",
        env: {
          LETTA_CLI_PATH: lettaCliPath,
          PAPERCLIP_TEST_CAPTURE_PATH: capturePath,
          HOME: root,
        },
        paperclipRuntimeSkills: [
          {
            key: "paperclipai/paperclip/paperclip",
            runtimeName: "paperclip",
            source: paperclipSkill,
            required: true,
          },
        ],
      },
      context: {
        paperclipWorkspace: { cwd: workspace, agentHome },
      },
      authToken: "run-jwt-token",
      onLog: async () => {},
      onMeta: async (meta: MetaRecord) => {
        prompts.push(meta.prompt ?? "");
      },
    } as const;

    try {
      const first = await execute({
        runId: "run-1",
        runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
        ...baseInput,
      });
      const second = await execute({
        runId: "run-2",
        runtime: {
          sessionId: first.sessionId ?? null,
          sessionParams: first.sessionParams ?? null,
          sessionDisplayId: first.sessionDisplayId ?? null,
          taskKey: null,
        },
        ...baseInput,
      });

      expect(second.exitCode).toBe(0);
      const captures = await readCaptureRecords(capturePath);
      expect(captures.filter((entry) => entry.argv.includes("--new-agent"))).toHaveLength(1);
      expect(captures.filter((entry) => entry.argv.includes("--new"))).toHaveLength(2);
      expect(prompts[0]).toContain("Bootstrap for CEO.");
      expect(prompts[1]).not.toContain("Bootstrap for CEO.");
      expect(prompts[1]).toContain("Heartbeat task for CEO.");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("ignores task-scoped Letta agent ids and reuses only the persisted Paperclip-agent state", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-letta-persisted-agent-"));
    const workspace = path.join(root, "workspace");
    const agentHome = path.join(root, "agent-home");
    const skillsRoot = path.join(root, "runtime-skills");
    const lettaCliPath = path.join(root, "fake-letta.js");
    const capturePath = path.join(root, "capture.ndjson");
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(agentHome, { recursive: true });
    const paperclipSkill = await makeSkill(skillsRoot, "paperclip");
    await writeFakeLettaCli(lettaCliPath);
    await fs.writeFile(
      path.join(agentHome, "letta-agent.json"),
      JSON.stringify({
        agentId: "persisted-letta-agent",
      }),
      "utf8",
    );

    const metas: MetaRecord[] = [];
    try {
      const result = await execute({
        runId: "run-1",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "CEO",
          adapterType: "letta_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: {
            agentId: "task-scoped-agent-id",
            sessionId: "old-session",
          },
          sessionDisplayId: null,
          taskKey: "issue:123",
        },
        config: {
          cwd: workspace,
          promptTemplate: "Heartbeat task for {{agent.name}}.",
        env: {
          LETTA_CLI_PATH: lettaCliPath,
          PAPERCLIP_TEST_CAPTURE_PATH: capturePath,
          HOME: root,
        },
          paperclipRuntimeSkills: [
            {
              key: "paperclipai/paperclip/paperclip",
              runtimeName: "paperclip",
              source: paperclipSkill,
              required: true,
            },
          ],
        },
        context: {
          paperclipWorkspace: { cwd: workspace, agentHome },
        },
        authToken: "run-jwt-token",
        onLog: async () => {},
        onMeta: async (meta) => {
          metas.push(meta as MetaRecord);
        },
      });

      expect(result.exitCode).toBe(0);
      const captures = await readCaptureRecords(capturePath);
      expect(captures.filter((entry) => entry.argv.includes("--new-agent"))).toHaveLength(0);
      expect(metas[0]?.context).toEqual(
        expect.objectContaining({
          lettaAgentId: "persisted-letta-agent",
        }),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
