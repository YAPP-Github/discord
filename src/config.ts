import dotenv from "dotenv";
const envFile = process.env.NODE_ENV === "prod" ? ".env.prod" : ".env.local";
// .env.* 가 시스템 env 보다 우선 — 셸에 stale OPENAI_API_KEY 등 leak 방지
dotenv.config({ path: envFile, override: true });

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config = {
  discord: {
    token: required("DISCORD_TOKEN"),
    clientId: required("DISCORD_CLIENT_ID"),
    guildId: required("DISCORD_GUILD_ID"),
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
  },
  github: {
    token: process.env.GITHUB_TOKEN ?? "",
    org: process.env.GITHUB_ORG ?? "YAPP-Github",
    templateOwner: process.env.GITHUB_TEMPLATE_OWNER ?? "",
    templateRepo: process.env.GITHUB_TEMPLATE_REPO ?? "",
  },
  google: {
    serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "",
    calendarIds: (process.env.GOOGLE_CALENDAR_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    formWebhookSecret: process.env.GOOGLE_FORM_WEBHOOK_SECRET ?? "",
  },
  http: {
    port: Number(process.env.HTTP_PORT ?? "3000"),
    adminApiToken: process.env.ADMIN_API_TOKEN ?? "",
  },
  db: {
    path: process.env.DATABASE_PATH ?? "./data/bot.db",
  },
  nodeEnv: process.env.NODE_ENV ?? "development",
} as const;
