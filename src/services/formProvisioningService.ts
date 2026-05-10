import * as repo from "../db/repositories/formSubmissionRepository.js";
import * as channelService from "./discordChannelService.js";
import * as githubService from "./githubOrgService.js";
import type { BotClient } from "../client.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

export interface FormSubmissionPayload {
  form_id?: string;
  timestamp?: string;
  answers?: Record<string, string[] | string>;
  idempotency_key?: string;
}

export interface ProvisioningSummary {
  submission_id: number;
  status: "done" | "partial" | "failed" | "duplicate";
  handlers: {
    handler: string;
    status: "ok" | "skipped" | "failed";
    detail?: string;
  }[];
}

export async function provision(
  client: BotClient,
  payload: FormSubmissionPayload,
  idempotencyKey: string,
): Promise<ProvisioningSummary> {
  const existing = repo.findByIdempotencyKey(idempotencyKey);
  if (existing) {
    return {
      submission_id: existing.id,
      status: "duplicate",
      handlers: [],
    };
  }

  const submission = repo.createSubmission({
    form_id: payload.form_id ?? null,
    submitted_at: payload.timestamp ?? null,
    payload: JSON.stringify(payload),
    idempotency_key: idempotencyKey,
  });
  if (!submission) {
    const dupe = repo.findByIdempotencyKey(idempotencyKey)!;
    return { submission_id: dupe.id, status: "duplicate", handlers: [] };
  }

  repo.updateStatus(submission.id, "provisioning");

  const handlers: ProvisioningSummary["handlers"] = [];

  // discordChannel
  const teamName = pickAnswer(payload.answers, "team_name") ?? "team";
  const channelName = `team-${slugify(teamName)}`;
  handlers.push(
    await runHandler(submission.id, "discordChannel", async () => {
      await channelService.createTextChannel(client, {
        guildId: config.discord.guildId,
        name: channelName,
      });
      return `created ${channelName}`;
    }),
  );

  // githubInvite — supports comma-separated list in form answer
  const githubIds = parseList(pickAnswer(payload.answers, "github_id"));
  for (const gh of githubIds) {
    handlers.push(
      await runHandler(submission.id, `githubInvite:${gh}`, async () => {
        const r = await githubService.inviteUser(gh);
        return r.status;
      }),
    );
  }

  const failed = handlers.filter((h) => h.status === "failed").length;
  const finalStatus =
    failed === 0 ? "done" : failed === handlers.length ? "failed" : "partial";
  repo.updateStatus(submission.id, finalStatus);

  return { submission_id: submission.id, status: finalStatus, handlers };
}

async function runHandler(
  submissionId: number,
  handler: string,
  fn: () => Promise<string>,
): Promise<{ handler: string; status: "ok" | "failed"; detail?: string }> {
  try {
    const detail = await fn();
    repo.recordHandlerResult(submissionId, handler, "ok", detail);
    return { handler, status: "ok", detail };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[form ${submissionId}] ${handler} failed`, err);
    repo.recordHandlerResult(submissionId, handler, "failed", msg);
    return { handler, status: "failed", detail: msg };
  }
}

function pickAnswer(
  answers: FormSubmissionPayload["answers"] | undefined,
  key: string,
): string | undefined {
  if (!answers) return undefined;
  const v = answers[key];
  if (Array.isArray(v)) return v[0];
  return v;
}

function parseList(s: string | undefined): string[] {
  if (!s) return [];
  return s
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
