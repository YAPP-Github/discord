// 한국어 BM25 인덱싱·검색용 사전 토크나이저.
// 인터페이스: tokenize(text) -> 공백 분리 가능한 토큰 배열.
//
// 현재 MVP 구현: 정규식 기반 — 한국어 조사·어미를 휴리스틱으로 분리.
// 진짜 형태소 분석(kiwi-nlp) 으로 교체할 때 본 모듈의 `tokenize` 시그니처만 유지하면
// 호출자(`build-rag-chunks`, `ragService`)는 변경 불필요.
//
// kiwi-nlp 통합 가이드(추후):
//   1) kiwi-wasm.wasm + 모델 파일을 data/kiwi/ 에 배치
//   2) KiwiBuilder.create(wasmPath) -> builder.build({modelFiles}) 로 instance 생성
//   3) instance.tokenize(str).map(t => t.str) 를 본 모듈의 반환값으로 사용

const KOREAN_PARTICLES = [
  // 격조사 (순서: 긴 것부터 — 매칭 우선)
  "에서부터",
  "으로부터",
  "에게서",
  "에서는",
  "에서도",
  "에서의",
  "으로는",
  "으로서",
  "으로써",
  "라고는",
  "이라고",
  "에서",
  "에게",
  "한테",
  "께서",
  "으로",
  "라고",
  "라는",
  "이라",
  "에는",
  "에도",
  "에를",
  "에의",
  "보다",
  "처럼",
  "마다",
  "조차",
  "까지",
  "마저",
  "부터",
  "이나",
  "거나",
  "든지",
  "라도",
  // 보조사·접속조사
  "이라도",
  "이라면",
  "이라서",
  "이지만",
  "지만",
  "이며",
  "이고",
  "이지",
  // 단음절 조사 (마지막에 — 다른 것보다 우선순위 낮음)
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "의",
  "도",
  "만",
  "와",
  "과",
  "야",
  "여",
  "며",
  "랑",
  "에",
  "로",
];

// 어미 — 동사·형용사 어간 추출용 (정확한 형태소 분석은 아니나 BM25 에 충분)
const KOREAN_ENDINGS = [
  "습니다",
  "ㅂ니다",
  "었습니다",
  "았습니다",
  "였습니다",
  "겠습니다",
  "합니다",
  "입니다",
  "이에요",
  "예요",
  "이야",
  "이다",
  "이라",
  "되다",
  "하다",
  "었다",
  "았다",
  "였다",
  "했다",
  "한다",
  "한대",
  "해요",
  "해서",
  "하여",
  "하고",
  "하니",
  "하면",
  "이고",
  "이며",
  "있다",
  "없다",
  "이지",
  "지요",
  "거든",
  "더라",
  "네요",
  "어요",
  "아요",
  "구요",
  "더군",
  "셨다",
  "시다",
  "려고",
  "려는",
];

const PARTICLE_PATTERN = new RegExp(`(${KOREAN_PARTICLES.join("|")})$`);
const ENDING_PATTERN = new RegExp(`(${KOREAN_ENDINGS.join("|")})$`);
const URL_PATTERN = /https?:\/\/\S+/g;
const CODE_FENCE_PATTERN = /```[\s\S]*?```/g;
const INLINE_CODE_PATTERN = /`[^`]+`/g;
// 한글·영문·숫자·언더스코어를 토큰의 경계로 사용.
const WORD_BOUNDARY = /[^\p{Letter}\p{Number}_]+/u;

const MIN_TOKEN_LEN = 2;

// 한국어 BM25 의 정확도를 떨어뜨리는 흔한 토큰들 (의문사·공통 어미·인사).
// 인덱싱과 쿼리 양쪽에서 동일하게 drop → 매칭 일관성 유지.
// 보수적으로 유지: 도메인 의미를 가진 단어(진행, 결정, 발표 등)는 절대 stopword 로 넣지 말 것.
const STOPWORDS = new Set<string>([
  // 의문사 — 거의 모든 질문에 등장하지만 답과 매칭에 기여 안 함
  "어떻게",
  "어디서",
  "어디",
  "어디인가",
  "어디일까",
  "언제",
  "누가",
  "누구",
  "무엇",
  "어떤",
  // 공통 동사 어미·시제
  "했어",
  "했어요",
  "했나요",
  "했었어",
  "했었나요",
  "한다",
  "합니다",
  "됐어",
  "됐어요",
  "됐나요",
  "됐었어",
  "된다",
  "있어",
  "있어요",
  "있나요",
  "있었나요",
  "없어",
  "없어요",
  "없나요",
  "이에요",
  "예요",
  // 인사·접두
  "안녕",
  "안녕하세요",
]);

function stripSuffix(token: string, pattern: RegExp): string {
  let prev: string;
  let cur = token;
  let safety = 0;
  do {
    prev = cur;
    cur = cur.replace(pattern, "");
    safety += 1;
  } while (prev !== cur && cur.length >= MIN_TOKEN_LEN && safety < 4);
  return cur;
}

function normalizeToken(raw: string): string | null {
  if (raw.length < MIN_TOKEN_LEN) return null;
  const lower = raw.toLowerCase();
  const isHangul = /[가-힯]/.test(lower);
  if (!isHangul) {
    if (lower.length < MIN_TOKEN_LEN) return null;
    return STOPWORDS.has(lower) ? null : lower;
  }
  // 한글: 조사·어미 제거
  let stripped = stripSuffix(lower, PARTICLE_PATTERN);
  stripped = stripSuffix(stripped, ENDING_PATTERN);
  if (stripped.length < MIN_TOKEN_LEN) return null;
  // stopword 는 원형(raw lowered) 과 stem 양쪽 비교
  if (STOPWORDS.has(stripped) || STOPWORDS.has(lower)) return null;
  return stripped;
}

/**
 * 입력 텍스트를 BM25 인덱싱 가능한 토큰 배열로 변환.
 * URL·코드 블록은 빈 공간으로 치환되어 토큰에서 제외된다.
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const stripped = text
    .replace(CODE_FENCE_PATTERN, " ")
    .replace(INLINE_CODE_PATTERN, " ")
    .replace(URL_PATTERN, " ");
  const rawTokens = stripped.split(WORD_BOUNDARY);
  const out: string[] = [];
  for (const raw of rawTokens) {
    const norm = normalizeToken(raw);
    if (norm) out.push(norm);
  }
  return out;
}

/**
 * fts5 MATCH 쿼리에 넣을 수 있는 공백 분리 문자열로 변환.
 * 색인 시 `text_tokenized` 컬럼에, 검색 시 동일 함수로 쿼리를 분해해 MATCH 절에 사용.
 */
export function tokenizeJoined(text: string): string {
  return tokenize(text).join(" ");
}
