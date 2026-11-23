import { normalizeForEmbed } from "./embed/hash.js";

// 사이트 무관 분석 함수. 입력은 공통 스키마 Comment[].
// M1에서 유사도 클러스터, 시간 폭주 탐지 등이 여기 추가된다.

/** 근사 작성 시각을 시간순 구간으로 묶는다. 상대시간 단위가 거칠어 '구간 라벨' 기반으로 집계 */
export function timeHistogram(comments) {
  const pts = comments.map((c) => c.createdAtApprox && Date.parse(c.createdAtApprox)).filter(Boolean);
  if (!pts.length) return [];
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = max - min;
  const DAY = 86400e3;
  // 기간에 따라 구간 크기 결정
  const step = span <= 2 * DAY ? 3600e3 : span <= 60 * DAY ? DAY : 7 * DAY;
  const n = Math.max(1, Math.floor(span / step) + 1);
  const bins = Array.from({ length: Math.min(n, 120) }, (_, i) => ({ start: min + i * step, count: 0 }));
  for (const t of pts) {
    const i = Math.min(bins.length - 1, Math.floor((t - min) / step));
    bins[i].count++;
  }
  const fmt = step < DAY
    ? (t) => new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric" })
    : (t) => new Date(t).toLocaleDateString("ko-KR", { year: "2-digit", month: "numeric", day: "numeric" });
  return bins.map((b) => ({ ...b, label: fmt(b.start) }));
}

/**
 * 클러스터(유사 댓글 묶음)별 의심 신호. "판정"이 아니라 점수 + 근거만 낸다.
 * @param {number[][]} groups  clustersFromEdges().groups (댓글 인덱스 배열)
 * @param {object[]} comments  공통 스키마 Comment[] (groups 인덱스와 같은 순서)
 * @param {{a:number,b:number,sim:number}[]} edges
 */
export function clusterSignals(groups, comments, edges) {
  const times = comments.map((c) => (c.createdAtApprox ? Date.parse(c.createdAtApprox) : NaN));
  const valid = times.filter((t) => !isNaN(t));
  const overallSpan = valid.length ? Math.max(...valid) - Math.min(...valid) : 0;

  const cid = new Map();
  groups.forEach((g, ci) => g.forEach((i) => cid.set(i, ci)));
  const simSum = new Float64Array(groups.length), simCnt = new Uint32Array(groups.length);
  for (const { a, b, sim } of edges) {
    const ca = cid.get(a);
    if (ca !== undefined && ca === cid.get(b)) { simSum[ca] += sim; simCnt[ca]++; }
  }

  return groups.map((g, ci) => {
    const items = g.map((i) => comments[i]);
    const size = g.length;
    const authors = new Set(items.map((c) => c.authorId || c.author)).size;
    const avgLen = items.reduce((s, c) => s + normalize(c.text).length, 0) / size;
    const meanSim = simCnt[ci] ? simSum[ci] / simCnt[ci] : 0;
    const ts = g.map((i) => times[i]).filter((t) => !isNaN(t));
    const span = ts.length > 1 ? Math.max(...ts) - Math.min(...ts) : null;
    const likes = items.reduce((s, c) => s + (c.likes || 0), 0);

    const reasons = [];
    let score = 0;
    const shortReaction = avgLen < 6;
    if (shortReaction) {
      reasons.push("짧은 반응(ㅋㅋ·감탄사 등) — 자연스러운 현상일 가능성 높음");
    } else {
      if (meanSim >= 0.75) { score += 35; reasons.push(`문구가 거의 같음 (평균 유사도 ${meanSim.toFixed(2)})`); }
      else if (meanSim >= 0.6) { score += 15; reasons.push(`표현이 비슷함 (평균 유사도 ${meanSim.toFixed(2)})`); }
      if (authors >= 2) { score += Math.min(30, authors * 6); reasons.push(`서로 다른 작성자 ${authors}명`); }
      if (authors < size) { score += 10; reasons.push(`같은 작성자가 반복 작성 (${size - authors}건)`); }
      if (span !== null && overallSpan > 0 && size >= 3 && span <= overallSpan * 0.1) {
        score += 20; reasons.push("짧은 시간대에 몰려 작성됨 (상대시간 기반 근사)");
      }
      if (avgLen >= 30) { score += 5; reasons.push("긴 문장인데도 겹침"); }
      const shared = sharedPhrases(items.map((c) => c.text));
      if (shared.length) reasons.push(`공통 표현: ${shared.map((p) => `“${p}”`).join(", ")}`);
    }
    return { cluster: ci, size, authors, meanSim, avgLen, span, likes, score: Math.min(100, score), reasons, sample: items[0].text, indices: g };
  }).sort((a, b) => b.score - a.score || b.size - a.size);
}

/**
 * 주제 묶음(의미 유사도 기반) 요약: 크기, 작성자, 좋아요, 대표 댓글(묶음 안에서 가장 중심적인 댓글)
 */
export function topicSummaries(groups, comments, edges, docSims = null) {
  const strength = new Float64Array(comments.length);
  const cid = new Map();
  groups.forEach((g, ci) => g.forEach((i) => cid.set(i, ci)));
  for (const { a, b, sim } of edges) {
    if (cid.get(a) !== undefined && cid.get(a) === cid.get(b)) { strength[a] += sim; strength[b] += sim; }
  }
  return groups.map((g, ci) => {
    const rep = g.reduce((best, i) => (strength[i] > strength[best] ? i : best), g[0]);
    const items = g.map((i) => comments[i]);
    return {
      cluster: ci,
      size: g.length,
      authors: new Set(items.map((c) => c.authorId || c.author)).size,
      likes: items.reduce((s, c) => s + (c.likes || 0), 0),
      replies: items.filter((c) => c.parentId).length,
      docSim: docSims ? g.reduce((s, i) => s + docSims[i], 0) / g.length : null,
      sample: comments[rep].text,
      indices: g,
    };
  });
}

/**
 * 묶음 안 댓글들이 공통으로 쓰는 표현(연속 단어 1~8개). 설명 가능한 근거로 보여주기 위함.
 * @returns {string[]} 묶음의 60% 이상에 등장하는 표현, 긴 것 우선, 최대 k개
 */
export function sharedPhrases(texts, { minShare = 0.6, k = 3 } = {}) {
  if (texts.length < 2) return [];
  const df = new Map();
  for (const t of texts) {
    const w = normalizeForEmbed(t).split(" ").filter(Boolean);
    const seen = new Set();
    for (let n = Math.min(8, w.length); n >= 1; n--) {
      for (let i = 0; i + n <= w.length; i++) {
        const g = w.slice(i, i + n).join(" ");
        if (g.replace(/ /g, "").length < 2) continue;
        seen.add(g);
      }
    }
    for (const g of seen) df.set(g, (df.get(g) || 0) + 1);
  }
  const need = Math.max(2, Math.ceil(texts.length * minShare));
  const cands = [...df].filter(([, c]) => c >= need).sort((a, b) => b[0].length - a[0].length || b[1] - a[1]);
  const out = [];
  for (const [g] of cands) {
    if (out.some((o) => o.includes(g))) continue; // 이미 고른 긴 표현의 일부는 제외
    out.push(g);
    if (out.length >= k) break;
  }
  return out;
}

/**
 * 작성자별 활동량 (KAIST 연구의 '활동 빈도·기간' 행동 특징을 영상 단위로 축소 적용)
 * @returns 댓글 minCount개 이상 쓴 작성자, 많은 순
 */
export function authorActivity(comments, { minCount = 3, topicIds = null } = {}) {
  const by = new Map();
  comments.forEach((c, i) => {
    const key = c.authorId || c.author;
    if (!by.has(key)) by.set(key, { author: c.author, authorId: c.authorId, indices: [] });
    by.get(key).indices.push(i);
  });
  return [...by.values()]
    .filter((a) => a.indices.length >= minCount)
    .map((a) => {
      const ts = a.indices.map((i) => Date.parse(comments[i].createdAtApprox)).filter((t) => !isNaN(t));
      const topics = topicIds ? new Set(a.indices.map((i) => topicIds[i]).filter((t) => t >= 0)).size : null;
      return {
        ...a,
        count: a.indices.length,
        share: a.indices.length / comments.length,
        span: ts.length > 1 ? Math.max(...ts) - Math.min(...ts) : null,
        replies: a.indices.filter((i) => comments[i].parentId).length,
        topics,
        likes: a.indices.reduce((s, i) => s + (comments[i].likes || 0), 0),
      };
    })
    .sort((x, y) => y.count - x.count);
}

export function topByLikes(comments, k = 5) {
  return [...comments].sort((a, b) => b.likes - a.likes).slice(0, k);
}

/** 공백·문장부호·이모지 차이를 무시한 완전 일치 그룹 */
export function normalize(text) {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function exactDuplicates(comments, minCount = 2) {
  const groups = new Map();
  for (const c of comments) {
    const key = normalize(c.text);
    if (key.length < 4) continue; // "ㅋㅋ" 같은 짧은 반응은 제외
    if (!groups.has(key)) groups.set(key, { text: c.text, items: [] });
    groups.get(key).items.push(c);
  }
  return [...groups.values()]
    .filter((g) => g.items.length >= minCount)
    .map((g) => ({ text: g.text, count: g.items.length, authors: new Set(g.items.map((c) => c.authorId || c.author)).size }))
    .sort((a, b) => b.count - a.count);
}
