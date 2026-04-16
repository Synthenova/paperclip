import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticatedUsersAreInstanceAdmins } from "../services/full-human-access.js";

describe("authenticatedUsersAreInstanceAdmins", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to enabled", () => {
    delete process.env.PAPERCLIP_AUTHENTICATED_USERS_ARE_INSTANCE_ADMINS;
    expect(authenticatedUsersAreInstanceAdmins()).toBe(true);
  });

  it("accepts an explicit false override", () => {
    vi.stubEnv("PAPERCLIP_AUTHENTICATED_USERS_ARE_INSTANCE_ADMINS", "false");
    expect(authenticatedUsersAreInstanceAdmins()).toBe(false);
  });
});
