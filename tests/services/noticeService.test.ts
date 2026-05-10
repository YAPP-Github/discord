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

  it("setEnabled is idempotent for an absolute target state", () => {
    const row = noticeService.create({
      title: "x",
      content: "x",
      cron_expr: "* * * * *",
      channel_id: "1",
    });
    const off1 = noticeService.setEnabled(row.id, false);
    const off2 = noticeService.setEnabled(row.id, false);
    expect(off1?.enabled).toBe(0);
    expect(off2?.enabled).toBe(0);
    const on = noticeService.setEnabled(row.id, true);
    expect(on?.enabled).toBe(1);
  });

  it("setEnabled returns null for unknown id", () => {
    expect(noticeService.setEnabled(9999, false)).toBeNull();
  });

  it("disableAll turns off every enabled notice and reports the count", () => {
    noticeService.create({
      title: "a",
      content: "a",
      cron_expr: "* * * * *",
      channel_id: "1",
    });
    const b = noticeService.create({
      title: "b",
      content: "b",
      cron_expr: "* * * * *",
      channel_id: "1",
    });
    noticeService.create({
      title: "c",
      content: "c",
      cron_expr: "* * * * *",
      channel_id: "1",
    });
    noticeService.setEnabled(b.id, false);

    const count = noticeService.disableAll();
    expect(count).toBe(2);
    const all = noticeService.list();
    expect(all.every((r) => r.enabled === 0)).toBe(true);

    expect(noticeService.disableAll()).toBe(0);
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
