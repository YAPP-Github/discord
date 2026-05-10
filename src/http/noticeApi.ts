import type { Express, Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import * as noticeService from "../services/noticeService.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

function requireAdminToken(req: Request, res: Response, next: NextFunction) {
  const expected = config.http.adminApiToken;
  if (!expected) {
    return res.status(401).json({ error: "admin api disabled" });
  }
  const header = req.header("Authorization") ?? "";
  const m = /^Bearer\s+(.+)$/.exec(header);
  if (!m) {
    return res.status(401).json({ error: "missing bearer token" });
  }
  const presented = m[1];
  if (
    presented.length !== expected.length ||
    !timingSafeEqual(Buffer.from(presented), Buffer.from(expected))
  ) {
    return res.status(401).json({ error: "invalid token" });
  }
  next();
}

export function registerNoticeApi(app: Express): void {
  app.post("/api/notices", requireAdminToken, (req: Request, res: Response) => {
    const body = req.body as Partial<noticeService.CreateNoticeInput>;
    if (!body.title || !body.content || !body.cron_expr || !body.channel_id) {
      return res.status(400).json({
        error: "title, content, cron_expr, channel_id are required",
      });
    }
    try {
      const row = noticeService.create({
        title: body.title,
        content: body.content,
        cron_expr: body.cron_expr,
        channel_id: body.channel_id,
      });
      return res.status(201).json(row);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "create failed";
      logger.warn("[api] notice create failed", msg);
      return res.status(400).json({ error: msg });
    }
  });

  app.get("/api/notices", requireAdminToken, (_req: Request, res: Response) => {
    return res.json(noticeService.list());
  });

  app.post(
    "/api/notices/:id/toggle",
    requireAdminToken,
    (req: Request, res: Response) => {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: "invalid id" });
      }
      const row = noticeService.toggle(id);
      if (!row) return res.status(404).json({ error: "notice not found" });
      return res.json(row);
    },
  );
}
