import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../types/index.js";
import * as agentService from "../services/agentService.js";
import type { BotClient } from "../client.js";
import { logger } from "../utils/logger.js";

export default {
  data: new SlashCommandBuilder()
    .setName("ask")
    .setDescription("자연어로 자동화를 요청합니다 (LLM 툴 콜링)")
    .addStringOption((o) =>
      o.setName("prompt").setDescription("요청 내용").setRequired(true),
    ),
  async execute(interaction) {
    const prompt = interaction.options.getString("prompt", true);
    await interaction.deferReply({ ephemeral: true });
    try {
      const res = await agentService.run(
        interaction.client as BotClient,
        interaction.user.id,
        prompt,
      );
      const stepsBody =
        res.tool_results.length === 0
          ? "(실행된 툴 없음)"
          : res.tool_results
              .map(
                (r) =>
                  `- ${r.status === "ok" ? "✅" : "❌"} ${r.tool}` +
                  (r.status === "failed" ? ` (${String(r.detail)})` : ""),
              )
              .join("\n");
      await interaction.editReply(`**요약**: ${res.summary}\n${stepsBody}`);
    } catch (err) {
      logger.error("[ask] failed", err);
      await interaction.editReply("처리 중 오류가 발생했습니다.");
    }
  },
} satisfies Command;
