import express, { type Express } from "express";
import { logger } from "../utils/logger.js";
import type { BotClient } from "../client.js";

export function createHttpServer(client: BotClient): Express {
  void client;
  const app = express();

  // Capture raw body for HMAC signature verification.
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as { rawBody?: string }).rawBody = buf.toString("utf8");
      },
    }),
  );

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
}

export function startHttpServer(client: BotClient, port: number) {
  const app = createHttpServer(client);
  return app.listen(port, () => {
    logger.info(`[HTTP] Listening on :${port}`);
  });
}
