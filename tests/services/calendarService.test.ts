import { describe, it, expect, beforeEach, vi } from "vitest";
import { initTestDb } from "../helpers/db.js";

vi.mock("../../src/integrations/google/calendarClient.js", () => ({
  listEvents: vi.fn(),
}));

vi.mock("../../src/services/discordChannelService.js", () => ({
  sendMessage: vi.fn(),
  splitMessage: vi.fn(),
  createTextChannel: vi.fn(),
  createRole: vi.fn(),
}));

vi.mock("../../src/config.js", async (importOriginal) => {
  const original = (await importOriginal()) as typeof import("../../src/config.js");
  return {
    ...original,
    config: {
      ...original.config,
      google: {
        ...original.config.google,
        calendarIds: ["cal-1"],
      },
    },
  };
});

import * as calendarService from "../../src/services/calendarService.js";
import * as calendarClient from "../../src/integrations/google/calendarClient.js";
import * as channelService from "../../src/services/discordChannelService.js";
import type { BotClient } from "../../src/client.js";

const FAKE_CLIENT = {} as BotClient;

describe("calendarService.formatDailyDigest", () => {
  it("returns empty placeholder when no events", () => {
    const out = calendarService.formatDailyDigest([]);
    expect(out).toContain("일정이 없습니다");
  });

  it("formats events with time and meet url", () => {
    const out = calendarService.formatDailyDigest([
      {
        id: "1",
        summary: "Standup",
        start: "2026-05-10T09:00:00.000Z",
        end: "2026-05-10T09:30:00.000Z",
        meet_url: "https://meet.google.com/abc",
      },
    ]);
    expect(out).toContain("Standup");
    expect(out).toContain("https://meet.google.com/abc");
  });
});

describe("calendarService.sendDailyDigest", () => {
  beforeEach(() => {
    initTestDb();
    vi.clearAllMocks();
  });

  it("queries each configured calendar and sends summary message", async () => {
    vi.mocked(calendarClient.listEvents).mockResolvedValue([
      {
        id: "1",
        summary: "Sync",
        start: "2026-05-10T08:00:00.000Z",
        end: "2026-05-10T08:30:00.000Z",
        meet_url: null,
      },
    ]);
    const total = await calendarService.sendDailyDigest(FAKE_CLIENT, "ch-1");
    expect(total).toBe(1);
    expect(calendarClient.listEvents).toHaveBeenCalledTimes(1);
    expect(channelService.sendMessage).toHaveBeenCalledWith(
      FAKE_CLIENT,
      "ch-1",
      expect.stringContaining("Sync"),
    );
  });
});

describe("calendarService.sendUpcomingReminders", () => {
  beforeEach(() => {
    initTestDb();
    vi.clearAllMocks();
  });

  it("sends a reminder once and skips on second tick", async () => {
    const now = new Date("2026-05-10T08:55:00.000Z");
    vi.mocked(calendarClient.listEvents).mockResolvedValue([
      {
        id: "ev-1",
        summary: "Meeting",
        start: "2026-05-10T09:00:00.000Z",
        end: "2026-05-10T10:00:00.000Z",
        meet_url: null,
      },
    ]);
    const first = await calendarService.sendUpcomingReminders(
      FAKE_CLIENT,
      "ch-1",
      now,
    );
    expect(first).toBe(1);
    const second = await calendarService.sendUpcomingReminders(
      FAKE_CLIENT,
      "ch-1",
      now,
    );
    expect(second).toBe(0);
    expect(channelService.sendMessage).toHaveBeenCalledTimes(1);
  });
});
