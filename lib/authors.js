// 작성자 단위 분석 (KAIST 논문 4장의 작성자 특징을 '한 영상 안에서 볼 수 있는 행동'으로 옮김).
// 어조·주장·대상은 특징에도 점수에도 넣지 않는다. 팔로우 관계는 YouTube에 없어 답글 주고받기로 대신한다.
import { normalize } from "./analyze.js";
import { DEFAULT_WEIGHTS } from "./weights.js";
import { topKNeighbors, edgesFromNeighbors, pca2 } from "./vec.js";

const FINE_TIME_RE = /초|분|시간|second|minute|hour/i;
const AUTO_HANDLE_RE = /^@?user-[a-z0-9]{6,}$/i;
const quantile = (xs, q) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };

/**
 * @param {object[]} comments
 * @param {Int32Array|number[]} lexIds  댓글별 문구 묶음 번호(-1 = 없음)
 * @param {number[][]} lexGroups        문구 묶음 → 댓글 인덱스
 */
export function authorFeatures(comments, lexIds, lexGroups) {
  const keyOf = (c) => c.authorId || c.author;
  const by = new Map();
  comments.forEach((c, i) => {
    const k = keyOf(c);
    if (!by.has(k)) by.set(k, { key: k, author: c.author, authorId: c.authorId, indices: [] });
    by.get(k).indices.push(i);
  });
  // 다른 작성자와 겹치는 문구 묶음인지
  const multiAuthor = lexGroups.map((g) => new Set(g.map((i) => keyOf(comments[i]))).size >= 2);
  // 답글 주고받기: 원댓글 작성자 ↔ 답글 작성자
  const indexById = new Map(comments.map((c, i) => [c.id, i]));
  const repliedTo = new Map(); // key → Set(상대 key)
  const received = new Map();
  for (const c of comments) {
    const pi = c.parentId ? indexById.get(c.parentId) : undefined;
    if (pi === undefined) continue;
    const from = keyOf(c), to = keyOf(comments[pi]);
    if (from === to) continue;
    if (!repliedTo.has(from)) repliedTo.set(from, new Set());
    repliedTo.get(from).add(to);
    received.set(to, (received.get(to) || 0) + 1);
  }

  return [...by.values()].map((a) => {
    const items = a.indices.map((i) => comments[i]);
    const count = items.length;
    // 자기 복제 비율: 논문 정의 1 − (고유 댓글 수 ÷ 댓글 수). 아주 짧은 댓글(10자 미만)은 제외
    const eligible = items.map((c) => normalize(c.text)).filter((t) => t.length >= 10);
    const selfDup = eligible.length >= 2 ? 1 - new Set(eligible).size / eligible.length : 0;
    const crossMatch = a.indices.filter((i) => lexIds[i] >= 0 && multiAuthor[lexIds[i]]).length / count;
    const fine = items.filter((c) => FINE_TIME_RE.test(c.createdAtRaw || ""));
    const ts = fine.map((c) => Date.parse(c.createdAtApprox)).filter((t) => !isNaN(t));
    const mine = repliedTo.get(a.key) || new Set();
    const mutual = [...mine].filter((o) => repliedTo.get(o)?.has(a.key)).length;
    return {
      ...a,
      count,
      selfDup,
      crossMatch,
      avgLen: items.reduce((s, c) => s + c.text.length, 0) / count,
      avgLikes: items.reduce((s, c) => s + (c.likes || 0), 0) / count,
      replyShare: items.filter((c) => c.parentId).length / count,
      repliesReceived: received.get(a.key) || 0,
      mutual,
      spanHours: fine.length === count && ts.length > 1 ? (Math.max(...ts) - Math.min(...ts)) / 3600e3 : null,
      autoHandle: AUTO_HANDLE_RE.test(a.author || ""), // 참고 표시만. 점수에는 쓰지 않는다 (기본 핸들을 쓰는 일반 사용자가 많음)
    };
  });
}

/** 작성자별 의심 신호: 행동만으로 계산, 항목별 분해, 댓글이 적으면 판단 보류 */
export function authorSignals(features, { weights = DEFAULT_WEIGHTS } = {}) {
  const W = weights.author, T = weights.thresholds;
  const p95Count = quantile(features.map((f) => f.count), 0.95);
  const p75Likes = quantile(features.map((f) => f.avgLikes), 0.75);
  return features.map((f) => {
    if (f.count < T.minAuthorComments) return { ...f, state: "hold", score: null, parts: [], notes: [`댓글이 ${f.count}개뿐이라 판단 보류 (${T.minAuthorComments}개부터 평가)`] };
    const parts = [], notes = [];
    if (f.selfDup > 0) parts.push({ label: `자기 댓글을 되풀이한 비율 ${Math.round(f.selfDup * 100)}%`, points: Math.round(W.selfDup * f.selfDup) });
    if (f.crossMatch > 0) parts.push({ label: `다른 사람과 문구가 겹치는 댓글 ${Math.round(f.crossMatch * 100)}%`, points: Math.round(W.crossMatch * f.crossMatch) });
    if (f.count >= 5 && f.count >= p95Count) parts.push({ label: `이 영상 작성자 중 상위 5% 다작 (${f.count}개)`, points: W.volume });
    if (parts.length && f.avgLikes > 0 && f.avgLikes >= p75Likes) parts.push({ label: "평균 좋아요가 상위 25% (공감을 많이 받는 쪽)", points: -W.likesDiscount });
    if (f.mutual) notes.push(`서로 답글을 주고받은 상대 ${f.mutual}명`);
    if (f.spanHours !== null) notes.push(f.spanHours < 1 ? "1시간 안에 모두 작성" : `${Math.round(f.spanHours)}시간에 걸쳐 작성`);
    if (f.autoHandle) notes.push("자동 생성된 기본 핸들 (참고용, 점수에 반영 안 함)");
    const score = Math.max(0, Math.min(100, parts.reduce((s, p) => s + p.points, 0)));
    return { ...f, state: "scored", score, parts, notes };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.count - a.count);
}

/** 작성자 지도: 행동 특징을 표준화한 벡터로 비슷한 작성자끼리 잇는다 (댓글 2개 이상인 작성자만) */
export function authorMap(features, { maxNodes = 1500 } = {}) {
  const list = features.filter((f) => f.count >= 2).sort((a, b) => b.count - a.count).slice(0, maxNodes);
  if (list.length < 3) return { list, edges: [], init: list.map((_, i) => [Math.cos(i), Math.sin(i)]) };
  const raw = list.map((f) => [f.selfDup, f.crossMatch, Math.log1p(f.count), Math.log1p(f.avgLen), Math.log1p(f.avgLikes), f.replyShare, Math.log1p(f.repliesReceived), Math.log1p(f.mutual)]);
  const d = raw[0].length;
  const mean = new Array(d).fill(0), sd = new Array(d).fill(0);
  for (const r of raw) r.forEach((x, k) => (mean[k] += x / raw.length));
  for (const r of raw) r.forEach((x, k) => (sd[k] += (x - mean[k]) ** 2 / raw.length));
  const vecs = raw.map((r) => {
    const v = Float32Array.from(r, (x, k) => (sd[k] > 1e-9 ? (x - mean[k]) / Math.sqrt(sd[k]) : 0));
    let n = 0;
    for (const x of v) n += x * x;
    n = Math.sqrt(n) || 1;
    return v.map((x) => x / n);
  });
  const nbrs = topKNeighbors(vecs, 5);
  return { list, edges: edgesFromNeighbors(nbrs, 0.9), init: pca2(vecs) };
}
