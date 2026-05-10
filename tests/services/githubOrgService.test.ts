import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/integrations/github/orgClient.js", () => ({
  getUser: vi.fn(),
  isOrgMember: vi.fn(),
  createOrgInvitation: vi.fn(),
  createOrgRepo: vi.fn(),
  createRepoFromTemplate: vi.fn(),
}));

import * as orgClient from "../../src/integrations/github/orgClient.js";
import * as service from "../../src/services/githubOrgService.js";

describe("githubOrgService.inviteUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns user_not_found when GitHub user lookup fails", async () => {
    vi.mocked(orgClient.getUser).mockResolvedValue(null);
    const r = await service.inviteUser("ghost");
    expect(r.status).toBe("user_not_found");
  });

  it("returns already_member when membership check passes", async () => {
    vi.mocked(orgClient.getUser).mockResolvedValue({ login: "x", id: 1 });
    vi.mocked(orgClient.isOrgMember).mockResolvedValue(true);
    const r = await service.inviteUser("x");
    expect(r.status).toBe("already_member");
    expect(orgClient.createOrgInvitation).not.toHaveBeenCalled();
  });

  it("creates invitation when user exists and is not a member", async () => {
    vi.mocked(orgClient.getUser).mockResolvedValue({ login: "x", id: 1 });
    vi.mocked(orgClient.isOrgMember).mockResolvedValue(false);
    vi.mocked(orgClient.createOrgInvitation).mockResolvedValue();
    const r = await service.inviteUser("@x");
    expect(r.status).toBe("invited");
    expect(orgClient.createOrgInvitation).toHaveBeenCalledWith(
      expect.any(String),
      "x",
    );
  });
});

describe("githubOrgService.createRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid repo name", async () => {
    const r = await service.createRepo({ name: "bad name!!" });
    expect(r.status).toBe("invalid_name");
  });

  it("rejects reserved repo names", async () => {
    const r = await service.createRepo({ name: "admin" });
    expect(r.status).toBe("reserved_name");
  });

  it("creates repo via plain createOrgRepo when no template", async () => {
    vi.mocked(orgClient.createOrgRepo).mockResolvedValue();
    const r = await service.createRepo({ name: "team-alpha" });
    expect(r.status).toBe("created");
    expect(orgClient.createOrgRepo).toHaveBeenCalled();
    expect(orgClient.createRepoFromTemplate).not.toHaveBeenCalled();
  });
});
