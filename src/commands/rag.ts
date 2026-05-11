import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../types/index.js";
import { search } from "../services/ragService.js";
import { generateAnswer } from "../services/ragAnswerer.js";
import { logger } from "../utils/logger.js";

const MAX_DISCORD_REPLY = 1900;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

export default {
  data: new SlashCommandBuilder()
    .setName("rag")
    .setDescription("과거 Discord 대화를 검색합니다 (RAG)")
    .addStringOption((o) =>
      o.setName("query").setDescription("자연어 질문").setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("generation")
        .setDescription("기수 필터 (예: 24기)")
        .setRequired(false),
    )
    .addStringOption((o) =>
      o
        .setName("category")
        .setDescription("카테고리 필터")
        .setRequired(false)
        .addChoices(
          { name: "공지", value: "공지" },
          { name: "질문", value: "질문" },
          { name: "채용", value: "채용" },
          { name: "회계", value: "회계" },
          { name: "출결", value: "출결" },
          { name: "스터디", value: "스터디" },
          { name: "회고", value: "회고" },
          { name: "운영", value: "운영" },
          { name: "잡담", value: "잡담" },
          { name: "직군", value: "직군" },
        ),
    ),
  async execute(interaction) {
    const query = interaction.options.getString("query", true);
    const generation = interaction.options.getString("generation") ?? undefined;
    const category = interaction.options.getString("category") ?? undefined;

    await interaction.deferReply({ ephemeral: true });
    try {
      const result = await search({
        query,
        filters: {
          ...(generation ? { generation } : {}),
          ...(category ? { channel_category: category } : {}),
        },
      });

      // 임베딩 API quota 초과 — 결제·잔액 문제 (관리자 개입 필요)
      if (result.embedding_status === "quota_exceeded") {
        await interaction.editReply(
          `⚠️ 임베딩 API 사용량 한도(quota)가 초과되었습니다. **관리자에게 문의해주세요.**`,
        );
        return;
      }
      // 일시적 rate limit — 사용자가 잠시 후 재시도하면 해결
      if (result.embedding_status === "rate_limited") {
        await interaction.editReply(
          `⏳ 외부 API 호출이 일시적으로 제한되었습니다. 잠시 후 다시 시도해주세요.`,
        );
        return;
      }

      if (result.threads.length === 0) {
        await interaction.editReply("질문과 관련된 정보를 찾을 수 없습니다.");
        return;
      }

      // LLM 으로 답변 생성 + 관련성 판단
      const answer = await generateAnswer(query, result.threads);

      if (!answer.is_relevant) {
        const hint = answer.answer ? ` (${answer.answer})` : "";
        await interaction.editReply(
          `질문과 관련된 답을 컨텍스트에서 찾지 못했습니다.${hint}`,
        );
        return;
      }

      // 인용된 쓰레드만 출처로 표시
      const citedSet = new Set(answer.cited_indices);
      const sources = result.threads
        .map((t, i) => ({ t, i }))
        .filter(({ i }) => citedSet.has(i))
        .map(({ t, i }) => {
          const title = t.thread_name ?? "(단독 메시지)";
          return `[${i + 1}] **${title}** — ${t.channel_name} (${t.generation ?? "-"})`;
        });

      const body =
        `**질문**: ${query}\n\n` +
        `${answer.answer}\n\n` +
        (sources.length > 0 ? `**출처**\n${sources.join("\n")}` : "");

      await interaction.editReply(truncate(body, MAX_DISCORD_REPLY));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("[rag] failed", err);
      if (/quota|insufficient_quota|billing/i.test(msg)) {
        await interaction.editReply(
          `⚠️ 외부 API 사용량 한도(quota)가 초과되었습니다. **관리자에게 문의해주세요.**`,
        );
        return;
      }
      if (msg.includes("429") || /rate.?limit/i.test(msg)) {
        await interaction.editReply(
          `⏳ 외부 API 호출이 일시적으로 제한되었습니다. 잠시 후 다시 시도해주세요.`,
        );
        return;
      }
      await interaction.editReply(
        `검색 중 오류가 발생했습니다. **관리자에게 문의해주세요.**`,
      );
    }
  },
} satisfies Command;
