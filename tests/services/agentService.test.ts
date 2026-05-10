import { describe, it, expect, beforeEach, vi } from "vitest";
import { initTestDb } from "../helpers/db.js";

const messagesCreate = vi.fn();
vi.mock("../../src/services/claude.js", () => ({
  getClaudeClient: () => ({
    messages: { create: messagesCreate },
  }),
}));

vi.mock("../../src/services/githubOrgService.js", () => ({
  inviteUser: vi.fn().mockResolvedValue({ status: "invited", username: "x" }),
  createRepo: vi.fn().mockResolvedValue({ status: "created", url: "u" }),
}));

vi.mock("../../src/services/discordChannelService.js", () => ({
  sendMessage: vi.fn(),
  splitMessage: vi.fn(),
  createTextChannel: vi.fn().mockResolvedValue({ id: "ch1", name: "x" }),
  createRole: vi.fn(),
}));

vi.mock("../../src/services/noticeService.js", () => ({
  create: vi.fn().mockReturnValue({ id: 1 }),
  list: vi.fn(),
  toggle: vi.fn(),
  dispatchOne: vi.fn(),
}));

vi.mock("../../src/services/calendarService.js", () => ({
  listToday: vi.fn().mockResolvedValue([]),
  formatDailyDigest: vi.fn(),
  sendDailyDigest: vi.fn(),
  sendUpcomingReminders: vi.fn(),
}));

import * as agentService from "../../src/services/agentService.js";
import * as githubService from "../../src/services/githubOrgService.js";
import * as channelService from "../../src/services/discordChannelService.js";
import type { BotClient } from "../../src/client.js";

const FAKE_CLIENT = {} as BotClient;

describe("agentService.run", () => {
  beforeEach(() => {
    initTestDb();
    vi.clearAllMocks();
  });

  it("dispatches LLM tool_use blocks to registered handlers", async () => {
    messagesCreate.mockResolvedValueOnce({
      content: [
        { type: "text", text: "스터디방 + 초대" },
        {
          type: "tool_use",
          id: "t1",
          name: "create_discord_channel",
          input: { name: "study-2026-05-13" },
        },
        {
          type: "tool_use",
          id: "t2",
          name: "invite_github_user",
          input: { username: "userA" },
        },
      ],
    });

    const result = await agentService.run(FAKE_CLIENT, "u1", "스터디방 만들어줘");

    expect(result.status).toBe("executed");
    expect(result.tool_results.map((r) => r.tool)).toEqual([
      "create_discord_channel",
      "invite_github_user",
    ]);
    expect(channelService.createTextChannel).toHaveBeenCalledWith(
      FAKE_CLIENT,
      expect.objectContaining({ name: "study-2026-05-13" }),
    );
    expect(githubService.inviteUser).toHaveBeenCalledWith("userA");
  });

  it("marks tool failure without aborting subsequent steps", async () => {
    vi.mocked(githubService.inviteUser).mockRejectedValueOnce(
      new Error("rate limit"),
    );
    messagesCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "invite_github_user",
          input: { username: "userA" },
        },
        {
          type: "tool_use",
          id: "t2",
          name: "invite_github_user",
          input: { username: "userB" },
        },
      ],
    });

    const result = await agentService.run(FAKE_CLIENT, "u1", "초대 두명");
    expect(result.status).toBe("failed");
    expect(result.tool_results[0].status).toBe("failed");
    expect(result.tool_results[1].status).toBe("ok");
  });

  it("records unknown tool as failed without crashing", async () => {
    messagesCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "bogus_tool",
          input: {},
        },
      ],
    });
    const result = await agentService.run(FAKE_CLIENT, "u1", "bogus");
    expect(result.status).toBe("failed");
    expect(result.tool_results[0]).toMatchObject({
      tool: "bogus_tool",
      status: "failed",
    });
  });
});
