export const type = "letta_local";
export const label = "Letta (local)";
export const DEFAULT_LETTA_LOCAL_MODEL = "gpt-5.4";

export const models = [
  { id: DEFAULT_LETTA_LOCAL_MODEL, label: "Default" },
];

export const agentConfigurationDoc = `# letta_local agent configuration

Adapter: letta_local

Use when:
- You want a persistent Letta agent with memory that survives across Paperclip heartbeat runs.
- You want Letta runs to execute without human approval prompts.

Do not use when:
- You need a plain stateless CLI session model like Claude Code, Codex, Gemini CLI, or Cursor.
- You need a generic shell command adapter or webhook adapter.

Core fields:
- instructionsFilePath (string, optional): absolute path to a markdown file appended to the Letta SDK default system prompt when Paperclip creates or rotates a Letta agent
- promptTemplate (string, optional): heartbeat prompt template sent to the Letta conversation on each run
- bootstrapPromptTemplate (string, optional): one-time bootstrap prompt appended only to the first Paperclip run for a newly created Letta agent
- model (string, optional): Letta model id; defaults to ${DEFAULT_LETTA_LOCAL_MODEL}
- env (object, optional): environment variables exposed to the Letta SDK/CLI subprocess, including LETTA_API_KEY, LETTA_BASE_URL, LETTA_CLI_PATH, and PAPERCLIP_API_KEY
- cwd (string, optional): absolute working directory used for the Letta run and Letta skill discovery
- skillSources (string[], optional): Letta skill sources; defaults to bundled, global, agent, and project
- tags (string[], optional): Letta agent tags applied when Paperclip creates the Letta agent
- model catalog: Paperclip fetches the live Letta model list from \`/v1/models/\` using the local Letta auth state and falls back to the default model if the fetch is unavailable

Operational behavior:
- Paperclip creates a real Letta agent through the SDK the first time this adapter runs, then reuses that agent on later heartbeats.
- New Letta agents are always created with permissionMode=bypassPermissions.
- New Letta agents are always created with memfs enabled.
- Paperclip keeps the Letta agent identity stable, but persists and resumes explicit Paperclip-created conversations instead of relying on Letta's default conversation.
- If immutable Letta creation settings change (for example model or instructions), Paperclip rotates to a fresh Letta agent on the next run.
- Paperclip injects Paperclip-managed skills into the active workspace \`.skills/\` directory so Letta project skill discovery can find them on each run.
`;
