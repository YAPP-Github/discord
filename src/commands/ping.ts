import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../types/index.js";

export default {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("봇이 정상 작동하는지 확인합니다"),
  async execute(interaction) {
    const latency = Date.now() - interaction.createdTimestamp;
    await interaction.reply(`Pong! (${latency}ms)`);
  },
} satisfies Command;
