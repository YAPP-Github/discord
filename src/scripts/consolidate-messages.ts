import {
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, "../../data/export");
const CHANNELS_DIR = join(SRC_DIR, "channels");
const THREADS_DIR = join(SRC_DIR, "threads");
const OUT_DIR = join(SRC_DIR, "consolidated");

// ---- Types ----

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
  reply_to_id?: string;
  reactions: {
    positive_count: number;
    negative_count: number;
    details: ReactionDetail[];
  };
  attachments: string[];
  embeds?: EmbedRecord[];
}

type NestedMessage = Omit<
  MessageRecord,
  "channel_id" | "channel_name" | "thread_id" | "thread_name"
>;

interface ConsolidatedThread {
  id: string;
  name: string;
  messages: NestedMessage[];
}

interface ConsolidatedMessage extends Omit<
  MessageRecord,
  "thread_id" | "thread_name"
> {
  thread?: ConsolidatedThread;
}

interface ThreadFile {
  threadId: string;
  threadName: string;
  messages: MessageRecord[];
}

// ---- Utilities ----

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function compareSnowflake(a: string, b: string): number {
  const ba = BigInt(a);
  const bb = BigInt(b);
  return ba < bb ? -1 : ba > bb ? 1 : 0;
}

function stripContext(m: MessageRecord): NestedMessage {
  const out: NestedMessage = {
    id: m.id,
    author_id: m.author_id,
    author_name: m.author_name,
    content: m.content,
    timestamp: m.timestamp,
    reactions: m.reactions,
    attachments: m.attachments,
  };
  if (m.reply_to_id !== undefined) out.reply_to_id = m.reply_to_id;
  if (m.embeds !== undefined) out.embeds = m.embeds;
  return out;
}

function toConsolidated(m: MessageRecord): ConsolidatedMessage {
  const out: ConsolidatedMessage = {
    id: m.id,
    channel_id: m.channel_id,
    channel_name: m.channel_name,
    author_id: m.author_id,
    author_name: m.author_name,
    content: m.content,
    timestamp: m.timestamp,
    reactions: m.reactions,
    attachments: m.attachments,
  };
  if (m.reply_to_id !== undefined) out.reply_to_id = m.reply_to_id;
  if (m.embeds !== undefined) out.embeds = m.embeds;
  return out;
}

function listJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => join(dir, f));
}

function listSubdirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) =>
    statSync(join(dir, name)).isDirectory(),
  );
}

function loadThreadFile(path: string): ThreadFile | null {
  const messages = readJson<MessageRecord[]>(path);
  if (messages.length === 0) return null;
  const threadId = messages[0].thread_id;
  const threadName = messages[0].thread_name;
  if (!threadId || !threadName) {
    logger.warn(`Skipping ${path}: missing thread_id/name on first message`);
    return null;
  }
  return { threadId, threadName, messages };
}

// ---- Core ----

function consolidateChannel(
  channelMessages: MessageRecord[] | null,
  threadFiles: ThreadFile[],
): ConsolidatedMessage[] {
  const output: ConsolidatedMessage[] = (channelMessages ?? []).map(
    toConsolidated,
  );
  const indexById = new Map<string, number>(
    output.map((m, i) => [m.id, i] as const),
  );

  for (const tf of threadFiles) {
    const sorted = [...tf.messages].sort((a, b) =>
      compareSnowflake(a.id, b.id),
    );
    const starterIdx = indexById.get(tf.threadId);

    if (starterIdx !== undefined) {
      // Text channel: starter is in parent channel; thread file has only replies
      output[starterIdx].thread = {
        id: tf.threadId,
        name: tf.threadName,
        messages: sorted.map(stripContext),
      };
    } else {
      // Forum channel (or text channel where starter is unfetchable):
      // first message in thread file becomes the starter
      const [starter, ...rest] = sorted;
      const cm = toConsolidated(starter);
      cm.thread = {
        id: tf.threadId,
        name: tf.threadName,
        messages: rest.map(stripContext),
      };
      output.push(cm);
      indexById.set(starter.id, output.length - 1);
    }
  }

  output.sort((a, b) => compareSnowflake(a.id, b.id));
  return output;
}

// ---- Main ----

function main() {
  if (!existsSync(SRC_DIR)) {
    logger.error(`Source dir not found: ${SRC_DIR}`);
    process.exit(1);
  }

  // Wipe & rebuild for full idempotency (consolidated/ 는 파생 데이터)
  if (existsSync(OUT_DIR)) {
    rmSync(OUT_DIR, { recursive: true, force: true });
    logger.info(`Cleared existing output: ${OUT_DIR}`);
  }
  mkdirSync(OUT_DIR, { recursive: true });

  // Map of sanitized channel name → channel file path
  const channelFromFiles = new Map<string, string>();
  for (const path of listJsonFiles(CHANNELS_DIR)) {
    channelFromFiles.set(basename(path, ".json"), path);
  }
  const channelFromThreadDirs = new Set<string>(listSubdirs(THREADS_DIR));

  const allChannelNames = [
    ...new Set<string>([...channelFromFiles.keys(), ...channelFromThreadDirs]),
  ].sort();

  let totalEntries = 0;
  let totalWithThread = 0;
  let totalNestedMessages = 0;

  for (const channelName of allChannelNames) {
    const channelFile = channelFromFiles.get(channelName);
    const channelMessages = channelFile
      ? readJson<MessageRecord[]>(channelFile)
      : null;

    const threadDir = join(THREADS_DIR, channelName);
    const threadFiles: ThreadFile[] = [];
    for (const path of listJsonFiles(threadDir)) {
      const tf = loadThreadFile(path);
      if (tf) threadFiles.push(tf);
    }

    const consolidated = consolidateChannel(channelMessages, threadFiles);
    writeFileSync(
      join(OUT_DIR, `${channelName}.json`),
      JSON.stringify(consolidated, null, 2),
    );

    const withThread = consolidated.filter((m) => m.thread).length;
    const nested = consolidated.reduce(
      (s, m) => s + (m.thread?.messages.length ?? 0),
      0,
    );
    totalEntries += consolidated.length;
    totalWithThread += withThread;
    totalNestedMessages += nested;
    logger.info(
      `${channelName}: ${consolidated.length} entries (${withThread} threaded, ${nested} nested replies)`,
    );
  }

  logger.info(`\nDone!`);
  logger.info(`  Channels:           ${allChannelNames.length}`);
  logger.info(`  Top-level entries:  ${totalEntries}`);
  logger.info(`  Entries w/ thread:  ${totalWithThread}`);
  logger.info(`  Nested replies:     ${totalNestedMessages}`);
  logger.info(`  Output: ${OUT_DIR}`);
}

main();
