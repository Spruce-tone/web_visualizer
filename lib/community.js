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
