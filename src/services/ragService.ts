import { tokenizeJoined } from "./koreanTokenizer.js";
import { embedOne } from "./embeddingProvider.js";
import { analyzeQuery, type QueryAnalysis } from "./queryAnalyzer.js";
import {
  searchBM25,
  searchVector,
  getChunk,
  getChunksByThread,
  getChunkLabels,
  type ChunkRow,
  type SearchFilters,
} from "../db/repositories/ragRepository.js";

const BM25_TOP_K = 50;
const VECTOR_TOP_K = 50;
const RRF_K = 60;
const POST_FUSION_TOP_K = 30;
const FINAL_TOP_K = 8;
const FINAL_THREADS = 5;
// 이 미만은 "관련 답변 없음" 으로 간주 (webhook spam 등이 후보 부족 시 떠오르는 케이스 차단)
const MIN_FINAL_SCORE = 0.008;

async function embedQuery(text: string): Promise<Float32Array> {
  return embedOne(text);
}

interface FusedHit {
  chunk_id: string;
  rrf_score: number;
}

function reciprocalRankFusion(
  rankedLists: Array<Array<{ chunk_id: string }>>,
): FusedHit[] {
  const scores = new Map<string, number>();
  for (const list of rankedLists) {
    list.forEach((hit, idx) => {
      const rank = idx + 1;
      const inc = 1 / (RRF_K + rank);
      scores.set(hit.chunk_id, (scores.get(hit.chunk_id) ?? 0) + inc);
    });
  }
  return [...scores.entries()]
    .map(([chunk_id, rrf_score]) => ({ chunk_id, rrf_score }))
    .sort((a, b) => b.rrf_score - a.rrf_score);
}

export interface RagSearchInput {
  query: string;
  filters?: SearchFilters;
  /** false 면 query analyzer LLM 단계 건너뛰고 휴리스틱만 사용 */
  useQueryAnalyzer?: boolean;
}

export interface ThreadContext {
  parent_thread_id: string;
  channel_id: string;
  channel_name: string;
  channel_category: string | null;
  generation: string | null;
  thread_id: string | null;
  thread_name: string | null;
  matched_chunk_ids: string[];
  top_rrf_score: number;
  final_score: number;
  chunks: ChunkRow[];
}

export type EmbeddingStatus =
  | "ok"
  | "quota_exceeded"
  | "rate_limited"
  | "failed";

export interface RagSearchResult {
  query: string;
  analysis: QueryAnalysis | null;
  applied_filters: SearchFilters;
  bm25_hits: number;
  vector_hits: number;
  fused: number;
  embedding_status: EmbeddingStatus;
  threads: ThreadContext[];
}

const VALID_CATEGORIES = [
  "공지",
  "질문",
  "채용",
  "회계",
  "출결",
  "스터디",
  "회고",
  "운영",
  "infra",
  "번개",
  "세션",
  "기획",
  "잡담",
  "직군",
  "general",
];

function lightHeuristicFilters(query: string): SearchFilters {
  const filters: SearchFilters = {};
  const gen = query.match(/(\d{2})기/);
  if (gen) filters.generation = `${gen[1]}기`;
  for (const c of VALID_CATEGORIES) {
    if (c !== "general" && query.includes(c)) {
      filters.channel_category = c;
      break;
    }
  }
  return filters;
}

// Label-aware re-rank. Tier 1 chunk labels + QU-derived channel filters.
function rerankWithLabels(
  fused: FusedHit[],
  analysis: QueryAnalysis | null,
): Array<FusedHit & { final_score: number }> {
  const labels = getChunkLabels(fused.map((f) => f.chunk_id));
  const include = new Set(analysis?.filters.channel_categories ?? []);
  const exclude = new Set(analysis?.filters.channel_exclude_categories ?? []);

  return fused
    .map((hit) => {
      const cl = labels.get(hit.chunk_id);
      if (!cl) return { ...hit, final_score: hit.rrf_score };

      let mult = 1;
      // Tier 1 휴리스틱
      if (cl.is_smalltalk === 1) mult *= 0.25;
      if (cl.is_canonical === 1) mult *= 1.2;
      if (cl.is_question === 1) mult *= 0.65; // 질문 청크는 답 아님

      // signal_score: 0~1 → 0.6~1.4 multiplier
      const ss = cl.signal_score ?? 0.3;
      mult *= 0.6 + ss * 0.8;

      // QU 카테고리 화이트리스트/블랙리스트
      if (cl.channel_category) {
        if (exclude.has(cl.channel_category)) mult *= 0.2;
        else if (include.has(cl.channel_category)) mult *= 1.3;
      }

      return { ...hit, final_score: hit.rrf_score * mult };
    })
    .sort((a, b) => b.final_score - a.final_score);
}

export async function search(input: RagSearchInput): Promise<RagSearchResult> {
  const query = input.query.trim();
  if (!query) {
    return {
      query,
      analysis: null,
      applied_filters: {},
      bm25_hits: 0,
      vector_hits: 0,
      fused: 0,
      embedding_status: "ok",
      threads: [],
    };
  }

  // 1) Query analysis — LLM (graceful fallback to heuristic)
  let analysis: QueryAnalysis | null = null;
  if (input.useQueryAnalyzer !== false) {
    analysis = await analyzeQuery(query);
  }

  // 2) Filter 병합: QU > user > heuristic
  const heuristic = lightHeuristicFilters(query);
  const filters: SearchFilters = {
    ...heuristic,
    ...(analysis?.filters.generation
      ? { generation: analysis.filters.generation }
      : {}),
    ...(input.filters ?? {}),
  };
  // 주의: channel_category SQL 필터는 단일값. QU 의 channel_categories 는 re-rank 에서 적용.
  // (단, 사용자가 명시적으로 단일 카테고리 지정한 경우 그것만 SQL 단계에서 hard filter)

  // 3) BM25 — rewritten query 사용 (QU 가 도메인 용어 확장)
  const bm25Query = analysis?.rewritten?.trim() || query;
  const tokenizedQuery = tokenizeJoined(bm25Query);
  const bm25 = tokenizedQuery
    ? searchBM25(tokenizedQuery, BM25_TOP_K, filters)
    : [];

  // 4) Vector — rewritten 우선 (HyDE 는 LLM 추측이 코퍼스 사실과 어긋나면 더 해로움 → 비활성)
  let vector: Awaited<ReturnType<typeof searchVector>> = [];
  let embeddingStatus: EmbeddingStatus = "ok";
  const embedTarget = analysis?.rewritten?.trim() || query;
  try {
    const qvec = await embedQuery(embedTarget);
    vector = searchVector(qvec, VECTOR_TOP_K, filters);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/quota|insufficient_quota|billing/i.test(msg)) {
      embeddingStatus = "quota_exceeded";
    } else if (msg.includes("429") || /rate.?limit/i.test(msg)) {
      embeddingStatus = "rate_limited";
    } else {
      embeddingStatus = "failed";
    }
    console.warn(
      `[rag] embedding ${embeddingStatus}, falling back to BM25 only:`,
      msg,
    );
  }

  // 5) RRF fusion
  const fused = reciprocalRankFusion([bm25, vector]).slice(
    0,
    POST_FUSION_TOP_K,
  );

  // 6) Label-aware re-rank + score threshold
  const reranked = rerankWithLabels(fused, analysis);
  const topK = reranked
    .filter((h) => h.final_score >= MIN_FINAL_SCORE)
    .slice(0, FINAL_TOP_K);

  // 7) parent_thread_id 단위로 dedup + 전체 쓰레드 확장
  const seenThreads = new Set<string>();
  const threads: ThreadContext[] = [];
  for (const hit of topK) {
    const allChunks = lookupThreadByChunk(hit.chunk_id);
    if (!allChunks || allChunks.length === 0) continue;
    const tid = allChunks[0].parent_thread_id;
    if (seenThreads.has(tid)) {
      const existing = threads.find((t) => t.parent_thread_id === tid);
      if (existing) existing.matched_chunk_ids.push(hit.chunk_id);
      continue;
    }
    seenThreads.add(tid);
    const head = allChunks[0];
    threads.push({
      parent_thread_id: tid,
      channel_id: head.channel_id,
      channel_name: head.channel_name,
      channel_category: head.channel_category,
      generation: head.generation,
      thread_id: head.thread_id,
      thread_name: head.thread_name,
      matched_chunk_ids: [hit.chunk_id],
      top_rrf_score: hit.rrf_score,
      final_score: hit.final_score,
      chunks: allChunks,
    });
    if (threads.length >= FINAL_THREADS) break;
  }

  return {
    query,
    analysis,
    applied_filters: filters,
    bm25_hits: bm25.length,
    vector_hits: vector.length,
    fused: fused.length,
    embedding_status: embeddingStatus,
    threads,
  };
}

function lookupThreadByChunk(chunkId: string): ChunkRow[] | null {
  const head = getChunk(chunkId);
  if (!head) return null;
  return getChunksByThread(head.parent_thread_id);
}
