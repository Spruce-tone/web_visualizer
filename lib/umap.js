// 연속적인 2D 지도: UMAP (McInnes, Healy, Melville 2018)의 핵심 두 단계를 가볍게 구현.
//  1) 이웃 그래프를 '퍼지 그래프'로: 점마다 가장 가까운 이웃까지의 거리(rho)와 폭(sigma)으로 연결 강도를 정하고 대칭화
//  2) 확률적 경사 하강: 이어진 점은 당기고, 무작위로 고른 점은 밀어낸다
// 결과는 섬처럼 끊기지 않고 이어지되, 비슷한 댓글이 자연스럽게 뭉친다. 무작위는 고정 씨앗 → 같은 입력이면 같은 지도.

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * @param {{j:number, sim:number}[][]} nbrs  점별 이웃(유사도 내림차순, 코사인)
 * @returns {{a:number, b:number, w:number}[]} 무방향 간선 (a < b), 강도 0~1
 */
export function fuzzyGraph(nbrs) {
  const n = nbrs.length;
  const dir = new Map();
  for (let i = 0; i < n; i++) {
    const list = nbrs[i];
    if (!list.length) continue;
    const d = list.map((x) => Math.max(0, 1 - x.sim));
    const rho = Math.min(...d);
    const target = Math.log2(Math.max(2, list.length));
    let lo = 0, hi = Infinity, sigma = 1;
    for (let it = 0; it < 48; it++) {
      let s = 0;
      for (const x of d) s += Math.exp(-Math.max(0, x - rho) / sigma);
      if (Math.abs(s - target) < 1e-4) break;
      if (s > target) { hi = sigma; sigma = (lo + hi) / 2; }
      else { lo = sigma; sigma = hi === Infinity ? sigma * 2 : (lo + hi) / 2; }
    }
    list.forEach((x, q) => dir.set(i * n + x.j, Math.exp(-Math.max(0, d[q] - rho) / sigma)));
  }
  const edges = [];
  for (const [key, w] of dir) {
    const i = Math.floor(key / n), j = key % n;
    const back = dir.get(j * n + i);
    if (back !== undefined && j < i) continue; // 양방향이면 한 번만
    const ww = back !== undefined ? w + back - w * back : w;
    edges.push({ a: Math.min(i, j), b: Math.max(i, j), w: ww });
  }
  return edges;
}

/**
 * @param {number} n
 * @param {{a,b,w}[]} edges fuzzyGraph 결과
 * @param {number[][]} init 초기 좌표 (PCA)
 * @returns {{x: Float32Array, y: Float32Array}}
 */
export function umapLayout(n, edges, init, { epochs = null, a = 1.1, b = 1.05, negRate = 5, seed = 42 } = {}) {
  const x = new Float32Array(n), y = new Float32Array(n);
  let maxAbs = 1e-9;
  for (const [px, py] of init) maxAbs = Math.max(maxAbs, Math.abs(px), Math.abs(py));
  for (let i = 0; i < n; i++) { x[i] = (init[i][0] / maxAbs) * 10; y[i] = (init[i][1] / maxAbs) * 10; }
  if (!edges.length || n < 3) return { x, y };
  const E = epochs ?? (n <= 2000 ? 300 : 200);
  const rand = rng(seed);
  const maxW = edges.reduce((m, e) => Math.max(m, e.w), 0);
  const eps = edges.map((e) => maxW / Math.max(e.w, 1e-6));
  const next = Float64Array.from(eps), nextNeg = Float64Array.from(eps, (v) => v / negRate);
  const clip = (v) => (v > 4 ? 4 : v < -4 ? -4 : v);
  for (let ep = 1; ep <= E; ep++) {
    const lr = 1 - (ep - 1) / E;
    for (let e = 0; e < edges.length; e++) {
      if (next[e] > ep) continue;
      const i = edges[e].a, j = edges[e].b;
      let dx = x[i] - x[j], dy = y[i] - y[j];
      let d2 = dx * dx + dy * dy;
      if (d2 > 0) {
        const g = (-2 * a * b * Math.pow(d2, b - 1)) / (a * Math.pow(d2, b) + 1);
        const gx = clip(g * dx) * lr, gy = clip(g * dy) * lr;
        x[i] += gx; y[i] += gy; x[j] -= gx; y[j] -= gy;
      }
      next[e] += eps[e];
      const nNeg = Math.floor((ep - nextNeg[e]) / (eps[e] / negRate));
      for (let p = 0; p < nNeg; p++) {
        const k = Math.floor(rand() * n);
        if (k === i) continue;
        dx = x[i] - x[k]; dy = y[i] - y[k];
        d2 = dx * dx + dy * dy;
        if (d2 > 0) {
          const g = (2 * b) / ((0.001 + d2) * (a * Math.pow(d2, b) + 1));
          x[i] += clip(g * dx) * lr; y[i] += clip(g * dy) * lr;
        } else { x[i] += 4 * lr; }
      }
      nextNeg[e] += nNeg * (eps[e] / negRate);
    }
  }
  return { x, y };
}

/**
 * 화면용으로 다듬기: 전체 크기를 점 개수에 맞추고(대략 26·√n px), 겹친 점은 밀어내 서로 보이게 한다.
 * 큰 구조(어느 무리가 어디에 있는지)는 그대로 둔다.
 */
export function toPixels(x, y, { extentPerSqrtN = 26, minDist = 7, passes = 40 } = {}) {
  const n = x.length;
  if (n < 2) return;
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += x[i] / n; cy += y[i] / n; }
  // 멀리 튄 점 때문에 전체가 쪼그라들지 않게 98번째 백분위 거리로 배율을 정한다
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) { x[i] -= cx; y[i] -= cy; dist[i] = Math.hypot(x[i], y[i]); }
  const sorted = Float32Array.from(dist).sort();
  const ref = sorted[Math.min(n - 1, Math.floor(n * 0.98))] || 1;
  const R = (extentPerSqrtN * Math.sqrt(n)) / 2;
  const s = R / ref;
  for (let i = 0; i < n; i++) {
    x[i] *= s; y[i] *= s;
    const d = dist[i] * s;
    if (d > R * 1.25) { const f = (R * 1.25) / d; x[i] *= f; y[i] *= f; } // 아주 멀리 튄 점은 가장자리로 당겨 온다
  }
  for (let p = 0; p < passes; p++) {
    const g = new Map();
    for (let i = 0; i < n; i++) {
      const k = Math.floor(x[i] / minDist) * 73856093 ^ Math.floor(y[i] / minDist) * 19349663;
      let c = g.get(k);
      if (!c) g.set(k, (c = []));
      c.push(i);
    }
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const gx = Math.floor(x[i] / minDist), gy = Math.floor(y[i] / minDist);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const c = g.get((gx + ox) * 73856093 ^ (gy + oy) * 19349663);
        if (!c) continue;
        for (const j of c) {
          if (j <= i) continue;
          let dx = x[j] - x[i], dy = y[j] - y[i];
          let d = Math.hypot(dx, dy);
          if (d >= minDist) continue;
          if (d < 1e-6) { dx = Math.cos(i * 2.4 + j); dy = Math.sin(i * 2.4 + j); d = 1; }
          const push = (minDist - d) / 2;
          x[i] -= (dx / d) * push; y[i] -= (dy / d) * push;
          x[j] += (dx / d) * push; y[j] += (dy / d) * push;
          moved++;
        }
      }
    }
    if (!moved) break;
  }
}
