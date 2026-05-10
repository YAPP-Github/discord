import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../types/index.js";
import { createRepo } from "../services/githubOrgService.js";
import { logger } from "../utils/logger.js";

export default {
  data: new SlashCommandBuilder()
    .setName("create-repo")
    .setDescription("GitHub Org 에 레포를 생성합니다")
    .addStringOption((opt) =>
      opt.setName("name").setDescription("repo 이름").setRequired(true),
    )
    .addBooleanOption((opt) =>
      opt
        .setName("template")
        .setDescription("템플릿 레포를 사용할지 여부 (기본 false)")
        .setRequired(false),
    )
    .addBooleanOption((opt) =>
      opt
        .setName("private")
        .setDescription("private repo 여부 (기본 true)")
        .setRequired(false),
    ),
  async execute(interaction) {
    const name = interaction.options.getString("name", true);
    const template = interaction.options.getBoolean("template") ?? false;
    const isPrivate = interaction.options.getBoolean("private") ?? true;
    await interaction.deferReply({ ephemeral: true });
    try {
      const res = await createRepo({ name, template, private: isPrivate });
      const msg =
        res.status === "created"
          ? `✅ 생성 완료: ${res.url}`
          : `❌ 생성 실패 (${res.status}): ${res.reason ?? ""}`;
      await interaction.editReply(msg);
    } catch (err) {
      logger.error("[create-repo] failed", err);
      await interaction.editReply("생성 처리 중 오류가 발생했습니다.");
    }
  },
} satisfies Command;
