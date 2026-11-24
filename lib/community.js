// 주제 묶기: 이웃 그래프 위의 커뮤니티 탐지 (Louvain; Blondel, Guillaume, Lambiotte, Lefebvre 2008).
// 임베딩 → 이웃 그래프 → 커뮤니티 → UMAP 지도는 PhenoGraph(Levine 외 2015)·Scanpy에서 쓰는 표준 조합이다.
// k-평균과 달리 묶음 수를 미리 정하지 않고, 서로 촘촘히 이어진 댓글끼리 묶인다. 세밀도(resolution)로 크게/잘게 조절한다.
// 점을 도는 순서가 고정돼 있어 같은 입력이면 같은 결과.

function oneLevel(adj, selfW, resolution) {
  const n = adj.length;
  const deg = new Float64Array(n);
  let m2 = 0;
  for (let i = 0; i < n; i++) { let d = 2 * selfW[i]; for (const w of adj[i].values()) d += w; deg[i] = d; m2 += d; }
  const comm = Int32Array.from({ length: n }, (_, i) => i);
  const tot = Float64Array.from(deg);
  if (m2 === 0) return { comm, improved: false };
  let improved = false;
  for (let pass = 0; pass < 30; pass++) {
    let moves = 0;
    for (let i = 0; i < n; i++) {
      const ci = comm[i];
      const wTo = new Map();
      for (const [j, w] of adj[i]) wTo.set(comm[j], (wTo.get(comm[j]) || 0) + w);
      tot[ci] -= deg[i];
      let best = ci, bestGain = (wTo.get(ci) || 0) - (resolution * tot[ci] * deg[i]) / m2;
      for (const [c, w] of wTo) {
        const gain = w - (resolution * tot[c] * deg[i]) / m2;
        if (gain > bestGain + 1e-12 || (Math.abs(gain - bestGain) <= 1e-12 && c < best)) { best = c; bestGain = gain; }
      }
      tot[best] += deg[i];
      if (best !== ci) { comm[i] = best; moves++; }
    }
    if (!moves) break;
    improved = true;
  }
  return { comm, improved };
}

/**
 * @param {number} n
 * @param {{a,b,w}[]} edges 무방향 가중 간선
 * @returns {{ids: Int32Array, sizes: number[]}} 큰 묶음부터 0,1,2… (어디에도 못 붙은 점은 -1)
 */
export function louvain(n, edges, { resolution = 1, minSize = 3 } = {}) {
  let adj = Array.from({ length: n }, () => new Map());
  let selfW = new Float64Array(n);
  for (const { a, b, w } of edges) {
    if (a === b) continue;
    adj[a].set(b, (adj[a].get(b) || 0) + w);
    adj[b].set(a, (adj[b].get(a) || 0) + w);
  }
  let assign = Int32Array.from({ length: n }, (_, i) => i);
  for (let level = 0; level < 12; level++) {
    const { comm, improved } = oneLevel(adj, selfW, resolution);
    if (!improved) break;
    const remap = new Map();
    for (const c of comm) if (!remap.has(c)) remap.set(c, remap.size);
    const k = remap.size;
    const nAdj = Array.from({ length: k }, () => new Map());
    const nSelf = new Float64Array(k);
    for (let i = 0; i < adj.length; i++) {
      const ci = remap.get(comm[i]);
      nSelf[ci] += selfW[i];
      for (const [j, w] of adj[i]) {
        if (j < i) continue;
        const cj = remap.get(comm[j]);
        if (ci === cj) nSelf[ci] += w;
        else { nAdj[ci].set(cj, (nAdj[ci].get(cj) || 0) + w); nAdj[cj].set(ci, (nAdj[cj].get(ci) || 0) + w); }
      }
    }
    for (let i = 0; i < n; i++) assign[i] = remap.get(comm[assign[i]]);
    adj = nAdj; selfW = nSelf;
    if (k === 1) break;
  }
  // 너무 작은 묶음은 가장 강하게 이어진 이웃 묶음에 합친다
  const size = new Map();
  for (const c of assign) size.set(c, (size.get(c) || 0) + 1);
  const small = new Set([...size].filter(([, s]) => s < minSize).map(([c]) => c));
  if (small.size && small.size < size.size) {
    const link = new Map(); // 작은 묶음 → Map(큰 묶음 → 연결 강도)
    for (const { a, b, w } of edges) {
      const ca = assign[a], cb = assign[b];
      if (ca === cb) continue;
      for (const [s, t] of [[ca, cb], [cb, ca]]) {
        if (!small.has(s) || small.has(t)) continue;
        if (!link.has(s)) link.set(s, new Map());
        link.get(s).set(t, (link.get(s).get(t) || 0) + w);
      }
    }
    const target = new Map();
    for (const s of small) {
      let best = -1, bw = 0;
      for (const [t, w] of link.get(s) || []) if (w > bw) { bw = w; best = t; }
      target.set(s, best);
    }
    for (let i = 0; i < n; i++) if (small.has(assign[i])) assign[i] = target.get(assign[i]);
  }
  const cnt = new Map();
  for (const c of assign) if (c >= 0) cnt.set(c, (cnt.get(c) || 0) + 1);
  const order = [...cnt].sort((p, q) => q[1] - p[1] || p[0] - q[0]);
  const rank = new Map(order.map(([c], r) => [c, r]));
  return { ids: assign.map((c) => (c >= 0 ? rank.get(c) : -1)), sizes: order.map(([, s]) => s) };
}

/**
 * 공유 이웃(SNN) 그래프 — PhenoGraph(Levine 외, 2015)의 가중치.
 * 두 댓글이 서로의 이웃 목록에 함께 있을 때, 이웃 목록이 얼마나 겹치는지(Jaccard)를 연결 강도로 쓴다.
 * 유사도 값 자체보다 "같은 동네에 사는가"를 보므로, 모델마다 유사도 분포가 달라도 묶음이 안정적이다.
 * @param {{j:number}[][]} nbrs
 * @returns {{a,b,w}[]}
 */
export function snnGraph(nbrs) {
  const n = nbrs.length;
  const sets = nbrs.map((l, i) => new Set([i, ...l.map((x) => x.j)]));
  const edges = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    for (const { j } of nbrs[i]) {
      const key = i < j ? i * n + j : j * n + i;
      if (seen.has(key)) continue;
      seen.add(key);
      const A = sets[i], B = sets[j];
      let inter = 0;
      for (const x of A) if (B.has(x)) inter++;
      const w = inter / (A.size + B.size - inter);
      if (w > 0) edges.push({ a: Math.min(i, j), b: Math.max(i, j), w });
    }
  }
  return edges;
}

// ---- 겹침 분류: 댓글 하나가 여러 주제에 걸칠 때 ----
// 주 주제(Louvain 결과)는 그대로 두고, 보조 주제만 덧붙인다. 지도 위치·색·키워드는 주 주제 기준.
// 판단 재료는 SNN 이웃 그래프의 연결 강도뿐이다 (어조·주장·대상, 평가 표현 사전을 쓰지 않는다. 의심 점수에도 넣지 않는다).
/** 이웃 연결 강도 중 다른 주제 몫이 이 비율 이상이면 그 주제에도 넣는다. 30%: 이웃 셋 중 하나 꼴이면 '그쪽 이야기도 한다'고 본다. */
export const OVERLAP_MIN_SHARE = 0.3;
/** 다른 주제 쪽 연결이 자기 주 주제 쪽의 이 비율 이상이면(거의 같은 힘으로 끌리면) 비율이 낮아도 넣는다. */
export const OVERLAP_NEAR_TIE = 0.85;
/** 우연히 이웃 하나만 걸친 경우를 거르기 위해, 그 주제 쪽 이웃이 이 수 이상이어야 한다. */
export const OVERLAP_MIN_NEIGHBORS = 2;
/** 보조 주제 최대 개수 (주 주제 포함 최대 3개). */
export const OVERLAP_MAX_EXTRA = 2;

/**
 * @param {ArrayLike<number>} ids 점마다 주 주제 번호 (-1 = 주제 없음: 본문, 짧은 반응 등은 계산에서 뺀다)
 * @param {{a:number,b:number,w:number}[]} edges 이웃 그래프 (snnGraph 결과, 점 번호 기준)
 * @returns {{ extra: number[][], members: Map<number, number[]> }}
 *   extra[i] = 점 i의 보조 주제들(강한 순), members = 주제 → [주 주제 점들..., 보조로 들어온 점들...]
 */
export function overlapTopics(ids, edges, {
  minShare = OVERLAP_MIN_SHARE, nearTie = OVERLAP_NEAR_TIE, minNeighbors = OVERLAP_MIN_NEIGHBORS, maxExtra = OVERLAP_MAX_EXTRA,
} = {}) {
  const n = ids.length;
  const pull = Array.from({ length: n }, () => new Map()); // 점 → 주제 → { w, k }
  const add = (i, c, w) => { const m = pull[i]; const v = m.get(c) || { w: 0, k: 0 }; v.w += w; v.k++; m.set(c, v); };
  for (const { a, b, w } of edges) {
    if (!(w > 0) || ids[a] < 0 || ids[b] < 0) continue;
    add(a, ids[b], w);
    add(b, ids[a], w);
  }
  const extra = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    const own = ids[i];
    if (own < 0) continue;
    let total = 0;
    for (const v of pull[i].values()) total += v.w;
    if (!total) continue;
    const ownW = pull[i].get(own)?.w || 0;
    const cands = [];
    for (const [c, v] of pull[i]) {
      if (c === own || v.k < minNeighbors) continue;
      if (v.w / total >= minShare || (ownW > 0 && v.w >= nearTie * ownW)) cands.push([c, v.w]);
    }
    cands.sort((p, q) => q[1] - p[1] || p[0] - q[0]);
    extra[i] = cands.slice(0, maxExtra).map(([c]) => c);
  }
  const members = new Map();
  for (let i = 0; i < n; i++) if (ids[i] >= 0) { if (!members.has(ids[i])) members.set(ids[i], []); members.get(ids[i]).push(i); }
  for (let i = 0; i < n; i++) for (const c of extra[i]) { if (!members.has(c)) members.set(c, []); members.get(c).push(i); }
  return { extra, members };
}

// ---- 같은 이야기인데 둘로 갈린 주제 합치기 ----
// 판단 재료: 키워드(낱말 빈도로 뽑은 것, 어조·주장·대상 사전은 쓰지 않음)와 SNN 이웃 그래프의 연결뿐이다.
/**
 * 첫 키워드만 같을 때 합치려면, 두 주제 사이 연결(관측 / 무작위 기대)이 '세밀도 × 이 값' 이상이어야 한다.
 * Louvain은 연결 비율이 세밀도보다 크면 두 묶음을 하나로 둔다. 따라서 0.5 = "세밀도를 절반으로 낮추면(대략 '크게'
 * 한 단계) 하나로 묶일 만큼 이어져 있다". 같은 낱말로 불리고 그만큼 이어진 두 묶음은 사용자에게 같은 주제로 보인다.
 */
export const MERGE_LINK_FACTOR = 0.5;

/**
 * 주제 쌍마다 연결 비율(관측 / 기대)을 잰다.
 * 주제 없는 점(-1: 본문, 짧은 반응)에 닿는 간선은 뺀다. Louvain은 그 점들까지 포함한 그래프에서 나눴으므로,
 * 이 비율은 Louvain이 두 묶음을 합치는 문턱(비율 > 세밀도)의 근사치다.
 * @param {ArrayLike<number>} ids 점마다 주제 번호 (-1 = 주제 없음)
 * @param {{a:number,b:number,w:number}[]} edges
 * @returns {(p:number, q:number) => number}
 */
export function topicLinkRatio(ids, edges) {
  const vol = new Map(), between = new Map();
  let m2 = 0;
  for (const { a, b, w } of edges) {
    const p = ids[a], q = ids[b];
    if (!(w > 0) || p < 0 || q < 0) continue;
    vol.set(p, (vol.get(p) || 0) + w);
    vol.set(q, (vol.get(q) || 0) + w);
    m2 += 2 * w;
    if (p !== q) { const k = p < q ? `${p},${q}` : `${q},${p}`; between.set(k, (between.get(k) || 0) + w); }
  }
  return (p, q) => {
    const vp = vol.get(p) || 0, vq = vol.get(q) || 0;
    if (!vp || !vq) return 0;
    const obs = between.get(p < q ? `${p},${q}` : `${q},${p}`) || 0;
    return (obs * m2) / (vp * vq);
  };
}

/**
 * 키워드가 같은 주제를 합친다.
 * - 앞 두 키워드가 같으면 합친다 (이전 규칙 그대로).
 * - 첫 키워드만 같으면, 두 주제 사이 이웃 연결이 충분할 때(topicLinkRatio >= resolution × MERGE_LINK_FACTOR)만 합친다.
 *   앞 두 키워드 판정을 모든 주제에 먼저 끝낸 뒤 본다 (그래서 첫 키워드로 합친 묶음도 두 키워드 짝을 놓치지 않는다).
 * 합친 뒤 키워드를 다시 뽑아 더 합칠 것이 없을 때까지(최대 rounds번) 되풀이한다. 번호는 큰 쪽(먼저 나온 쪽)으로 모은다.
 * @param {ArrayLike<number>} ids 점마다 주제 번호 (-1 = 주제 없음)
 * @param {{a:number,b:number,w:number}[]} edges
 * @param {(ids: Int32Array) => string[][]} keywordsOf 주제 번호 → 키워드 목록
 * @param {{ resolution?: number, rounds?: number }} [opt] resolution: 주제를 나눌 때 쓴 Louvain 세밀도
 * @returns {{ ids: Int32Array, keywords: string[][], merges: { from:number, to:number, by:string, link:number }[] }}
 */
export function mergeSameKeywordTopics(ids, edges, keywordsOf, { resolution = 1, rounds = 4 } = {}) {
  const minLink = resolution * MERGE_LINK_FACTOR;
  const cur = Int32Array.from(ids);
  let kws = keywordsOf(cur);
  const merges = [];
  for (let round = 0; round < rounds; round++) {
    const size = new Map();
    for (const c of cur) if (c >= 0) size.set(c, (size.get(c) || 0) + 1);
    const parent = new Map();
    const find = (c) => { while (parent.has(c)) c = parent.get(c); return c; };
    // 큰 주제부터 본다 → 작은 쪽이 큰 쪽으로 들어간다
    const order = [...size.keys()].sort((p, q) => size.get(q) - size.get(p) || p - q);
    const relabel = () => Int32Array.from(cur, (c) => (c >= 0 ? find(c) : c));
    // 1) 앞 두 키워드가 같은 주제를 모두 먼저 합친다 (연결과 무관)
    const linkBefore = topicLinkRatio(cur, edges);
    const byTwo = new Map();
    for (const c of order) {
      const k = kws[c] || [];
      if (k.length < 2) continue;
      const two = k.slice(0, 2).sort().join("|");
      if (byTwo.has(two)) { const to = byTwo.get(two); parent.set(c, to); merges.push({ from: c, to, by: "keywords2", link: linkBefore(c, to) }); }
      else byTwo.set(two, c);
    }
    // 2) 첫 키워드만 같은 주제는, 두 쪽(1에서 합친 묶음이면 그 구성 주제들) 중 한 쌍이라도 충분히 이어져 있으면 합친다.
    //    연결은 이번 판 처음의 주제끼리 잰다 — 합친 묶음 전체로 재면 큰 쪽에 묻혀 비율이 낮아진다.
    const parts = new Map();
    for (const c of order) { const root = find(c); if (!parts.has(root)) parts.set(root, []); parts.get(root).push(c); }
    const bestLink = (p, q) => { let best = 0; for (const a of parts.get(p)) for (const b of parts.get(q)) best = Math.max(best, linkBefore(a, b)); return best; };
    const byOne = new Map();
    for (const c of order) {
      if (parent.has(c)) continue;
      const one = (kws[c] || [])[0];
      if (!one) continue;
      const t = (byOne.get(one) || []).find((t2) => bestLink(c, t2) >= minLink);
      if (t !== undefined) { parent.set(c, t); merges.push({ from: c, to: t, by: "keyword1", link: bestLink(c, t) }); continue; }
      if (!byOne.has(one)) byOne.set(one, []);
      byOne.get(one).push(c);
    }
    if (!parent.size) break;
    cur.set(relabel());
    kws = keywordsOf(cur);
  }
  return { ids: cur, keywords: kws, merges };
}
