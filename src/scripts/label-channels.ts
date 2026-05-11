import dotenv from "dotenv";
dotenv.config({ path: ".env.local", override: true });

import { logger } from "../utils/logger.js";
import { getRagDatabase } from "../db/rag.js";
import { getClaudeClient } from "../services/claude.js";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 600;
const SAMPLES_PER_CHANNEL = 15;
const CONCURRENCY = 3;
const MAX_RETRIES = 4;

interface SampleRow {
  text: string;
}

interface ChannelRow {
  channel_id: string;
  channel_name: string;
}

interface ChannelLabel {
  primary_topic: string;
  topics: string[];
  description: string;
  answers_questions: string[];
  does_not_answer: string[];
}

const SYSTEM_PROMPT = `당신은 YAPP Discord 채널 분류 어시스턴트입니다.
주어진 채널 이름과 샘플 메시지를 보고 채널의 성격을 분류하세요.

YAPP 도메인:
- 기수: 21기~28기
- 행사: 데모데이, 성과공유회, 인프콘, OT, 해커톤
- 직군: PM, design, server, android, ios, web

규칙:
- primary_topic: 가장 빈도 높은 주제 한 단어 (예: "회계 정산", "행사 운영", "채용 면접")
- topics: 채널에서 다뤄지는 부주제 1~5개
- description: 한 문장 채널 설명
- answers_questions: 이 채널에서 답을 찾을 수 있는 질문 유형 (예: ["비용", "지출", "예산"])
- does_not_answer: 단어가 등장은 하지만 답을 찾기 어려운 질문 유형 (예: ["행사 장소", "면접 일정"])

응답은 반드시 JSON 한 객체만, 다른 텍스트 금지.`;

const EXAMPLE_SCHEMA = `{
  "primary_topic": "...",
  "topics": [],
  "description": "...",
  "answers_questions": [],
  "does_not_answer": []
}`;

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in response");
  return JSON.parse(raw.slice(start, end + 1));
}

function arr(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

function normalize(parsed: unknown): ChannelLabel {
  const p = (parsed ?? {}) as Record<string, unknown>;
  return {
    primary_topic: typeof p.primary_topic === "string" ? p.primary_topic : "",
    topics: arr(p.topics),
    description: typeof p.description === "string" ? p.description : "",
    answers_questions: arr(p.answers_questions),
    does_not_answer: arr(p.does_not_answer),
  };
}

async function labelChannel(
  channel: ChannelRow,
  samples: string[],
): Promise<ChannelLabel | null> {
  const client = getClaudeClient();
  const userMsg = `채널: ${channel.channel_name}\n\n샘플 메시지:\n${samples
    .map((s, i) => `${i + 1}. ${s.slice(0, 400)}`)
    .join("\n")}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: `${SYSTEM_PROMPT}\n\n${EXAMPLE_SCHEMA}`,
        messages: [{ role: "user", content: userMsg }],
      });
      const text =
        res.content.find((c) => c.type === "text")?.type === "text"
          ? (res.content.find((c) => c.type === "text") as { text: string })
              .text
          : "";
      return normalize(extractJson(text));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimit = msg.includes("rate_limit") || msg.includes("429");
      if (isRateLimit && attempt < MAX_RETRIES) {
        const backoff = Math.min(60_000, 5_000 * 2 ** (attempt - 1));
        logger.warn(
          `[label] ${channel.channel_name} rate_limited (attempt ${attempt}), backoff ${backoff}ms`,
        );
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      logger.error(
        `[label] ${channel.channel_name} failed (attempt ${attempt}): ${msg}`,
      );
      return null;
    }
  }
  return null;
}

async function processInBatches<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  const db = getRagDatabase();
  const all = db
    .prepare(
      `SELECT DISTINCT channel_id, channel_name
       FROM rag_chunks
       ORDER BY channel_name`,
    )
    .all() as ChannelRow[];

  // Resume: 이미 라벨링된 채널은 skip
  const already = new Set(
    (
      db.prepare(`SELECT channel_id FROM rag_channel`).all() as {
        channel_id: string;
      }[]
    ).map((r) => r.channel_id),
  );
  const channels = all.filter((c) => !already.has(c.channel_id));

  logger.info(
    `Channels total=${all.length}, already labeled=${already.size}, to label=${channels.length}`,
  );

  const upsert = db.prepare(
    `INSERT INTO rag_channel
      (channel_id, channel_name, primary_topic, topics, description,
       answers_questions, does_not_answer, labeled_at)
     VALUES (@channel_id, @channel_name, @primary_topic, @topics, @description,
       @answers_questions, @does_not_answer, @labeled_at)
     ON CONFLICT(channel_id) DO UPDATE SET
       channel_name=excluded.channel_name,
       primary_topic=excluded.primary_topic,
       topics=excluded.topics,
       description=excluded.description,
       answers_questions=excluded.answers_questions,
       does_not_answer=excluded.does_not_answer,
       labeled_at=excluded.labeled_at`,
  );

  let done = 0;
  await processInBatches(channels, CONCURRENCY, async (ch) => {
    const samples = (
      db
        .prepare(
          `SELECT text FROM rag_chunks
           WHERE channel_id = ?
           ORDER BY signal_score DESC NULLS LAST, token_count DESC
           LIMIT ?`,
        )
        .all(ch.channel_id, SAMPLES_PER_CHANNEL) as SampleRow[]
    ).map((r) => r.text);

    if (samples.length === 0) {
      done++;
      return;
    }

    const label = await labelChannel(ch, samples);
    if (label) {
      upsert.run({
        channel_id: ch.channel_id,
        channel_name: ch.channel_name,
        primary_topic: label.primary_topic,
        topics: JSON.stringify(label.topics),
        description: label.description,
        answers_questions: JSON.stringify(label.answers_questions),
        does_not_answer: JSON.stringify(label.does_not_answer),
        labeled_at: new Date().toISOString(),
      });
    }
    done++;
    if (done % 10 === 0) logger.info(`  ${done} / ${channels.length}`);
  });

  const total = (
    db.prepare(`SELECT COUNT(*) as c FROM rag_channel`).get() as { c: number }
  ).c;
  logger.info(`Done! labeled channels in DB: ${total}`);
}

main().catch((err) => {
  logger.error("label-channels failed", err);
  process.exit(1);
});
