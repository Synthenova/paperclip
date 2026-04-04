import pc from "picocolors";

export function printLettaStreamEvent(raw: string, debug: boolean): void {
  const line = raw.trim();
  if (!line) return;

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    console.log(line);
    return;
  }

  const type = typeof parsed.type === "string" ? parsed.type : "";
  if (type === "init") {
    const model = typeof parsed.model === "string" ? parsed.model : "unknown";
    const id =
      typeof parsed.conversationId === "string"
        ? parsed.conversationId
        : typeof parsed.sessionId === "string"
          ? parsed.sessionId
          : "";
    console.log(pc.blue(`Letta initialized (model: ${model}${id ? `, session: ${id}` : ""})`));
    return;
  }

  if (type === "system" && parsed.subtype === "agent_created") {
    const agentId = typeof parsed.agentId === "string" ? parsed.agentId : "unknown";
    console.log(pc.blue(`${parsed.rotated === true ? "rotated" : "created"} Letta agent ${agentId}`));
    return;
  }

  if (type === "assistant") {
    if (typeof parsed.content === "string" && parsed.content) {
      console.log(pc.green(`assistant: ${parsed.content}`));
    }
    return;
  }

  if (type === "reasoning") {
    if (typeof parsed.content === "string" && parsed.content) {
      console.log(pc.gray(`thinking: ${parsed.content}`));
    }
    return;
  }

  if (type === "tool_call") {
    const name = typeof parsed.toolName === "string" ? parsed.toolName : "unknown";
    console.log(pc.yellow(`tool_call: ${name}`));
    if (parsed.toolInput !== undefined) {
      console.log(pc.gray(JSON.stringify(parsed.toolInput, null, 2)));
    }
    return;
  }

  if (type === "tool_result") {
    const isError = parsed.isError === true;
    console.log((isError ? pc.red : pc.cyan)(`tool_result${isError ? " (error)" : ""}`));
    if (typeof parsed.content === "string" && parsed.content) {
      console.log((isError ? pc.red : pc.gray)(parsed.content));
    }
    return;
  }

  if (type === "retry") {
    console.log(pc.yellow(`retry ${parsed.attempt ?? "?"}/${parsed.maxAttempts ?? "?"}: ${typeof parsed.reason === "string" ? parsed.reason : "unknown"}`));
    return;
  }

  if (type === "error") {
    const text =
      (typeof parsed.errorDetail === "string" && parsed.errorDetail) ||
      (typeof parsed.message === "string" && parsed.message) ||
      "Letta error";
    console.log(pc.red(`error: ${text}`));
    return;
  }

  if (type === "result") {
    if (typeof parsed.result === "string" && parsed.result) {
      console.log(pc.green("result:"));
      console.log(parsed.result);
    }
    if (parsed.success === false) {
      const text =
        (typeof parsed.errorDetail === "string" && parsed.errorDetail) ||
        (typeof parsed.error === "string" && parsed.error) ||
        "Letta run failed";
      console.log(pc.red(`letta_result: ${text}`));
    }
    const cost =
      typeof parsed.totalCostUsd === "number" && Number.isFinite(parsed.totalCostUsd)
        ? parsed.totalCostUsd
        : 0;
    console.log(pc.blue(`cost=$${cost.toFixed(6)}`));
    return;
  }

  if (debug) console.log(pc.gray(line));
}
