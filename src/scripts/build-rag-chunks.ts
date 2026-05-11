import {
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  createWriteStream,
} from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger.js";
import { tokenizeJoined } from "../services/koreanTokenizer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../data/export");
const CONSOLIDATED_DIR = join(ROOT, "consolidated");
const OUT_DIR = join(ROOT, "rag");
const OUT_JSONL = join(OUT_DIR, "chunks.jsonl");
const OUT_STATS = join(OUT_DIR, "chunks-stats.json");

// ---- Tunables ----
const CHUNK_MAX_TOKENS = 1500;
const STARTER_MAX_TOKENS = 500;
const REPLY_WINDOW_K = 6;
const WINDOW_OVERLAP = 3;
const REPLY_MAX_TOKENS = 400;

// ---- Consolidated 입력 타입 (consolidate-messages.ts 와 동일) ----
interface ReactionDetail {
  emoji: string;
  count: number;
  sentiment: "positive" | "negative" | "neutral";
}

interface EmbedRecord {
  title?: string;
  description?: string;
  url?: string;
  author?: string;
  footer?: string;
  fields?: Array<{ name: string; value: string }>;
}

interface NestedMessage {
  id: string;
  author_id: string;
  author_name: string;
  content: string;
  timestamp: string;
  reply_to_id?: string;
  reactions: {
    positive_count: number;
    negative_count: number;
    details: ReactionDetail[];
  };
  attachments: string[];
  embeds?: EmbedRecord[];
}

interface ConsolidatedThread {
  id: string;
  name: string;
  messages: NestedMessage[];
}

interface ConsolidatedMessage extends NestedMessage {
  channel_id: string;
  channel_name: string;
  thread?: ConsolidatedThread;
}

// ---- Output chunk ----
interface ChunkOut {
  id: string;
  parent_thread_id: string;
  channel_id: string;
  channel_name: string;
  channel_category: string | null;
  generation: string | null;
  thread_id: string | null;
  thread_name: string | null;
  is_starter_only: boolean;
  message_ids: string[];
  author_ids: string[];
  author_names: string[];
  timestamp_start: string;
  timestamp_end: string;
  reply_count: number;
  reaction_positive: number;
  reaction_negative: number;
  has_attachments: boolean;
  has_link: boolean;
  has_code: boolean;
  topic_tags: string[] | null;
  language: string;
  token_count: number;
  text: string;
  text_tokenized: string;
}

// ---- Metadata extraction ----
function extractGeneration(channelName: string): string | null {
  const m = channelName.match(/(\d{2})기/);
  return m ? `${m[1]}기` : null;
}

const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/webhook|alert|noti|에러|버그|server-alert/i, "infra"],
  [/공지|초대채널|notice/i, "공지"],
  [/질문/, "질문"],
  [/채용|recruit/i, "채용"],
  [/회계|회비|회계-아카이빙/, "회계"],
  [/출결/, "출결"],
  [/스터디|study/i, "스터디"],
  [/회고|retro|회고-모임/i, "회고"],
  [/번개/, "번개"],
  [/운영|회장단|운영팀|피플팀|커뮤니케이션|홍보팀|디자인팀|소통팀/, "운영"],
  [/세션|기획/, "세션"],
  [/브랜딩|brand|아이디어/i, "기획"],
  [/대화|토크|채팅|chat/i, "잡담"],
  [/^(pm|design|server|android|ios|web|dev|frontend|tech)/i, "직군"],
];

function detectCategory(channelName: string): string {
  for (const [pattern, label] of CATEGORY_RULES) {
    if (pattern.test(channelName)) return label;
  }
  return "general";
}

// ---- Token 추정 (Korean ~3.5 char/tok, English ~4 char/tok) ----
function estTokens(text: string): number {
  if (!text) return 0;
  const korean = (text.match(/[㄰-㆏가-힯]/g) ?? []).length;
  const rest = text.length - korean;
  return Math.ceil(korean / 2.5 + rest / 4);
}

function truncateToTokens(text: string, maxTokens: number): string {
  if (estTokens(text) <= maxTokens) return text;
  // 보수적으로 한글 가정 (~2.5 chars/tok)
  const targetChars = Math.floor(maxTokens * 2.5);
  if (text.length <= targetChars) return text;
  const head = text.slice(0, Math.floor(targetChars * 0.7));
  const tail = text.slice(text.length - Math.floor(targetChars * 0.3));
  return `${head}\n...(중략)...\n${tail}`;
}

function isKorean(text: string): boolean {
  const korean = (text.match(/[가-힯]/g) ?? []).length;
  return korean / Math.max(text.length, 1) > 0.2;
}

function hasLink(text: string): boolean {
  return /https?:\/\//.test(text);
}

function hasCode(text: string): boolean {
  return text.includes("```");
}

function reactionSum(
  source: { reactions?: { positive_count: number; negative_count: number } }[],
): { pos: number; neg: number } {
  let pos = 0,
    neg = 0;
  for (const m of source) {
    pos += m.reactions?.positive_count ?? 0;
    neg += m.reactions?.negative_count ?? 0;
  }
  return { pos, neg };
}

function synthesizeContentFromEmbeds(m: NestedMessage): string {
  if (m.content && m.content.trim().length > 0) return m.content;
  if (!m.embeds || m.embeds.length === 0) return "";
  return m.embeds
    .map((e) =>
      [e.title, e.description, e.author, e.footer].filter(Boolean).join("\n"),
    )
    .filter(Boolean)
    .join("\n---\n");
}

function formatHeader(
  starter: ConsolidatedMessage,
  category: string,
  generation: string | null,
): string {
  const gen = generation ?? "-";
  const threadName = starter.thread?.name ?? "(단독 메시지)";
  return [
    `[채널] ${starter.channel_name} (기수: ${gen}, 카테고리: ${category})`,
    `[쓰레드] ${threadName} (시각: ${starter.timestamp})`,
    `[작성자] ${starter.author_name}`,
  ].join("\n");
}

function formatStarter(starter: ConsolidatedMessage): string {
  const content = synthesizeContentFromEmbeds(starter);
  return `[STARTER]\n${truncateToTokens(content, STARTER_MAX_TOKENS)}`;
}

function formatReplies(replies: NestedMessage[]): string {
  if (replies.length === 0) return "";
  const lines = replies.map((r) => {
    const content = synthesizeContentFromEmbeds(r);
    return `- ${r.author_name}: ${truncateToTokens(content, REPLY_MAX_TOKENS)}`;
  });
  return `[REPLIES]\n${lines.join("\n")}`;
}

function makeChunk(args: {
  starter: ConsolidatedMessage;
  replies: NestedMessage[];
  isStarterOnly: boolean;
  category: string;
  generation: string | null;
}): ChunkOut {
  const { starter, replies, isStarterOnly, category, generation } = args;
  const headerText = formatHeader(starter, category, generation);
  const starterText = formatStarter(starter);
  const repliesText = formatReplies(replies);
  const text = [headerText, "", starterText, repliesText && "", repliesText]
    .filter(Boolean)
    .join("\n");

  const allMsgs = [starter, ...replies];
  const messageIds = allMsgs.map((m) => m.id);
  const authorIds = Array.from(new Set(allMsgs.map((m) => m.author_id)));
  const authorNames = Array.from(new Set(allMsgs.map((m) => m.author_name)));
  const timestamps = allMsgs.map((m) => m.timestamp).sort();
  const { pos, neg } = reactionSum(allMsgs);

  return {
    id: randomUUID(),
    parent_thread_id: starter.thread?.id ?? starter.id,
    channel_id: starter.channel_id,
    channel_name: starter.channel_name,
    channel_category: category,
    generation,
    thread_id: starter.thread?.id ?? null,
    thread_name: starter.thread?.name ?? null,
    is_starter_only: isStarterOnly,
    message_ids: messageIds,
    author_ids: authorIds,
    author_names: authorNames,
    timestamp_start: timestamps[0],
    timestamp_end: timestamps[timestamps.length - 1],
    reply_count: starter.thread?.messages.length ?? 0,
    reaction_positive: pos,
    reaction_negative: neg,
    has_attachments: allMsgs.some((m) => (m.attachments?.length ?? 0) > 0),
    has_link: allMsgs.some((m) => hasLink(synthesizeContentFromEmbeds(m))),
    has_code: allMsgs.some((m) => hasCode(synthesizeContentFromEmbeds(m))),
    topic_tags: null,
    language: isKorean(text) ? "ko" : "en",
    token_count: estTokens(text),
    text,
    text_tokenized: tokenizeJoined(text),
  };
}

function chunkMessage(message: ConsolidatedMessage): ChunkOut[] {
  const category = detectCategory(message.channel_name);
  const generation = extractGeneration(message.channel_name);

  if (!message.thread) {
    const content = synthesizeContentFromEmbeds(message);
    if (!content && !(message.attachments?.length ?? 0)) {
      return [];
    }
    return [
      makeChunk({
        starter: message,
        replies: [],
        isStarterOnly: true,
        category,
        generation,
      }),
    ];
  }

  const replies = message.thread.messages;
  // 짧은 쓰레드: 단일 청크
  const totalEst =
    estTokens(synthesizeContentFromEmbeds(message)) +
    replies.reduce((s, r) => s + estTokens(synthesizeContentFromEmbeds(r)), 0);

  if (totalEst <= CHUNK_MAX_TOKENS) {
    return [
      makeChunk({
        starter: message,
        replies,
        isStarterOnly: false,
        category,
        generation,
      }),
    ];
  }

  // 슬라이딩 윈도우 (starter 는 모든 청크에 반복 포함)
  const chunks: ChunkOut[] = [];
  const step = REPLY_WINDOW_K - WINDOW_OVERLAP;
  for (let i = 0; i < replies.length; i += step) {
    const window = replies.slice(i, i + REPLY_WINDOW_K);
    if (window.length === 0) break;
    chunks.push(
      makeChunk({
        starter: message,
        replies: window,
        isStarterOnly: false,
        category,
        generation,
      }),
    );
    if (i + REPLY_WINDOW_K >= replies.length) break;
  }
  return chunks;
}

function main() {
  if (!existsSync(CONSOLIDATED_DIR)) {
    logger.error(`Consolidated dir not found: ${CONSOLIDATED_DIR}`);
    logger.error("Run 'npm run consolidate-messages' first.");
    process.exit(1);
  }

  if (existsSync(OUT_DIR)) {
    rmSync(OUT_DIR, { recursive: true, force: true });
    logger.info(`Cleared existing output: ${OUT_DIR}`);
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const out = createWriteStream(OUT_JSONL);

  let totalChunks = 0;
  let totalSourceMessages = 0;
  let totalThreads = 0;
  const chunksPerChannel: Record<string, number> = {};
  const chunksPerCategory: Record<string, number> = {};
  const chunksPerGeneration: Record<string, number> = {};
  const tokenHistogram: Record<string, number> = {
    "<200": 0,
    "200-500": 0,
    "500-1000": 0,
    "1000-1500": 0,
    ">1500": 0,
  };

  const files = readdirSync(CONSOLIDATED_DIR).filter((f) =>
    f.endsWith(".json"),
  );
  for (const file of files) {
    const path = join(CONSOLIDATED_DIR, file);
    const messages = JSON.parse(
      readFileSync(path, "utf-8"),
    ) as ConsolidatedMessage[];
    totalSourceMessages += messages.length;
    let perFile = 0;
    for (const m of messages) {
      if (m.thread) totalThreads += 1;
      const chunks = chunkMessage(m);
      for (const c of chunks) {
        out.write(JSON.stringify(c) + "\n");
        totalChunks += 1;
        perFile += 1;
        chunksPerChannel[c.channel_name] =
          (chunksPerChannel[c.channel_name] ?? 0) + 1;
        chunksPerCategory[c.channel_category ?? "general"] =
          (chunksPerCategory[c.channel_category ?? "general"] ?? 0) + 1;
        const g = c.generation ?? "(none)";
        chunksPerGeneration[g] = (chunksPerGeneration[g] ?? 0) + 1;
        const t = c.token_count;
        const bucket =
          t < 200
            ? "<200"
            : t < 500
              ? "200-500"
              : t < 1000
                ? "500-1000"
                : t <= 1500
                  ? "1000-1500"
                  : ">1500";
        tokenHistogram[bucket] += 1;
      }
    }
    logger.info(`${basename(file, ".json")}: ${perFile} chunks`);
  }

  out.end();

  const stats = {
    generated_at: new Date().toISOString(),
    source: {
      consolidated_files: files.length,
      source_messages: totalSourceMessages,
      threads: totalThreads,
    },
    chunks: {
      total: totalChunks,
      per_category: chunksPerCategory,
      per_generation: chunksPerGeneration,
      token_histogram: tokenHistogram,
    },
    top_channels: Object.entries(chunksPerChannel)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([name, count]) => ({ name, count })),
    params: {
      CHUNK_MAX_TOKENS,
      STARTER_MAX_TOKENS,
      REPLY_WINDOW_K,
      WINDOW_OVERLAP,
      REPLY_MAX_TOKENS,
    },
  };
  writeFileSync(OUT_STATS, JSON.stringify(stats, null, 2));

  logger.info(`\nDone!`);
  logger.info(`  source messages:   ${totalSourceMessages}`);
  logger.info(`  source threads:    ${totalThreads}`);
  logger.info(`  total chunks:      ${totalChunks}`);
  logger.info(`  output:            ${OUT_JSONL}`);
  logger.info(`  stats:             ${OUT_STATS}`);
}

main();
