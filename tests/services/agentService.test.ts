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
  inviteMany: vi.fn().mockResolvedValue({
    invited: [],
    already_member: [],
    already_invited: [],
    user_not_found: [],
    failed: [],
  }),
  createRepo: vi.fn().mockResolvedValue({ status: "created", url: "u" }),
}));

vi.mock("../../src/services/discordChannelService.js", () => ({
  sendMessage: vi.fn(),
  splitMessage: vi.fn(),
  createTextChannel: vi.fn().mockResolvedValue({ id: "ch1", name: "x" }),
  createRole: vi.fn(),
  fetchThreadMessages: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/services/noticeService.js", () => ({
  create: vi.fn().mockReturnValue({ id: 1 }),
  list: vi.fn(),
  toggle: vi.fn(),
  setEnabled: vi.fn().mockReturnValue({ id: 1, enabled: 0 }),
  disableAll: vi.fn().mockReturnValue(3),
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
import * as noticeService from "../../src/services/noticeService.js";
import type { BotClient } from "../../src/client.js";

const FAKE_CLIENT = {} as BotClient;

function terminatingResponse(text = "완료했습니다.") {
  return {
    stop_reason: "end_turn",
    content: [{ type: "text", text }],
  };
}

describe("agentService.run", () => {
  beforeEach(() => {
    initTestDb();
    vi.clearAllMocks();
  });

  it("dispatches LLM tool_use blocks to registered handlers", async () => {
    messagesCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
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
    messagesCreate.mockResolvedValueOnce(terminatingResponse());

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
      stop_reason: "tool_use",
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
    messagesCreate.mockResolvedValueOnce(terminatingResponse());

    const result = await agentService.run(FAKE_CLIENT, "u1", "초대 두명");
    expect(result.status).toBe("failed");
    expect(result.tool_results[0].status).toBe("failed");
    expect(result.tool_results[1].status).toBe("ok");
  });

  it("routes disable_all_notices tool_use to noticeService.disableAll", async () => {
    messagesCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "disable_all_notices",
          input: {},
        },
      ],
    });
    messagesCreate.mockResolvedValueOnce(terminatingResponse());

    const result = await agentService.run(FAKE_CLIENT, "u1", "스케줄러 다 꺼줘");
    expect(result.status).toBe("executed");
    expect(noticeService.disableAll).toHaveBeenCalledTimes(1);
    expect(result.tool_results[0]).toMatchObject({
      tool: "disable_all_notices",
      status: "ok",
      detail: { disabled_count: 3 },
    });
  });

  it("routes set_notice_enabled tool_use to noticeService.setEnabled", async () => {
    messagesCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "set_notice_enabled",
          input: { id: 7, enabled: false },
        },
      ],
    });
    messagesCreate.mockResolvedValueOnce(terminatingResponse());

    const result = await agentService.run(FAKE_CLIENT, "u1", "공지 7 꺼줘");
    expect(result.status).toBe("executed");
    expect(noticeService.setEnabled).toHaveBeenCalledWith(7, false);
  });

  it("records unknown tool as failed without crashing", async () => {
    messagesCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "bogus_tool",
          input: {},
        },
      ],
    });
    messagesCreate.mockResolvedValueOnce(terminatingResponse());

    const result = await agentService.run(FAKE_CLIENT, "u1", "bogus");
    expect(result.status).toBe("failed");
    expect(result.tool_results[0]).toMatchObject({
      tool: "bogus_tool",
      status: "failed",
    });
  });

  it("loops across turns: list result feeds the next tool_use", async () => {
    vi.mocked(noticeService.list).mockReturnValueOnce([
      {
        id: 11,
        title: "a",
        content: "a",
        cron_expr: "* * * * *",
        channel_id: "1",
        enabled: 1,
        last_run_at: null,
        created_at: "",
      },
      {
        id: 22,
        title: "b",
        content: "b",
        cron_expr: "* * * * *",
        channel_id: "1",
        enabled: 1,
        last_run_at: null,
        created_at: "",
      },
    ]);

    messagesCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "t1", name: "list_notices", input: {} },
      ],
    });
    messagesCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "t2",
          name: "set_notice_enabled",
          input: { id: 11, enabled: false },
        },
        {
          type: "tool_use",
          id: "t3",
          name: "set_notice_enabled",
          input: { id: 22, enabled: false },
        },
      ],
    });
    messagesCreate.mockResolvedValueOnce(terminatingResponse("2개 비활성화 완료"));

    const result = await agentService.run(
      FAKE_CLIENT,
      "u1",
      "현재 돌고 있는 스케줄러 모두 꺼줘",
    );

    expect(messagesCreate).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("executed");
    expect(result.tool_results.map((r) => r.tool)).toEqual([
      "list_notices",
      "set_notice_enabled",
      "set_notice_enabled",
    ]);
    expect(noticeService.setEnabled).toHaveBeenNthCalledWith(1, 11, false);
    expect(noticeService.setEnabled).toHaveBeenNthCalledWith(2, 22, false);
    expect(result.summary).toBe("2개 비활성화 완료");
  });

  it("routes read_thread_messages tool_use to fetchThreadMessages and filters bots", async () => {
    vi.mocked(channelService.fetchThreadMessages).mockResolvedValueOnce([
      { author_id: "u1", author_name: "koo", content: "github: koo", bot: false },
      { author_id: "b1", author_name: "bot", content: "noise", bot: true },
    ]);
    messagesCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "read_thread_messages",
          input: { thread_id: "ch123", limit: 50 },
        },
      ],
    });
    messagesCreate.mockResolvedValueOnce(terminatingResponse("읽었습니다"));

    const result = await agentService.run(FAKE_CLIENT, "u1", "메시지 읽어줘");
    expect(channelService.fetchThreadMessages).toHaveBeenCalledWith(
      FAKE_CLIENT,
      "ch123",
      50,
    );
    expect(result.tool_results[0].status).toBe("ok");
    expect(result.tool_results[0].detail).toEqual([
      { author_id: "u1", author_name: "koo", content: "github: koo", bot: false },
    ]);
  });

  it("routes invite_github_users tool_use to githubService.inviteMany", async () => {
    vi.mocked(githubService.inviteMany).mockResolvedValueOnce({
      invited: ["alice"],
      already_member: ["bob"],
      already_invited: [],
      user_not_found: [],
      failed: [],
    });
    messagesCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "invite_github_users",
          input: { usernames: ["alice", "bob"] },
        },
      ],
    });
    messagesCreate.mockResolvedValueOnce(terminatingResponse("초대 완료"));

    const result = await agentService.run(FAKE_CLIENT, "u1", "초대해줘");
    expect(githubService.inviteMany).toHaveBeenCalledWith(["alice", "bob"]);
    expect(result.tool_results[0]).toMatchObject({
      tool: "invite_github_users",
      status: "ok",
    });
  });

  it("injects channelId into system prompt when provided", async () => {
    messagesCreate.mockResolvedValueOnce(terminatingResponse("done"));
    await agentService.run(FAKE_CLIENT, "u1", "hello", { channelId: "ch999" });
    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("ch999"),
      }),
    );
  });

  it("marks status failed when iteration limit is hit while still calling tools", async () => {
    const toolUseTurn = {
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "t",
          name: "list_notices",
          input: {},
        },
      ],
    };
    vi.mocked(noticeService.list).mockReturnValue([]);
    for (let i = 0; i < 5; i++) {
      messagesCreate.mockResolvedValueOnce(toolUseTurn);
    }

    const result = await agentService.run(FAKE_CLIENT, "u1", "loop");
    expect(messagesCreate).toHaveBeenCalledTimes(5);
    expect(result.status).toBe("failed");
    expect(result.summary).toContain("최대 반복");
  });
});
