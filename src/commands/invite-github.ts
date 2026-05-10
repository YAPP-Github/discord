import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../types/index.js";
import { inviteUser } from "../services/githubOrgService.js";
import { logger } from "../utils/logger.js";

export default {
  data: new SlashCommandBuilder()
    .setName("invite-github")
    .setDescription("GitHub Org 에 사용자를 초대합니다")
    .addStringOption((opt) =>
      opt
        .setName("username")
        .setDescription("GitHub username")
        .setRequired(true),
    ),
  async execute(interaction) {
    const username = interaction.options.getString("username", true);
    await interaction.deferReply({ ephemeral: true });
    try {
      const res = await inviteUser(username);
      const msg =
        res.status === "invited"
          ? `✅ ${res.username} 초대를 발송했습니다.`
          : res.status === "already_member"
            ? `이미 멤버입니다: ${res.username}`
            : `사용자를 찾지 못했습니다: ${res.username}`;
      await interaction.editReply(msg);
    } catch (err) {
      logger.error("[invite-github] failed", err);
      await interaction.editReply("초대 처리 중 오류가 발생했습니다.");
    }
  },
} satisfies Command;
