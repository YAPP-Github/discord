import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../types/index.js";
import * as noticeService from "../services/noticeService.js";
import { logger } from "../utils/logger.js";

export default {
  data: new SlashCommandBuilder()
    .setName("notice")
    .setDescription("주기 공지 관리")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("새 공지 등록")
        .addStringOption((o) =>
          o.setName("title").setDescription("제목").setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("content").setDescription("내용").setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("cron")
            .setDescription("cron 표현식 (5필드)")
            .setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("channel").setDescription("채널 ID").setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName("list").setDescription("공지 목록"))
    .addSubcommand((sub) =>
      sub
        .setName("toggle")
        .setDescription("활성/비활성 전환")
        .addIntegerOption((o) =>
          o.setName("id").setDescription("공지 ID").setRequired(true),
        ),
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: true });
    try {
      if (sub === "add") {
        const row = noticeService.create({
          title: interaction.options.getString("title", true),
          content: interaction.options.getString("content", true),
          cron_expr: interaction.options.getString("cron", true),
          channel_id: interaction.options.getString("channel", true),
        });
        await interaction.editReply(`✅ 등록 완료 (id=${row.id})`);
      } else if (sub === "list") {
        const rows = noticeService.list();
        if (rows.length === 0) {
          await interaction.editReply("등록된 공지가 없습니다.");
          return;
        }
        const body = rows
          .map(
            (r) =>
              `- [${r.id}] ${r.enabled ? "ON " : "OFF"} ${r.title} (${r.cron_expr}) → <#${r.channel_id}>`,
          )
          .join("\n");
        await interaction.editReply(body);
      } else if (sub === "toggle") {
        const id = interaction.options.getInteger("id", true);
        const row = noticeService.toggle(id);
        if (!row) {
          await interaction.editReply(`id=${id} 공지를 찾지 못했습니다.`);
          return;
        }
        await interaction.editReply(
          `id=${row.id} → ${row.enabled ? "ON" : "OFF"}`,
        );
      }
    } catch (err) {
      logger.error("[notice] failed", err);
      await interaction.editReply(
        err instanceof Error ? err.message : "처리 중 오류가 발생했습니다.",
      );
    }
  },
} satisfies Command;
