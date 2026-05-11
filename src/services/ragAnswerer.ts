import OpenAI from "openai";
import type { ThreadContext } from "./ragService.js";
import { logger } from "../utils/logger.js";
import { buildSystemPrompt } from "./ragAgentPrompt.js";

const MODEL = process.env.RAG_ANSWER_MODEL ?? "gpt-4o-mini";
const MAX_TOKENS = 800;
const MAX_CONTEXT_CHARS_PER_THREAD = 1500;

function relativeTimePhrase(timestamp: string, now: Date): string {
  const t = new Date(timestamp);
  if (Number.isNaN(t.getTime())) return "(시점 불명)";
  const days = Math.floor((now.getTime() - t.getTime()) / 86_400_000);
  if (days < 0) return `약 ${Math.abs(days)}일 뒤 예정`;
  if (days === 0) return "오늘";
  if (days < 7) return `${days}일 전`;
  if (days < 35) return `${Math.floor(days / 7)}주 전`;
  if (days < 365) return `약 ${Math.floor(days / 30)}개월 전`;
  return `약 ${(days / 365).toFixed(1)}년 전`;
}

function isoDate(timestamp: string): string {
  const t = new Date(timestamp);
  if (Number.isNaN(t.getTime())) return timestamp;
  return t.toISOString().slice(0, 10);
}

export interface RagAnswer {
  is_relevant: boolean;
  answer: string;
  cited_indices: number[]; // threads 배열의 0-based index
}

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (openai) return openai;
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured");
  openai = new OpenAI({ apiKey: key });
  return openai;
}

// 시스템 프롬프트는 ragAgentPrompt.ts 에서 관리.
// 응답 스키마는 프롬프트 본문에 이미 포함되어 있음.

function buildContext(threads: ThreadContext[], now: Date): string {
  return threads
    .map((t, i) => {
      const ts = t.chunks[0]?.timestamp_start;
      const dateInfo = ts
        ? ` | 작성시각: ${isoDate(ts)} (${relativeTimePhrase(ts, now)})`
        : "";
      const head =
        `[${i + 1}] 채널: ${t.channel_name}` +
        (t.thread_name ? ` | 쓰레드: ${t.thread_name}` : "") +
        ` | 기수: ${t.generation ?? "-"}${dateInfo}`;
      const body = t.chunks
        .map((c) => c.text)
        .join("\n---\n")
        .slice(0, MAX_CONTEXT_CHARS_PER_THREAD);
      return `${head}\n${body}`;
    })
    .join("\n\n========\n\n");
}

function safeIntArray(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "number" ? Math.floor(x) : Number(x)))
    .filter((n) => Number.isFinite(n) && n >= 1);
}

function parse(raw: string): RagAnswer {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return {
    is_relevant: parsed.is_relevant === true,
    answer: typeof parsed.answer === "string" ? parsed.answer : "",
    // 1-based → 0-based
    cited_indices: safeIntArray(parsed.cited_indices).map((n) => n - 1),
  };
}

export async function generateAnswer(
  query: string,
  threads: ThreadContext[],
): Promise<RagAnswer> {
  if (threads.length === 0) {
    return { is_relevant: false, answer: "", cited_indices: [] };
  }

  const now = new Date();
  const nowIso = now.toISOString().slice(0, 10);
  const context = buildContext(threads, now);
  const userMsg = `질문: ${query}\n\n컨텍스트:\n${context}`;

  try {
    const res = await getOpenAI().chat.completions.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildSystemPrompt(nowIso) },
        { role: "user", content: userMsg },
      ],
    });
    const text = res.choices[0]?.message?.content ?? "";
    if (!text) throw new Error("Empty response from OpenAI");
    return parse(text);
  } catch (err) {
    logger.error("[ragAnswerer] failed", err);
    throw err;
  }
}
