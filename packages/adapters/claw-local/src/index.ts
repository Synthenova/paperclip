export const type = "claw_local";
export const label = "Claw Code (local)";

export const models = [
  { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251213", label: "Claude Haiku 4.5" },
  { id: "qwen3.5-plus", label: "Qwen 3.5 Plus (Aliyun)" },
  { id: "glm-5", label: "GLM-5 (Aliyun)" },
  { id: "MiniMax-M2.5", label: "MiniMax M2.5 (Aliyun)" },
];

export const agentConfigurationDoc = `# claw_local agent configuration

Adapter: claw_local

Use when:
- You want to use the Claw Code Rust CLI agent locally
- You need a high-performance local agent with session persistence
- You want to use Anthropic-compatible APIs (including Aliyun, Kimi, GLM, MiniMax)
- The task requires local tool execution with file system access

Don't use when:
- You need a cloud-hosted agent gateway (use openclaw-gateway instead)
- The claw CLI binary is not installed on the host machine
- You need a simpler stateless process adapter

Core fields:
- cwd (string, optional): absolute working directory for the claw process (created if missing)
- model (string, optional): model id (e.g., "claude-sonnet-4-6", "qwen3.5-plus", "glm-5")
- dangerouslySkipPermissions (boolean, optional): pass --dangerously-skip-permissions to claw
- command (string, optional): defaults to "claw"
- extraArgs (string[], optional): additional CLI args (e.g., ["--effort", "high"])
- env (object, optional): KEY=VALUE environment variables (e.g., ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN)
- promptTemplate (string, optional): run prompt template

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Notes:
- Claw stores sessions in .claw/sessions/<session-id>.jsonl under the workspace
- Session resume is supported via --resume flag
- For Aliyun: set ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN in env
- For Anthropic OAuth: leave env empty and run claw login manually
`;
