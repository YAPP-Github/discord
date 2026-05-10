import { describe, it, expect, beforeEach, vi } from "vitest";
import { initTestDb } from "../helpers/db.js";

vi.mock("../../src/services/discordChannelService.js", () => ({
  sendMessage: vi.fn(),
  splitMessage: vi.fn(),
  createTextChannel: vi.fn(),
  createRole: vi.fn(),
}));

import * as noticeService from "../../src/services/noticeService.js";
import * as channelService from "../../src/services/discordChannelService.js";
import type { BotClient } from "../../src/client.js";

function fakeClient() {
  return {} as BotClient;
}

describe("noticeService", () => {
  beforeEach(() => {
    initTestDb();
    vi.clearAllMocks();
  });

  it("creates and lists notices", () => {
    const created = noticeService.create({
      title: "Weekly",
      content: "회의",
      cron_expr: "0 9 * * MON",
      channel_id: "12345",
    });
    expect(created.id).toBeGreaterThan(0);
    const all = noticeService.list();
    expect(all).toHaveLength(1);
    expect(all[0].enabled).toBe(1);
  });

  it("rejects invalid cron expressions", () => {
    expect(() =>
      noticeService.create({
        title: "x",
        content: "x",
        cron_expr: "not a cron",
        channel_id: "1",
      }),
    ).toThrow();
  });

  it("toggles enabled flag", () => {
    const row = noticeService.create({
      title: "x",
      content: "x",
      cron_expr: "* * * * *",
      channel_id: "1",
    });
    const toggled = noticeService.toggle(row.id);
    expect(toggled?.enabled).toBe(0);
    const toggledAgain = noticeService.toggle(row.id);
    expect(toggledAgain?.enabled).toBe(1);
  });

  it("dispatches via discord channel service", async () => {
    const row = noticeService.create({
      title: "Hello",
      content: "World",
      cron_expr: "* * * * *",
      channel_id: "999",
    });
    await noticeService.dispatchOne(fakeClient(), row);
    expect(channelService.sendMessage).toHaveBeenCalledWith(
      expect.anything(),
      "999",
      expect.stringContaining("Hello"),
    );
  });
});
