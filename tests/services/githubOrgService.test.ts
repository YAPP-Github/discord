import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/integrations/github/orgClient.js", () => ({
  getUser: vi.fn(),
  isOrgMember: vi.fn(),
  createOrgInvitation: vi.fn(),
  createInvitationByUserId: vi.fn(),
  createOrgRepo: vi.fn(),
  createRepoFromTemplate: vi.fn(),
  listMembers: vi.fn(),
  listPendingInvitations: vi.fn(),
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

describe("githubOrgService.inviteMany", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(orgClient.listMembers).mockResolvedValue([]);
    vi.mocked(orgClient.listPendingInvitations).mockResolvedValue([]);
  });

  it("returns empty result for empty input", async () => {
    const r = await service.inviteMany([]);
    expect(r).toEqual({
      invited: [],
      already_member: [],
      already_invited: [],
      user_not_found: [],
      failed: [],
    });
    expect(orgClient.listMembers).not.toHaveBeenCalled();
  });

  it("skips users who are already org members", async () => {
    vi.mocked(orgClient.listMembers).mockResolvedValue(["alice", "bob"]);
    const r = await service.inviteMany(["alice", "@Bob"]);
    expect(r.already_member.sort()).toEqual(["alice", "bob"]);
    expect(orgClient.createInvitationByUserId).not.toHaveBeenCalled();
  });

  it("skips users who already have pending invitations", async () => {
    vi.mocked(orgClient.listPendingInvitations).mockResolvedValue([
      { login: "carol", email: null },
      { login: null, email: "x@y.com" },
    ]);
    vi.mocked(orgClient.getUser).mockResolvedValue({ login: "dave", id: 9 });
    vi.mocked(orgClient.createInvitationByUserId).mockResolvedValue();
    const r = await service.inviteMany(["carol", "dave"]);
    expect(r.already_invited).toEqual(["carol"]);
    expect(r.invited).toEqual(["dave"]);
  });

  it("invites previously unknown users by id", async () => {
    vi.mocked(orgClient.getUser).mockImplementation(async (u) =>
      u === "newbie" ? { login: "newbie", id: 42 } : null,
    );
    vi.mocked(orgClient.createInvitationByUserId).mockResolvedValue();
    const r = await service.inviteMany(["newbie"]);
    expect(r.invited).toEqual(["newbie"]);
    expect(orgClient.createInvitationByUserId).toHaveBeenCalledWith(
      expect.any(String),
      42,
    );
  });

  it("classifies unknown github logins as user_not_found", async () => {
    vi.mocked(orgClient.getUser).mockResolvedValue(null);
    const r = await service.inviteMany(["ghost"]);
    expect(r.user_not_found).toEqual(["ghost"]);
    expect(r.invited).toEqual([]);
  });

  it("deduplicates input and normalizes @ prefix and case", async () => {
    vi.mocked(orgClient.listMembers).mockResolvedValue(["alice"]);
    const r = await service.inviteMany(["@Alice", "alice", "ALICE", "  "]);
    expect(r.already_member).toEqual(["alice"]);
  });

  it("records failed invites without aborting the rest", async () => {
    vi.mocked(orgClient.getUser).mockImplementation(async (u) => ({
      login: u,
      id: u === "good" ? 1 : 2,
    }));
    vi.mocked(orgClient.createInvitationByUserId).mockImplementation(
      async (_org, id) => {
        if (id === 2) throw new Error("boom");
      },
    );
    const r = await service.inviteMany(["good", "bad"]);
    expect(r.invited).toEqual(["good"]);
    expect(r.failed).toEqual([{ username: "bad", reason: "boom" }]);
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
