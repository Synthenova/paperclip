import type { CreateConfigValues } from "@paperclipai/adapter-utils";

/**
 * Build the adapterConfig JSON from the UI form values.
 */
export function buildClawConfig(v: CreateConfigValues): Record<string, unknown> {
  const ac: Record<string, unknown> = {};

  if (v.cwd) {
    ac.cwd = v.cwd;
  }
  if (v.model) {
    ac.model = v.model;
  }
  if (v.promptTemplate) {
    ac.promptTemplate = v.promptTemplate;
  }
  if (v.dangerouslySkipPermissions) {
    ac.dangerouslySkipPermissions = v.dangerouslySkipPermissions;
  }
  if (v.extraArgs && v.extraArgs.trim().length > 0) {
    ac.extraArgs = v.extraArgs.split(" ").filter((s) => s.trim().length > 0);
  }
  if (v.envBindings && Object.keys(v.envBindings).length > 0) {
    ac.env = v.envBindings;
  }

  return ac;
}
