import { describe, it, expect, beforeEach, vi } from "vitest";
import { initTestDb } from "../helpers/db.js";

vi.mock("../../src/services/discordChannelService.js", () => ({
  sendMessage: vi.fn(),
  splitMessage: vi.fn(),
  createTextChannel: vi.fn().mockResolvedValue({ id: "ch1", name: "team-x" }),
  createRole: vi.fn(),
}));

vi.mock("../../src/services/githubOrgService.js", () => ({
  inviteUser: vi.fn().mockResolvedValue({ status: "invited", username: "x" }),
  createRepo: vi.fn(),
}));

import * as formService from "../../src/services/formProvisioningService.js";
import * as channelService from "../../src/services/discordChannelService.js";
import * as githubService from "../../src/services/githubOrgService.js";
import type { BotClient } from "../../src/client.js";

const FAKE_CLIENT = {} as BotClient;

describe("formProvisioningService.provision", () => {
  beforeEach(() => {
    initTestDb();
    vi.clearAllMocks();
  });

  it("creates discord channel and invites listed github users", async () => {
    const result = await formService.provision(
      FAKE_CLIENT,
      {
        form_id: "form1",
        timestamp: new Date().toISOString(),
        answers: {
          team_name: "Backend Alpha",
          github_id: "userA, userB",
        },
      },
      "key-1",
    );
    expect(result.status).toBe("done");
    expect(channelService.createTextChannel).toHaveBeenCalledOnce();
    expect(githubService.inviteUser).toHaveBeenCalledTimes(2);
    const handlerNames = result.handlers.map((h) => h.handler);
    expect(handlerNames).toContain("discordChannel");
    expect(handlerNames).toContain("githubInvite:userA");
    expect(handlerNames).toContain("githubInvite:userB");
  });

  it("returns duplicate on repeated idempotency_key without re-running handlers", async () => {
    await formService.provision(
      FAKE_CLIENT,
      { answers: { team_name: "x" } },
      "key-dupe",
    );
    vi.clearAllMocks();
    const r2 = await formService.provision(
      FAKE_CLIENT,
      { answers: { team_name: "x" } },
      "key-dupe",
    );
    expect(r2.status).toBe("duplicate");
    expect(channelService.createTextChannel).not.toHaveBeenCalled();
  });

  it("returns partial when one handler fails", async () => {
    vi.mocked(channelService.createTextChannel).mockRejectedValueOnce(
      new Error("perm denied"),
    );
    const result = await formService.provision(
      FAKE_CLIENT,
      {
        answers: { team_name: "x", github_id: "userA" },
      },
      "key-partial",
    );
    expect(result.status).toBe("partial");
    expect(result.handlers.find((h) => h.handler === "discordChannel")?.status).toBe(
      "failed",
    );
  });
});
