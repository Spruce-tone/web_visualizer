// 문구가 겹치는 댓글 묶음의 의심 신호.
// 객관성 기준 (docs/objectivity.md):
//  - 점수 항목은 행동·구조뿐. 어조·주장·대상은 들어가지 않는다.
//  - 자연스러운 반복(짧은 반응, 흔한 인사·응원, 영상 인용, 타임스탬프, 참여 요청)은 먼저 걸러 점수를 내지 않는다.
//  - 근거가 부족하면(댓글 수가 적음, 시각이 거침) 점수를 내지 않고 '판단 보류'로 둔다.
//  - 점수는 항목별로 분해해 돌려준다. 같은 입력이면 항상 같은 결과.
import { normalizeForEmbed } from "./embed/hash.js";
import { DEFAULT_WEIGHTS } from "./weights.js";
import { sharedPhrases, normalize } from "./analyze.js";

const GENERIC = new Set(`
감사합니다 감사해요 감사 고맙습니다 고마워요 잘 보고 갑니다 봤습니다 봤어요 잘봤습니다 잘봤어요 보고갑니다 구독 좋아요 누르고 박고 가요
응원합니다 응원해요 응원 화이팅 파이팅 힘내세요 최고 최고예요 최고입니다 사랑해요 사랑합니다 축하합니다 축하해요 축하드려요 수고하셨습니다 고생하셨습니다
대박 멋져요 멋있어요 예뻐요 귀여워요 재밌어요 재밌다 재미있어요 항상 오늘도 영상 올려주셔서 기다렸어요 건강하세요 행복하세요 굿 짱
first nice video great good thanks thank you love this awesome amazing congrats congratulations cool wow so much keep it up
`.split(/\s+/).filter(Boolean));

const EVENT_RE = /(댓글|comment).{0,12}(남겨|적어|달아|써 ?주|참여|응모)|이벤트|추첨|giveaway|comment below/i;
const TIMESTAMP_RE = /\b\d{1,2}:\d{2}(:\d{2})?\b/;
const FINE_TIME_RE = /초|분|시간|second|minute|hour/i;

function genericShare(text) {
  const w = normalizeForEmbed(text).split(" ").filter(Boolean);
  if (!w.length) return 1;
  return w.filter((x) => GENERIC.has(x)).length / w.length;
}

/**
 * 묶음 안 모든 쌍의 평균 유사도. 쌍이 많으면(묶음 70개 초과) 정해진 순서로 고르게 뽑은 약 2,400쌍으로 잰다(같은 입력이면 같은 값).
 */
export function pairMean(g, sim) {
  const n = g.length;
  if (n < 2) return 1;
  let s = 0, c = 0;
  if (n <= 70) {
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) { s += sim(g[a], g[b]); c++; }
  } else {
    for (let t = 0; t < 2400; t++) {
      const a = (t * 7919) % n, b = (a + 1 + ((t * 104729) % (n - 1))) % n;
      s += sim(g[a], g[b]); c++;
    }
  }
  return s / c;
}

/** 자연스러운 반복이면 그 이유를, 아니면 null */
export function naturalRepetition(items, shared, ctx, T) {
  const avgLen = items.reduce((s, c) => s + normalize(c.text).length, 0) / items.length;
  if (avgLen < T.shortLen) return "짧은 반응(ㅋㅋ, 감탄사 등)";
  if (items.filter((c) => TIMESTAMP_RE.test(c.text)).length / items.length >= 0.6 && avgLen < 40) return "영상의 특정 시점을 가리키는 타임스탬프 댓글";
  if (items.reduce((s, c) => s + genericShare(c.text), 0) / items.length >= 0.7) return "흔한 인사·응원 표현";
  if (ctx.docText && shared.some((p) => p.replace(/ /g, "").length >= 6 && ctx.docText.includes(p))) return "영상 제목·설명에 있는 문구를 인용";
  if (ctx.eventLikely && avgLen < 40) return "채널에서 댓글 참여를 요청한 영상 (참여 댓글일 수 있음)";
  return null;
}

/**
 * @param {number[][]} groups  문구 유사 묶음 (댓글 인덱스)
 * @param {object[]} comments  공통 스키마 Comment[]
 * @param {{a,b,sim}[]} edges
 * @param {{weights?, doc?, sim?}} opts  sim(i, j): 두 댓글의 문구 유사도. 있으면 '평균 유사도'를 묶음 안 모든 쌍으로 잰다(권장).
 *   없으면 이어진 쌍(edges)만으로 잰다 — 사슬처럼 이어진 묶음(A~B~C…, 끝끼리는 다름)을 '거의 같은 문구'로 부풀린다.
 * @returns 묶음별 { state: "scored"|"natural"|"hold", score|null, parts[], notes[], reasons[] … }
 */
export function clusterSignals(groups, comments, edges, { weights = DEFAULT_WEIGHTS, doc = null, sim = null } = {}) {
  const W = weights.cluster, T = weights.thresholds;
  const times = comments.map((c) => (c.createdAtApprox ? Date.parse(c.createdAtApprox) : NaN));
  const timed = times.filter((t) => !isNaN(t)).sort((a, b) => a - b);
  const ctx = {
    docText: doc ? normalizeForEmbed(`${doc.title} ${doc.text}`) : "",
    eventLikely: !!doc && (EVENT_RE.test(doc.text || "") || comments.some((c) => c.meta?.isCreator && EVENT_RE.test(c.text))),
  };

  const cid = new Map();
  groups.forEach((g, ci) => g.forEach((i) => cid.set(i, ci)));
  const simSum = new Float64Array(groups.length), simCnt = new Uint32Array(groups.length);
  for (const { a, b, sim } of edges) {
    const ca = cid.get(a);
    if (ca !== undefined && ca === cid.get(b)) { simSum[ca] += sim; simCnt[ca]++; }
  }

  const out = groups.map((g, ci) => {
    const items = g.map((i) => comments[i]);
    const size = g.length;
    const authors = new Set(items.map((c) => c.authorId || c.author)).size;
    const avgLen = items.reduce((s, c) => s + normalize(c.text).length, 0) / size;
    const meanSim = sim ? pairMean(g, sim) : simCnt[ci] ? simSum[ci] / simCnt[ci] : 0;
    const likes = items.reduce((s, c) => s + (c.likes || 0), 0);
    const shared = sharedPhrases(items.map((c) => c.text));
    const base = { cluster: ci, size, authors, meanSim, avgLen, likes, shared, sample: items[0].text, indices: g, parts: [], notes: [] };

    const natural = naturalRepetition(items, shared, ctx, T);
    if (natural) return { ...base, state: "natural", score: null, notes: [`자연스러운 반복으로 보여 점수를 내지 않음: ${natural}`] };
    // 이웃끼리만 닮고 묶음 전체로는 다른 문구(짧은 응원·인사가 사슬처럼 이어진 것)는 '같은 문구를 여럿이 씀'이 아니다
    if (sim && meanSim < T.similar) return { ...base, state: "natural", score: null, notes: [`서로 다른 문구가 이웃끼리만 닮아 이어진 묶음이라 점수를 내지 않음 (묶음 전체 평균 유사도 ${meanSim.toFixed(2)})`] };
    if (size < T.minSize) return { ...base, state: "hold", score: null, notes: [`댓글이 ${size}개뿐이라 판단 보류 (${T.minSize}개부터 평가)`] };

    const parts = [], notes = [];
    if (meanSim >= T.nearIdentical) parts.push({ label: `문구가 거의 같음 (평균 유사도 ${meanSim.toFixed(2)})`, points: W.nearIdentical });
    else if (meanSim >= T.similar) parts.push({ label: `표현이 비슷함 (평균 유사도 ${meanSim.toFixed(2)})`, points: W.similar });
    if (authors >= 2) parts.push({ label: `서로 다른 작성자 ${authors}명`, points: Math.min(W.authorsMax, authors * W.perAuthor) });
    if (authors < size) parts.push({ label: `같은 작성자가 반복 작성 (${size - authors}건)`, points: W.sameAuthorRepeat });

    // 시간 몰림: 분·시간 단위 시각이 충분할 때만, 영상 전체의 댓글 밀도와 비교해서 평가
    const fine = items.filter((c) => FINE_TIME_RE.test(c.createdAtRaw || "")).length / size;
    const ts = g.map((i) => times[i]).filter((t) => !isNaN(t));
    if (fine >= T.fineTimeShare && ts.length === size && timed.length) {
      const lo = Math.min(...ts), hi = Math.max(...ts);
      const inWindow = timed.filter((t) => t >= lo && t <= hi).length / timed.length;
      if (inWindow <= T.burstShare) parts.push({ label: `영상 전체 댓글의 ${Math.max(1, Math.round(inWindow * 100))}%만 달린 짧은 시간대에 모두 작성`, points: W.timeBurst });
    } else {
      notes.push("작성 시각이 '며칠 전' 수준으로만 표시돼 시간 몰림은 평가하지 않음");
    }
    if (avgLen >= T.longLen) parts.push({ label: "긴 문장인데도 겹침", points: W.longText });
    if (shared.length) notes.push(`공통 표현: ${shared.map((p) => `“${p}”`).join(", ")}`);

    const score = Math.min(100, parts.reduce((s, p) => s + p.points, 0));
    return { ...base, state: "scored", score, parts, notes };
  });

  const order = { scored: 0, natural: 1, hold: 2 };
  for (const s of out) s.reasons = [...s.parts.map((p) => `${p.label} +${p.points}`), ...s.notes];
  return out.sort((a, b) => order[a.state] - order[b.state] || (b.score ?? 0) - (a.score ?? 0) || b.size - a.size);
}
