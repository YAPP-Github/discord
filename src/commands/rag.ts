import { SlashCommandBuilder, ChannelType } from "discord.js";
import type { Command } from "../types/index.js";
import { search } from "../services/ragService.js";
import { generateAnswer } from "../services/ragAnswerer.js";
import { logger } from "../utils/logger.js";

const MAX_DISCORD_REPLY = 1900;
const MAX_THREAD_NAME = 95;
const THREAD_AUTO_ARCHIVE_MIN = 1440; // 24h

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}

function canStartNewThread(type: ChannelType | undefined): boolean {
  return (
    type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement
  );
}

function isAlreadyInsideThread(type: ChannelType | undefined): boolean {
  return (
    type === ChannelType.PublicThread ||
    type === ChannelType.PrivateThread ||
    type === ChannelType.AnnouncementThread
  );
}

function buildAnswerBody(args: {
  query: string;
  answer: string;
  sources: string[];
  includeQueryHeader: boolean;
}): string {
  const head = args.includeQueryHeader ? `**질문**: ${args.query}\n\n` : "";
  const sourceBlock =
    args.sources.length > 0 ? `\n\n**출처**\n${args.sources.join("\n")}` : "";
  return `${head}${args.answer}${sourceBlock}`;
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

    const channelType = interaction.channel?.type;
    const startNewThread = canStartNewThread(channelType);
    const insideThread = isAlreadyInsideThread(channelType);
    // 공개 응답 가능 채널: 텍스트/공지 채널(스레드 생성) 또는 이미 스레드 안
    const usePublicReply = startNewThread || insideThread;

    await interaction.deferReply(usePublicReply ? {} : { ephemeral: true });

    try {
      const result = await search({
        query,
        filters: {
          ...(generation ? { generation } : {}),
          ...(category ? { channel_category: category } : {}),
        },
      });

      if (result.embedding_status === "quota_exceeded") {
        await interaction.editReply(
          `⚠️ 임베딩 API 사용량 한도(quota)가 초과되었습니다. **관리자에게 문의해주세요.**`,
        );
        return;
      }
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

      const answer = await generateAnswer(query, result.threads);

      if (!answer.is_relevant) {
        const hint = answer.answer ? ` (${answer.answer})` : "";
        await interaction.editReply(
          `질문과 관련된 답을 컨텍스트에서 찾지 못했습니다.${hint}`,
        );
        return;
      }

      const citedSet = new Set(answer.cited_indices);
      const sources = result.threads
        .map((t, i) => ({ t, i }))
        .filter(({ i }) => citedSet.has(i))
        .map(({ t, i }) => {
          const title = t.thread_name ?? "(단독 메시지)";
          return `[${i + 1}] **${title}** — ${t.channel_name} (${t.generation ?? "-"})`;
        });

      // --- 응답 모드 분기 ---

      if (startNewThread) {
        // 1) 채널에 질문 공개 — Discord 가 슬래시 invocation 을 헤더로 자동 표시하므로 본문은 짧게.
        await interaction.editReply(
          `❓ **${truncate(query, 200)}**\n_↓ 답변은 스레드에서 확인하세요._`,
        );
        // 2) 그 메시지에 스레드 생성 + 답변 전송
        try {
          const replyMsg = await interaction.fetchReply();
          const thread = await replyMsg.startThread({
            name: truncate(query, MAX_THREAD_NAME),
            autoArchiveDuration: THREAD_AUTO_ARCHIVE_MIN,
          });
          await thread.send(
            truncate(
              buildAnswerBody({
                query,
                answer: answer.answer,
                sources,
                includeQueryHeader: false,
              }),
              MAX_DISCORD_REPLY,
            ),
          );
        } catch (err) {
          // 스레드 생성 실패 — 권한 없음 등. 답변을 같은 채널 follow-up 으로 발송.
          logger.warn(
            "[rag] thread creation failed, falling back to followUp:",
            err,
          );
          await interaction.followUp({
            content: truncate(
              buildAnswerBody({
                query,
                answer: answer.answer,
                sources,
                includeQueryHeader: true,
              }),
              MAX_DISCORD_REPLY,
            ),
          });
        }
        return;
      }

      // 이미 스레드 안 / DM / 기타 → 현재 위치에서 그대로 공개 답변
      await interaction.editReply(
        truncate(
          buildAnswerBody({
            query,
            answer: answer.answer,
            sources,
            includeQueryHeader: true,
          }),
          MAX_DISCORD_REPLY,
        ),
      );
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
