import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { actorMiddleware } from "../middleware/auth.js";

const mockBoardAuthService = vi.hoisted(() => ({
  resolveBoardAccess: vi.fn(),
  findBoardApiKeyByToken: vi.fn(),
  touchBoardApiKey: vi.fn(),
}));

vi.mock("../services/board-auth.js", () => ({
  boardAuthService: () => mockBoardAuthService,
}));

describe("actor middleware", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockBoardAuthService.findBoardApiKeyByToken.mockResolvedValue(null);
    mockBoardAuthService.resolveBoardAccess.mockResolvedValue({
      user: { id: "user-1", name: "User One", email: "user-1@example.com" },
      companyIds: ["company-1", "company-2"],
      isInstanceAdmin: true,
    });
  });

  it("uses board auth access for authenticated session users", async () => {
    const app = express();
    app.use(
      actorMiddleware({} as never, {
        deploymentMode: "authenticated",
        resolveSession: async () => ({ user: { id: "user-1" } } as never),
      }),
    );
    app.get("/", (req, res) => {
      res.json(req.actor);
    });

    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(mockBoardAuthService.resolveBoardAccess).toHaveBeenCalledWith("user-1");
    expect(res.body).toMatchObject({
      type: "board",
      userId: "user-1",
      companyIds: ["company-1", "company-2"],
      isInstanceAdmin: true,
      source: "session",
    });
  });
});
