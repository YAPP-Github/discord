import OpenAI from "openai";

// OpenAI 임베딩 제공자.
// 환경변수:
//   OPENAI_API_KEY — 필수
//   EMBEDDING_MODEL — 선택, 기본 text-embedding-3-small (1536d)
//
// 모델 변경 시 차원도 함께 바뀌면 data/rag.db 삭제 후 재인덱싱 필요.

const DEFAULT_MODEL = "text-embedding-3-small";

const MODEL_DIM: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
};

function resolveModel(): string {
  const raw = (process.env.EMBEDDING_MODEL ?? "").trim().toLowerCase();
  // 빈 값 또는 "openai" 같은 별칭은 기본 모델로 매핑
  if (!raw || raw === "openai") return DEFAULT_MODEL;
  return process.env.EMBEDDING_MODEL!.trim();
}

export function getEmbedDim(): number {
  const model = resolveModel();
  const dim = MODEL_DIM[model];
  if (!dim) {
    throw new Error(
      `Unknown embedding model: ${model}. Add it to MODEL_DIM in embeddingProvider.ts.`,
    );
  }
  return dim;
}

export function getEmbedProviderInfo(): { model: string; dim: number } {
  return { model: resolveModel(), dim: getEmbedDim() };
}

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (openai) return openai;
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured");
  openai = new OpenAI({ apiKey: key });
  return openai;
}

function toFloat32(arr: number[]): Float32Array {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i];
  return out;
}

export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const model = resolveModel();
  const res = await getOpenAI().embeddings.create({ model, input: texts });
  return res.data.map((d) => toFloat32(d.embedding));
}

export async function embedOne(text: string): Promise<Float32Array> {
  const [v] = await embedTexts([text]);
  return v;
}
