import { Events, type Interaction } from "discord.js";
import type { BotClient } from "../client.js";
import type { Event } from "../types/index.js";

export default {
  name: Events.InteractionCreate,
  async execute(interaction: Interaction) {
    if (!interaction.isChatInputCommand()) return;

    const client = interaction.client as BotClient;
    const command = client.commands.get(interaction.commandName);

    if (!command) {
      console.error(`No command matching ${interaction.commandName}`);
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(error);
      const reply = {
        content: "명령어 실행 중 오류가 발생했습니다.",
        ephemeral: true as const,
      };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    }
  },
} satisfies Event;
