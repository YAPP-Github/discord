import "dotenv/config";

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
  },
  db: {
    path: process.env.DATABASE_PATH ?? "./data/bot.db",
  },
  nodeEnv: process.env.NODE_ENV ?? "development",
} as const;
