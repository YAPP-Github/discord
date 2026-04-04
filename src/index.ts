import { BotClient } from "./client.js";
import { config } from "./config.js";
import { loadCommands } from "./loaders/commands.js";
import { loadEvents } from "./loaders/events.js";
import { initDatabase } from "./db/index.js";

const client = new BotClient();

async function main() {
  initDatabase();
  await loadCommands(client);
  await loadEvents(client);
  await client.login(config.discord.token);
}

main().catch((err) => {
  console.error("Failed to start bot:", err);
  process.exit(1);
});
