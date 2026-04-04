import { REST, Routes } from "discord.js";
import { config } from "./config.js";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function deployCommands() {
  const commands = [];
  const commandsPath = join(__dirname, "commands");
  const files = readdirSync(commandsPath).filter(
    (f) => f.endsWith(".ts") || f.endsWith(".js"),
  );

  for (const file of files) {
    const mod = await import(join(commandsPath, file));
    commands.push(mod.default.data.toJSON());
  }

  const rest = new REST().setToken(config.discord.token);

  console.log(`Deploying ${commands.length} commands...`);
  await rest.put(
    Routes.applicationGuildCommands(
      config.discord.clientId,
      config.discord.guildId,
    ),
    { body: commands },
  );
  console.log("Commands deployed successfully.");
}

deployCommands().catch(console.error);
