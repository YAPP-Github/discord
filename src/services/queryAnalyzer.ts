import { getClaudeClient } from "./claude.js";
import { logger } from "../utils/logger.js";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 800;

export interface QueryAnalysis {
  rewritten: string;
  filters: {
    generation: string | null;
    channel_categories: string[];
    channel_exclude_categories: string[];
  };
  intent_target:
    | "event_meta"
    | "decision"
    | "announcement"
    | "answer"
    | "status_update"
    | "smalltalk_filter"
    | "unknown";
  entities: {
    events: string[];
    locations: string[];
    dates: string[];
    amounts: string[];
    persons: string[];
  };
  hyde: string | null;
}

const SYSTEM_PROMPT = `당신은 YAPP Discord 검색 시스템의 쿼리 분석 어시스턴트입니다.
사용자 자연어 질문을 받아 검색에 최적화된 메타데이터를 추출하세요.

YAPP 도메인 컨텍스트:
- 기수: 21기~28기 형태
- 채널 카테고리: 공지, 질문, 채용, 회계, 출결, 스터디, 회고, 운영, 번개, 세션, 기획, 잡담, 직군, infra, general
- 주요 행사: 데모데이, 성과공유회, 인프콘, OT(오리엔테이션), 해커톤, 회식
- 직군: PM, design, server, android, ios, web

규칙:
1. rewritten: 원 질의의 핵심 키워드 + YAPP 도메인 동의어(예: "해커톤" → "해커톤 데모데이 행사 이벤트"). 한국어 자연스러운 문장 형태.
2. filters.generation: 질의에 명시된 기수만. 없으면 null.
3. filters.channel_categories: 답이 있을 법한 카테고리 (보수적으로 1~3개).
4. filters.channel_exclude_categories: 단어가 등장해도 답이 없을 카테고리 (예: 장소 질문에 "회계"·"infra" 제외).
5. intent_target:
   - event_meta: 시간·장소·일정 질의
   - decision: "어떻게 결정", "확정" 질의
   - announcement: 공지·안내 검색
   - answer: 일반 정보 검색 ("어떻게 했나요")
   - status_update: 진행·완료 상태
   - smalltalk_filter: 잡담 검색은 거의 없음
   - unknown: 분류 어려움
6. entities: 본문에서 명시적으로 언급된 것만. 없으면 빈 배열.
7. hyde: 이 질문에 대해 그럴듯한 가상 답변 1~2문장. 임베딩 검색용. 단순 질문이면 null.

응답은 반드시 다음 JSON 한 객체만, 다른 텍스트 금지:`;

const EXAMPLE_SCHEMA = `{
  "rewritten": "...",
  "filters": { "generation": null, "channel_categories": [], "channel_exclude_categories": [] },
  "intent_target": "unknown",
  "entities": { "events": [], "locations": [], "dates": [], "amounts": [], "persons": [] },
  "hyde": null
}`;

function extractJson(text: string): unknown {
  // ```json ``` 블록 또는 plain JSON 둘 다 처리
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in response");
  return JSON.parse(raw.slice(start, end + 1));
}

function safeArrayOfStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function normalizeGeneration(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/(\d{2})/);
  return m ? `${m[1]}기` : null;
}

function normalize(parsed: unknown): QueryAnalysis {
  const p = (parsed ?? {}) as Record<string, unknown>;
  const filters = (p.filters ?? {}) as Record<string, unknown>;
  const entities = (p.entities ?? {}) as Record<string, unknown>;
  return {
    rewritten: typeof p.rewritten === "string" ? p.rewritten : "",
    filters: {
      generation: normalizeGeneration(filters.generation),
      channel_categories: safeArrayOfStrings(filters.channel_categories),
      channel_exclude_categories: safeArrayOfStrings(
        filters.channel_exclude_categories,
      ),
    },
    intent_target: ((): QueryAnalysis["intent_target"] => {
      const v = String(p.intent_target ?? "unknown");
      const allowed: QueryAnalysis["intent_target"][] = [
        "event_meta",
        "decision",
        "announcement",
        "answer",
        "status_update",
        "smalltalk_filter",
        "unknown",
      ];
      return allowed.includes(v as QueryAnalysis["intent_target"])
        ? (v as QueryAnalysis["intent_target"])
        : "unknown";
    })(),
    entities: {
      events: safeArrayOfStrings(entities.events),
      locations: safeArrayOfStrings(entities.locations),
      dates: safeArrayOfStrings(entities.dates),
      amounts: safeArrayOfStrings(entities.amounts),
      persons: safeArrayOfStrings(entities.persons),
    },
    hyde: typeof p.hyde === "string" && p.hyde.trim() ? p.hyde : null,
  };
}

export async function analyzeQuery(query: string): Promise<QueryAnalysis> {
  try {
    const client = getClaudeClient();
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: `${SYSTEM_PROMPT}\n\n${EXAMPLE_SCHEMA}`,
      messages: [{ role: "user", content: query }],
    });
    const text =
      res.content.find((c) => c.type === "text")?.type === "text"
        ? (res.content.find((c) => c.type === "text") as { text: string }).text
        : "";
    return normalize(extractJson(text));
  } catch (err) {
    logger.warn("[queryAnalyzer] failed, returning empty analysis:", err);
    return {
      rewritten: query,
      filters: {
        generation: null,
        channel_categories: [],
        channel_exclude_categories: [],
      },
      intent_target: "unknown",
      entities: {
        events: [],
        locations: [],
        dates: [],
        amounts: [],
        persons: [],
      },
      hyde: null,
    };
  }
}
