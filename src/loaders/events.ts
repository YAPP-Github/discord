import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { BotClient } from "../client.js";
import type { Event } from "../types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function loadEvents(client: BotClient) {
  const eventsPath = join(__dirname, "..", "events");
  const files = readdirSync(eventsPath).filter(
    (f) => (f.endsWith(".ts") || f.endsWith(".js")) && !f.endsWith(".d.ts"),
  );

  for (const file of files) {
    const mod = await import(join(eventsPath, file));
    const event: Event = mod.default;
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }
    console.log(`[Event] Loaded: ${event.name}`);
  }
}
