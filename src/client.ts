import { Client, Collection, GatewayIntentBits } from "discord.js";
import type { Command } from "./types/index.js";

export class BotClient extends Client {
  commands = new Collection<string, Command>();

  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
      ],
    });
  }
}
