// 추가 패턴. 모두 '의심 신호 + 근거'이고, 근거가 부족하면 결과를 내지 않거나 보류 사유를 돌려준다.
// 어조·주장·대상은 쓰지 않는다.
import { clustersFromEdges } from "./vec.js";
import { normalize } from "./analyze.js";

const FINE_TIME_RE = /초|분|시간|second|minute|hour/i;
const keyOf = (c) => c.authorId || c.author;

/**
 * 같은 주장, 다른 표현: 뜻은 매우 가깝고(의미 유사도 상위) 글자는 다르며(문구 유사도 낮음) 작성자가 여럿인 묶음.
 * @param {{j,sim}[][]} semNbrs  의미 임베딩 이웃
 * @param {(i,j)=>number} lexSim 문구 유사도
 */
export function paraphraseGroups(semNbrs, lexSim, comments, { lexMax = 0.45, minSize = 3, minAuthors = 3, minLen = 15 } = {}) {
  const firsts = semNbrs.map((l) => l[0]?.sim).filter((x) => x !== undefined).sort((a, b) => a - b);
  if (firsts.length < 20) return { groups: [], threshold: null, note: "댓글이 적어 판단 보류" };
  const th = firsts[Math.floor(firsts.length * 0.9)]; // 이 영상에서 가장 가까운 10% 수준
  const edges = [];
  const seen = new Set();
  semNbrs.forEach((list, i) => {
    for (const { j, sim } of list) {
      if (sim < th) break;
      const key = i < j ? i * 1e6 + j : j * 1e6 + i;
      if (seen.has(key)) continue;
      seen.add(key);
      if (normalize(comments[i].text).length < minLen || normalize(comments[j].text).length < minLen) continue;
      const ls = lexSim(i, j);
      if (ls < lexMax) edges.push({ a: Math.min(i, j), b: Math.max(i, j), sim, lex: ls });
    }
  });
  const { groups } = clustersFromEdges(semNbrs.length, edges);
  const out = [];
  groups.forEach((g, gi) => {
    const authors = new Set(g.map((i) => keyOf(comments[i]))).size;
    if (g.length < minSize || authors < minAuthors) return;
    const inside = edges.filter((e) => g.includes(e.a) && g.includes(e.b));
    const mean = (k) => inside.reduce((s, e) => s + e[k], 0) / (inside.length || 1);
    out.push({
      id: gi, indices: g, size: g.length, authors,
      semSim: mean("sim"), lexSim: mean("lex"),
      samples: g.slice(0, 3).map((i) => comments[i].text),
      reasons: [`뜻이 매우 가까움 (의미 유사도 ${mean("sim").toFixed(2)})`, `글자는 다름 (문구 유사도 ${mean("lex").toFixed(2)})`, `서로 다른 작성자 ${authors}명`],
    });
  });
  return { groups: out.sort((a, b) => b.size - a.size), threshold: th, note: null };
}

/**
 * 한 댓글에 비슷한 답글이 몰림: 수집된 답글 5개 이상·작성자 4명 이상인 스레드에서, 답글의 절반 이상이 같은 묶음(문구 또는 바꿔 쓰기)에 속함.
 * @param {(i)=>number} groupOf 댓글 인덱스 → 묶음 번호(-1 = 없음)
 */
export function pileOns(comments, groupOf, { minReplies = 5, minAuthors = 4, minShare = 0.5 } = {}) {
  const indexById = new Map(comments.map((c, i) => [c.id, i]));
  const threads = new Map();
  comments.forEach((c, i) => {
    const p = c.parentId ? indexById.get(c.parentId) : undefined;
    if (p === undefined) return;
    if (!threads.has(p)) threads.set(p, []);
    threads.get(p).push(i);
  });
  const out = [];
  for (const [parent, replies] of threads) {
    const authors = new Set(replies.map((i) => keyOf(comments[i]))).size;
    if (replies.length < minReplies || authors < minAuthors) continue;
    const counts = new Map();
    for (const i of replies) { const g = groupOf(i); if (g >= 0) counts.set(g, (counts.get(g) || 0) + 1); }
    let best = null;
    for (const [g, n] of counts) if (!best || n > best.n) best = { g, n };
    if (!best || best.n / replies.length < minShare) continue;
    const similar = replies.filter((i) => groupOf(i) === best.g);
    const simAuthors = new Set(similar.map((i) => keyOf(comments[i]))).size;
    if (simAuthors < 3) continue;
    out.push({
      parent, indices: [parent, ...similar], replies: replies.length, similar: similar.length, authors: simAuthors,
      sample: comments[similar[0]].text,
      reasons: [`답글 ${replies.length}개 중 ${similar.length}개가 서로 비슷한 내용`, `그 답글을 쓴 작성자 ${simAuthors}명`],
    });
  }
  return out.sort((a, b) => b.similar - a.similar);
}

/**
 * 같은 시간대에 함께 쓴 작성자: 분·시간 단위 시각이 있는 댓글만으로, 같은 1시간 구간에 3번 이상 함께 나타난 작성자 쌍을 묶는다.
 * 시각이 거친 댓글이 대부분이면 보류.
 */
export function coActiveAuthors(comments, { minShared = 3, minFineShare = 0.3 } = {}) {
  const fine = comments.map((c, i) => ({ c, i })).filter(({ c }) => FINE_TIME_RE.test(c.createdAtRaw || "") && c.createdAtApprox);
  if (!comments.length || fine.length / comments.length < minFineShare) {
    return { groups: [], note: "대부분의 댓글 시각이 '며칠 전' 수준이라 판단 보류 (올라온 지 하루 안 된 영상에서만 평가 가능)" };
  }
  const bins = new Map(); // 작성자 → Set(시간 구간)
  const idxOf = new Map();
  for (const { c, i } of fine) {
    const k = keyOf(c);
    const b = Math.floor(Date.parse(c.createdAtApprox) / 3600e3);
    if (!bins.has(k)) { bins.set(k, new Set()); idxOf.set(k, []); }
    bins.get(k).add(b);
    idxOf.get(k).push(i);
  }
  const keys = [...bins.keys()].filter((k) => bins.get(k).size >= minShared);
  const edges = [];
  for (let a = 0; a < keys.length; a++) for (let b = a + 1; b < keys.length; b++) {
    let shared = 0;
    for (const x of bins.get(keys[a])) if (bins.get(keys[b]).has(x)) shared++;
    if (shared >= minShared) edges.push({ a, b, sim: shared });
  }
  const { groups } = clustersFromEdges(keys.length, edges);
  return {
    note: null,
    groups: groups.map((g, gi) => ({
      id: gi, authors: g.length, names: g.map((k) => comments[idxOf.get(keys[k])[0]].author),
      indices: g.flatMap((k) => idxOf.get(keys[k])),
      reasons: [`작성자 ${g.length}명이 같은 1시간 구간에 ${minShared}번 이상 함께 댓글을 씀`],
    })),
  };
}

/** 패널을 연 동안 분석한 영상들 사이의 작성자 교차 (메모리에만 둔다. 저장하지 않는다) */
export class SessionMemory {
  constructor() { this.videos = new Map(); }
  add(doc, comments) {
    const authors = new Map();
    for (const c of comments) {
      const k = keyOf(c);
      if (!authors.has(k)) authors.set(k, { name: c.author, count: 0 });
      authors.get(k).count++;
    }
    this.videos.set(doc.meta.videoId, { title: doc.title, channel: doc.author, authors });
  }
  /** 2개 이상 영상에 나타난 작성자 */
  crossVideo() {
    const seen = new Map();
    for (const [vid, v] of this.videos) for (const [k, a] of v.authors) {
      if (!seen.has(k)) seen.set(k, { key: k, name: a.name, videos: [] });
      seen.get(k).videos.push({ videoId: vid, title: v.title, channel: v.channel, count: a.count });
    }
    const list = [...seen.values()].filter((a) => a.videos.length >= 2).map((a) => ({
      ...a,
      total: a.videos.reduce((s, v) => s + v.count, 0),
      sameChannel: new Set(a.videos.map((v) => v.channel)).size === 1, // 같은 채널의 단골 시청자일 수 있음
    }));
    return { videoCount: this.videos.size, authors: list.sort((a, b) => b.videos.length - a.videos.length || b.total - a.total) };
  }
}
