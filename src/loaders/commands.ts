import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { BotClient } from "../client.js";
import type { Command } from "../types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function loadCommands(client: BotClient) {
  const commandsPath = join(__dirname, "..", "commands");
  const files = readdirSync(commandsPath).filter(
    (f) => (f.endsWith(".ts") || f.endsWith(".js")) && !f.endsWith(".d.ts"),
  );

  for (const file of files) {
    const mod = await import(join(commandsPath, file));
    const command: Command = mod.default;
    client.commands.set(command.data.name, command);
    console.log(`[Command] Loaded: ${command.data.name}`);
  }
}
