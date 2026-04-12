import type {
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterEnvironmentCheck,
} from "@paperclipai/adapter-utils";

/**
 * Test the claw_local adapter environment.
 *
 * Checks:
 * 1. claw CLI is installed and resolvable
 * 2. Required environment variables are set (if using API key auth)
 * 3. Configured cwd exists and is accessible
 */
export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = ctx.config as Record<string, unknown>;

  const testedAt = new Date().toISOString();

  // Check 1: Verify claw command is available
  const command = typeof config.command === "string" ? config.command : "claw";
  try {
    const { execSync } = await import("node:child_process");
    execSync(`${command} --version`, { encoding: "utf8", stdio: "pipe" });
    checks.push({
      code: "claw_installed",
      level: "info",
      message: `Claw CLI is installed: ${command}`,
      detail: await getVersionString(command),
      hint: null,
    });
  } catch (error) {
    checks.push({
      code: "claw_not_found",
      level: "error",
      message: `Claw CLI not found: ${command}`,
      detail: error instanceof Error ? error.message : String(error),
      hint: "Install claw CLI or configure the 'command' field with the correct path",
    });
  }

  // Check 2: Verify cwd exists
  const cwd = typeof config.cwd === "string" ? config.cwd : null;
  if (cwd) {
    const fs = await import("node:fs/promises");
    try {
      await fs.access(cwd);
      checks.push({
        code: "cwd_exists",
        level: "info",
        message: `Configured cwd exists: ${cwd}`,
        detail: null,
        hint: null,
      });
    } catch {
      checks.push({
        code: "cwd_missing",
        level: "warn",
        message: `Configured cwd does not exist: ${cwd}`,
        detail: null,
        hint: "The directory will be created on first run if possible",
      });
    }
  }

  // Check 3: Check auth configuration
  const envConfig = typeof config.env === "object" && config.env !== null ? config.env as Record<string, unknown> : {};
  const anthropicApiKey = typeof envConfig.ANTHROPIC_API_KEY === "string" ? envConfig.ANTHROPIC_API_KEY : null;
  const anthropicAuthToken = typeof envConfig.ANTHROPIC_AUTH_TOKEN === "string" ? envConfig.ANTHROPIC_AUTH_TOKEN : null;
  const anthropicBaseUrl = typeof envConfig.ANTHROPIC_BASE_URL === "string" ? envConfig.ANTHROPIC_BASE_URL : null;

  if (anthropicApiKey) {
    checks.push({
      code: "anthropic_api_key_set",
      level: "info",
      message: "ANTHROPIC_API_KEY is configured",
      detail: null,
      hint: null,
    });
  } else if (anthropicAuthToken) {
    checks.push({
      code: "anthropic_auth_token_set",
      level: "info",
      message: "ANTHROPIC_AUTH_TOKEN is configured",
      detail: anthropicBaseUrl ? `Base URL: ${anthropicBaseUrl}` : null,
      hint: null,
    });
  } else {
    checks.push({
      code: "no_auth_configured",
      level: "warn",
      message: "No Anthropic authentication configured",
      detail: "Neither ANTHROPIC_API_KEY nor ANTHROPIC_AUTH_TOKEN found in env",
      hint: "Set env vars or run 'claw login' for OAuth authentication",
    });
  }

  // Compute final status
  const hasError = checks.some((c) => c.level === "error");
  const hasWarn = checks.some((c) => c.level === "warn");
  const status: AdapterEnvironmentTestResult["status"] = hasError ? "fail" : hasWarn ? "warn" : "pass";

  return {
    adapterType: "claw_local",
    status,
    checks,
    testedAt,
  };
}

async function getVersionString(command: string): Promise<string | null> {
  try {
    const { execSync } = await import("node:child_process");
    const output = execSync(`${command} --version`, { encoding: "utf8", stdio: "pipe" });
    return output.trim();
  } catch {
    return null;
  }
}
