import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { initTestDb } from "../helpers/db.js";
import { signHmacSha256 } from "../../src/utils/hmac.js";

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

import { createHttpServer } from "../../src/http/server.js";
import type { BotClient } from "../../src/client.js";

const SECRET = "test-webhook-secret"; // matches tests/setup.ts
const FAKE_CLIENT = {} as BotClient;

function buildSigned(body: object, ts: number) {
  const payload = JSON.stringify(body);
  const sig = signHmacSha256(payload, SECRET);
  return { payload, sig, ts };
}

describe("POST /webhooks/google-form", () => {
  beforeEach(() => {
    initTestDb();
    vi.clearAllMocks();
  });

  it("rejects requests without signature", async () => {
    const app = createHttpServer(FAKE_CLIENT);
    const res = await request(app)
      .post("/webhooks/google-form")
      .send({ form_id: "x" });
    expect(res.status).toBe(401);
  });

  it("rejects bad signature", async () => {
    const app = createHttpServer(FAKE_CLIENT);
    const res = await request(app)
      .post("/webhooks/google-form")
      .set("X-Signature", "deadbeef")
      .set("X-Timestamp", String(Date.now()))
      .send({ form_id: "x" });
    expect(res.status).toBe(401);
  });

  it("rejects stale timestamp", async () => {
    const app = createHttpServer(FAKE_CLIENT);
    const body = { form_id: "x" };
    const stale = Date.now() - 10 * 60 * 1000;
    const { payload, sig } = buildSigned(body, stale);
    const res = await request(app)
      .post("/webhooks/google-form")
      .set("Content-Type", "application/json")
      .set("X-Signature", sig)
      .set("X-Timestamp", String(stale))
      .send(payload);
    expect(res.status).toBe(401);
  });

  it("accepts valid signature and provisions", async () => {
    const app = createHttpServer(FAKE_CLIENT);
    const ts = Date.now();
    const body = {
      form_id: "form1",
      timestamp: new Date(ts).toISOString(),
      answers: { team_name: "Alpha", github_id: "userA" },
      idempotency_key: "k-ok",
    };
    const { payload, sig } = buildSigned(body, ts);
    const res = await request(app)
      .post("/webhooks/google-form")
      .set("Content-Type", "application/json")
      .set("X-Signature", sig)
      .set("X-Timestamp", String(ts))
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("done");
    const handlers = res.body.handlers.map(
      (h: { handler: string }) => h.handler,
    );
    expect(handlers).toContain("discordChannel");
    expect(handlers).toContain("githubInvite:userA");
  });
});
