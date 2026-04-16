function parseBooleanEnv(value: string | undefined) {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") return false;
  return undefined;
}

export function agentsHaveFullManagementPermissions() {
  // This fork defaults to broad agent autonomy so solo/small-team setups do not need explicit grant management.
  return parseBooleanEnv(process.env.PAPERCLIP_ALL_AGENTS_HAVE_FULL_PERMISSIONS) ?? true;
}
