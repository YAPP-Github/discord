import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { initTestDb } from "../helpers/db.js";

vi.mock("../../src/services/discordChannelService.js", () => ({
  sendMessage: vi.fn(),
  splitMessage: vi.fn(),
  createTextChannel: vi.fn(),
  createRole: vi.fn(),
}));

import { createHttpServer } from "../../src/http/server.js";
import * as noticeService from "../../src/services/noticeService.js";
import type { BotClient } from "../../src/client.js";

const TOKEN = "test-admin-token"; // matches tests/setup.ts
const FAKE_CLIENT = {} as BotClient;

describe("Notice admin API", () => {
  beforeEach(() => {
    initTestDb();
    vi.clearAllMocks();
  });

  it("rejects requests without bearer token", async () => {
    const app = createHttpServer(FAKE_CLIENT);
    const res = await request(app).get("/api/notices");
    expect(res.status).toBe(401);
  });

  it("rejects requests with wrong token", async () => {
    const app = createHttpServer(FAKE_CLIENT);
    const res = await request(app)
      .get("/api/notices")
      .set("Authorization", "Bearer wrong-token");
    expect(res.status).toBe(401);
  });

  it("creates a notice with valid token", async () => {
    const app = createHttpServer(FAKE_CLIENT);
    const res = await request(app)
      .post("/api/notices")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({
        title: "Weekly",
        content: "회의",
        cron_expr: "0 9 * * MON",
        channel_id: "999",
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeGreaterThan(0);
    expect(res.body.title).toBe("Weekly");
  });

  it("returns 400 on invalid cron expr", async () => {
    const app = createHttpServer(FAKE_CLIENT);
    const res = await request(app)
      .post("/api/notices")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({
        title: "x",
        content: "x",
        cron_expr: "not a cron",
        channel_id: "1",
      });
    expect(res.status).toBe(400);
  });

  it("returns 400 on missing fields", async () => {
    const app = createHttpServer(FAKE_CLIENT);
    const res = await request(app)
      .post("/api/notices")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ title: "only-title" });
    expect(res.status).toBe(400);
  });

  it("lists notices with valid token", async () => {
    noticeService.create({
      title: "A",
      content: "B",
      cron_expr: "* * * * *",
      channel_id: "1",
    });
    const app = createHttpServer(FAKE_CLIENT);
    const res = await request(app)
      .get("/api/notices")
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe("A");
  });

  it("toggles a notice", async () => {
    const row = noticeService.create({
      title: "A",
      content: "B",
      cron_expr: "* * * * *",
      channel_id: "1",
    });
    const app = createHttpServer(FAKE_CLIENT);
    const res = await request(app)
      .post(`/api/notices/${row.id}/toggle`)
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(0);
  });

  it("returns 404 when toggling unknown id", async () => {
    const app = createHttpServer(FAKE_CLIENT);
    const res = await request(app)
      .post("/api/notices/99999/toggle")
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(404);
  });
});
