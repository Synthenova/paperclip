function parseBooleanEnv(value: string | undefined) {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") return false;
  return undefined;
}

export function authenticatedUsersAreInstanceAdmins() {
  // This fork defaults to coarse human auth so small shared installs do not need a separate access-management UI.
  return parseBooleanEnv(process.env.PAPERCLIP_AUTHENTICATED_USERS_ARE_INSTANCE_ADMINS) ?? true;
}
