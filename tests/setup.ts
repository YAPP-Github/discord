// Vitest setup — populate required env vars before any module imports config.
process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN ?? "test-discord-token";
process.env.DISCORD_CLIENT_ID =
  process.env.DISCORD_CLIENT_ID ?? "test-client-id";
process.env.DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID ?? "test-guild-id";
process.env.GOOGLE_FORM_WEBHOOK_SECRET =
  process.env.GOOGLE_FORM_WEBHOOK_SECRET ?? "test-webhook-secret";
process.env.GITHUB_ORG = process.env.GITHUB_ORG ?? "test-org";
process.env.HTTP_PORT = process.env.HTTP_PORT ?? "0";
process.env.ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN ?? "test-admin-token";
process.env.DATABASE_PATH = process.env.DATABASE_PATH ?? ":memory:";
process.env.NODE_ENV = "test";
