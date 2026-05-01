import { REST, Routes } from "discord.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXPORT_DIR = join(__dirname, "../../data/export");

// Discord channel type values (numeric)
const GUILD_TEXT = 0;
const GUILD_ANNOUNCEMENT = 5;
const GUILD_FORUM = 15;
const INCLUDED_CHANNEL_TYPES = new Set([
  GUILD_TEXT,
  GUILD_ANNOUNCEMENT,
  GUILD_FORUM,
]);

const EXCLUDE_PATTERNS = [/자유/i, /free.?chat/i, /잡담/i];

const POSITIVE_EMOJIS = new Set([
  "👍",
  "❤️",
  "😄",
  "😊",
  "🎉",
  "🚀",
  "✅",
  "💯",
  "👏",
  "🙌",
  "😍",
  "🔥",
  "💪",
  "😁",
  "⭐",
  "🌟",
  "💡",
  "🎊",
  "🥳",
  "👌",
  "😃",
  "😀",
  "💕",
  "✨",
  "😎",
  "🏆",
  "💚",
  "🤩",
  "🙏",
  "🫶",
  "❤️‍🔥",
  "💙",
  "💛",
  "💜",
  "🧡",
]);
const NEGATIVE_EMOJIS = new Set([
  "👎",
  "😢",
  "😡",
  "😭",
  "❌",
  "💔",
  "😰",
  "🤦",
  "😤",
  "😞",
  "😔",
  "☹️",
  "💢",
  "🚫",
  "😣",
  "😩",
  "😫",
  "😠",
  "🤮",
  "🤢",
]);

// ---- Discord REST response types ----

interface RawEmoji {
  id: string | null;
  name: string;
}

interface RawReaction {
  count: number;
  me: boolean;
  emoji: RawEmoji;
}

interface RawAttachment {
  url: string;
}

interface RawMessage {
  id: string;
  content: string;
  author: { id: string; username: string };
  timestamp: string;
  reactions?: RawReaction[];
  attachments: RawAttachment[];
}

interface RawChannel {
  id: string;
  name: string;
  type: number;
}

interface RawThread {
  id: string;
  name: string;
  parent_id: string;
  thread_metadata?: {
    archive_timestamp?: string;
  };
}

// ---- Output types ----

interface ReactionDetail {
  emoji: string;
  count: number;
  sentiment: "positive" | "negative" | "neutral";
}

interface MessageRecord {
  id: string;
  channel_id: string;
  channel_name: string;
  thread_id?: string;
  thread_name?: string;
  author_id: string;
  author_name: string;
  content: string;
  timestamp: string;
  reactions: {
    positive_count: number;
    negative_count: number;
    details: ReactionDetail[];
  };
  attachments: string[];
}

interface ChannelSummary {
  id: string;
  name: string;
  message_count: number;
  thread_count: number;
  thread_message_count: number;
}

// ---- Utilities ----

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function sanitize(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9가-힣_-]/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase();
}

function classifyEmoji(name: string): "positive" | "negative" | "neutral" {
  if (POSITIVE_EMOJIS.has(name)) return "positive";
  if (NEGATIVE_EMOJIS.has(name)) return "negative";
  return "neutral";
}

function processReactions(raw?: RawReaction[]): MessageRecord["reactions"] {
  if (!raw?.length)
    return { positive_count: 0, negative_count: 0, details: [] };
  let pos = 0;
  let neg = 0;
  const details: ReactionDetail[] = raw.map((r) => {
    const sentiment = classifyEmoji(r.emoji.name);
    if (sentiment === "positive") pos += r.count;
    else if (sentiment === "negative") neg += r.count;
    return { emoji: r.emoji.name, count: r.count, sentiment };
  });
  return { positive_count: pos, negative_count: neg, details };
}

// ---- Core fetch functions ----

async function paginateMessages(
  rest: REST,
  fetchFromId: string,
  channelId: string,
  channelName: string,
  thread?: { id: string; name: string },
): Promise<MessageRecord[]> {
  const records: MessageRecord[] = [];
  let before: string | undefined;

  while (true) {
    const query = new URLSearchParams({ limit: "100" });
    if (before) query.set("before", before);

    const msgs = (await rest.get(Routes.channelMessages(fetchFromId), {
      query,
    })) as RawMessage[];

    if (!msgs.length) break;

    for (const m of msgs) {
      const rec: MessageRecord = {
        id: m.id,
        channel_id: channelId,
        channel_name: channelName,
        author_id: m.author.id,
        author_name: m.author.username,
        content: m.content,
        timestamp: m.timestamp,
        reactions: processReactions(m.reactions),
        attachments: m.attachments.map((a) => a.url),
      };
      if (thread) {
        rec.thread_id = thread.id;
        rec.thread_name = thread.name;
      }
      records.push(rec);
    }

    before = msgs[msgs.length - 1].id;
    await delay(500);
  }

  return records;
}

async function fetchArchivedThreads(
  rest: REST,
  channelId: string,
): Promise<RawThread[]> {
  const threads: RawThread[] = [];
  let before: string | undefined;

  while (true) {
    const query = new URLSearchParams({ limit: "100" });
    if (before) query.set("before", before);

    const res = (await rest.get(
      `/channels/${channelId}/threads/archived/public`,
      { query },
    )) as { threads: RawThread[]; has_more: boolean };

    threads.push(...res.threads);
    if (!res.has_more || !res.threads.length) break;

    const lastArchiveTs =
      res.threads[res.threads.length - 1].thread_metadata?.archive_timestamp;
    if (!lastArchiveTs) break;
    before = lastArchiveTs;
    await delay(500);
  }

  return threads;
}

// ---- Main ----

async function main() {
  const rest = new REST().setToken(config.discord.token);

  logger.info("Fetching channel list...");
  const allChannels = (await rest.get(
    Routes.guildChannels(config.discord.guildId),
  )) as RawChannel[];

  const channels = allChannels.filter(
    (ch) =>
      INCLUDED_CHANNEL_TYPES.has(ch.type) &&
      !EXCLUDE_PATTERNS.some((p) => p.test(ch.name)),
  );
  logger.info(
    `${channels.length} channels selected (${allChannels.length} total)`,
  );

  logger.info("Fetching active threads for guild...");
  const activeRes = (await rest.get(
    `/guilds/${config.discord.guildId}/threads/active`,
  )) as { threads: RawThread[] };

  mkdirSync(join(EXPORT_DIR, "channels"), { recursive: true });
  mkdirSync(join(EXPORT_DIR, "threads"), { recursive: true });

  const channelSummaries: ChannelSummary[] = [];

  for (const ch of channels) {
    logger.info(`\n[${ch.name}]`);
    let messageCount = 0;
    let threadMessageCount = 0;

    // Channel messages (forum channels have no direct messages)
    if (ch.type !== GUILD_FORUM) {
      try {
        const msgs = await paginateMessages(rest, ch.id, ch.id, ch.name);
        messageCount = msgs.length;
        writeFileSync(
          join(EXPORT_DIR, "channels", `${sanitize(ch.name)}.json`),
          JSON.stringify(msgs, null, 2),
        );
        logger.info(`  ${msgs.length} messages`);
      } catch (err) {
        logger.error(`  Failed to fetch messages: ${err}`);
      }
    }

    // Threads: active + archived
    const activeForChannel = activeRes.threads.filter(
      (t) => t.parent_id === ch.id,
    );
    let archivedThreads: RawThread[] = [];
    try {
      archivedThreads = await fetchArchivedThreads(rest, ch.id);
    } catch (err) {
      logger.error(`  Failed to fetch archived threads: ${err}`);
    }

    const allThreads = [...activeForChannel, ...archivedThreads];
    logger.info(
      `  ${allThreads.length} threads (${activeForChannel.length} active, ${archivedThreads.length} archived)`,
    );

    if (allThreads.length > 0) {
      mkdirSync(join(EXPORT_DIR, "threads", sanitize(ch.name)), {
        recursive: true,
      });

      for (const thread of allThreads) {
        try {
          const threadMsgs = await paginateMessages(
            rest,
            thread.id,
            ch.id,
            ch.name,
            {
              id: thread.id,
              name: thread.name,
            },
          );
          threadMessageCount += threadMsgs.length;
          writeFileSync(
            join(
              EXPORT_DIR,
              "threads",
              sanitize(ch.name),
              `${sanitize(thread.name)}.json`,
            ),
            JSON.stringify(threadMsgs, null, 2),
          );
          logger.info(`    [${thread.name}] ${threadMsgs.length} messages`);
        } catch (err) {
          logger.error(`    Failed to fetch thread [${thread.name}]: ${err}`);
        }
      }
    }

    channelSummaries.push({
      id: ch.id,
      name: ch.name,
      message_count: messageCount,
      thread_count: allThreads.length,
      thread_message_count: threadMessageCount,
    });

    await delay(1000);
  }

  const summary = {
    fetched_at: new Date().toISOString(),
    channels: channelSummaries,
    total_messages: channelSummaries.reduce((s, c) => s + c.message_count, 0),
    total_threads: channelSummaries.reduce((s, c) => s + c.thread_count, 0),
    total_thread_messages: channelSummaries.reduce(
      (s, c) => s + c.thread_message_count,
      0,
    ),
  };

  writeFileSync(
    join(EXPORT_DIR, "fetch-summary.json"),
    JSON.stringify(summary, null, 2),
  );

  logger.info(`\nDone!`);
  logger.info(`  Messages:        ${summary.total_messages}`);
  logger.info(`  Threads:         ${summary.total_threads}`);
  logger.info(`  Thread messages: ${summary.total_thread_messages}`);
  logger.info(`  Output: ${EXPORT_DIR}`);
}

main().catch((err) => {
  logger.error("Fatal:", err);
  process.exit(1);
});
