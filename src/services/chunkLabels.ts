// 청크 단위 휴리스틱 라벨 — Tier 1 (LLM 호출 없음, 결정론적).
//
// 모든 함수는 pure: 입력 청크 메타데이터만 보고 라벨 산출.
// chunk 텍스트에서 [채널]/[쓰레드]/[작성자]/[STARTER]/[REPLIES] 헤더를 제거한 뒤 평가.

const SMALLTALK_PATTERNS = [
  /^[ㅋㅎㅇㅅㄷㄴㄱㄹㅁㅂㅈㅊㅍㅌㅡㅏㅓㅗㅜㅑㅕㅛㅠ\s.,!?]+$/, // 자모/단순 감탄
  /^(넵+|네+|예+|오+|아+|음+|굿+|좋+|굿굿|화이팅|파이팅|땡큐|감사+|수고|고생|굿잡|gg)[!.?\s]*$/i,
  /^(yes|no|ok|good|nice|lol|wow|haha)[!.?\s]*$/i,
];

// 봇/webhook 자동 알림 청크 패턴 — 사람 답을 못 줌
const BOT_NOTICE_PATTERNS = [
  /새로운 지원자 알림/,
  /그리팅에서 상세 내용/,
  /Build (succeeded|failed)/i,
  /Deploy (succeeded|failed)/i,
  /webhook|alert.bot/i,
];

const QUESTION_KEYWORDS =
  /(어떻게|어떡|왜|어디|언제|누가|뭐예요|뭐에요|뭔가요|뭐가|뭐임|뭐임요|무엇|어떤|얼마|있나요|없나요|되나요|할까요|가능한가요|어떨까|있을까요)/;

function stripChunkHeaders(text: string): string {
  // 1) 헤더 라인 ([채널]/[쓰레드]/[작성자]/[STARTER]/[REPLIES]) 제거
  // 2) reply 라인의 `- author:` prefix 제거 → 본문만 남김
  return text
    .split("\n")
    .filter((line) => !/^\[(채널|쓰레드|작성자|STARTER|REPLIES)\]/.test(line))
    .map((line) => line.replace(/^- [^:]+:\s*/, ""))
    .join("\n")
    .trim();
}

function effectiveContent(text: string): string {
  return stripChunkHeaders(text);
}

export function isSmalltalk(text: string): boolean {
  const content = effectiveContent(text);
  if (content.length === 0) return true;
  if (content.length < 6) return true;
  for (const pat of SMALLTALK_PATTERNS) {
    if (pat.test(content)) return true;
  }
  // 짧고 의미 단어가 부족한 경우
  if (content.length < 15 && /^[ㅋㅎㅇ\s]+/.test(content)) return true;
  return false;
}

export function isBotNotice(text: string): boolean {
  const content = effectiveContent(text);
  for (const pat of BOT_NOTICE_PATTERNS) {
    if (pat.test(content)) return true;
  }
  return false;
}

export function isQuestion(text: string): boolean {
  const content = effectiveContent(text);
  // 1) 의문부호 존재 시 무조건 question
  if (/[?？]/.test(content)) return true;
  // 2) 첫 문장이 의문문 형태일 때만 (전체 본문에서 incidental 매칭 방지)
  const first = content
    .split(/[.!?\n]/)[0]
    .trim()
    .slice(0, 80);
  if (QUESTION_KEYWORDS.test(first)) return true;
  return false;
}

export interface ChunkLabelInputs {
  text: string;
  channel_category: string | null;
  is_starter_only: number; // 0|1
  reply_count: number;
  reaction_positive: number;
  reaction_negative: number;
  has_attachments: number;
  has_link: number;
  has_code: number;
  token_count: number;
  timestamp_start: string;
}

/**
 * 0.0~1.0 신호 점수. 길이·반응·첨부·링크·답글 종합. smalltalk 면 0.3 배 감쇠.
 */
export function signalScore(c: ChunkLabelInputs): number {
  const content = effectiveContent(c.text);
  let s = 0;
  s += Math.min(content.length / 400, 0.35);
  s += Math.min(c.token_count / 800, 0.15);
  if (c.has_link) s += 0.08;
  if (c.has_code) s += 0.1;
  if (c.has_attachments) s += 0.06;
  s += Math.min(c.reaction_positive * 0.03, 0.15);
  s += Math.min(c.reply_count * 0.02, 0.1);
  if (c.reaction_negative > c.reaction_positive) s -= 0.05;
  if (isSmalltalk(c.text)) s *= 0.3;
  if (isBotNotice(c.text)) s *= 0.2;
  return Math.max(0, Math.min(s, 1));
}

/**
 * 메시지 시각 vs 기준일(now) 의 상대 위치.
 *  - recent   : 30일 이내
 *  - this_year: 1년 이내
 *  - past_gen : 2년 이내
 *  - old      : 2년 초과
 */
export function ageBucket(timestamp: string, now: Date = new Date()): string {
  const t = new Date(timestamp);
  if (Number.isNaN(t.getTime())) return "unknown";
  const days = (now.getTime() - t.getTime()) / 86_400_000;
  if (days < 30) return "recent";
  if (days < 365) return "this_year";
  if (days < 730) return "past_gen";
  return "old";
}

/**
 * 공식적/권위 있는 청크인지. 다음 신호 중 2개 이상이면 canonical.
 *  - reaction_positive ≥ 5
 *  - token_count ≥ 80 (긴 본문)
 *  - 공지/운영 카테고리
 *  - starter 면서 reply 3개 이상 (호응 받는 starter)
 *  - 첨부 또는 링크 존재
 */
export function isCanonical(c: ChunkLabelInputs): boolean {
  let signals = 0;
  if (c.reaction_positive >= 5) signals += 1;
  if (c.token_count >= 80) signals += 1;
  if (c.channel_category === "공지" || c.channel_category === "운영")
    signals += 1;
  if (c.is_starter_only === 1 && c.reply_count >= 3) signals += 1;
  if (c.has_attachments || c.has_link) signals += 1;
  return signals >= 2;
}

export interface ComputedLabels {
  signal_score: number;
  is_smalltalk: number; // 0|1
  is_canonical: number; // 0|1
  is_question: number; // 0|1
  age_bucket: string;
}

export function computeLabels(
  c: ChunkLabelInputs,
  now: Date = new Date(),
): ComputedLabels {
  // bot/webhook 청크는 smalltalk 로도 마킹 — retrieval re-rank 에서 0.25x penalty
  const smalltalk = isSmalltalk(c.text) || isBotNotice(c.text);
  return {
    signal_score: signalScore(c),
    is_smalltalk: smalltalk ? 1 : 0,
    is_canonical: isCanonical(c) ? 1 : 0,
    is_question: isQuestion(c.text) ? 1 : 0,
    age_bucket: ageBucket(c.timestamp_start, now),
  };
}
