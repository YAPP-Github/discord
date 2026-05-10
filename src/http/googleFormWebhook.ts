import type { Express, Request, Response } from "express";
import type { BotClient } from "../client.js";
import { verifyHmacSha256 } from "../utils/hmac.js";
import * as formService from "../services/formProvisioningService.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

export function registerGoogleFormWebhook(
  app: Express,
  client: BotClient,
): void {
  app.post("/webhooks/google-form", async (req: Request, res: Response) => {
    const signature = req.header("X-Signature");
    const timestampHeader = req.header("X-Timestamp");
    const rawBody = (req as { rawBody?: string }).rawBody ?? "";
    const secret = config.google.formWebhookSecret;

    if (!signature || !timestampHeader || !secret) {
      return res.status(401).json({ error: "missing signature" });
    }
    const ts = Number(timestampHeader);
    if (
      !Number.isFinite(ts) ||
      Math.abs(Date.now() - ts) > TIMESTAMP_TOLERANCE_MS
    ) {
      return res.status(401).json({ error: "stale timestamp" });
    }
    if (!verifyHmacSha256(rawBody, signature, secret)) {
      return res.status(401).json({ error: "bad signature" });
    }

    const payload = req.body as formService.FormSubmissionPayload;
    const idempotencyKey =
      payload.idempotency_key ?? `${payload.form_id ?? "?"}:${ts}`;

    try {
      const summary = await formService.provision(
        client,
        payload,
        idempotencyKey,
      );
      return res.json(summary);
    } catch (err) {
      logger.error("[google-form webhook] failed", err);
      return res.status(500).json({ error: "provisioning failed" });
    }
  });
}
