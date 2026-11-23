// 벡터 연산: 정규화된 벡터 기준 (내적 = 코사인 유사도)

export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * 각 벡터의 상위 k 이웃. O(n²·d)이지만 n≈1000, d≈256 에서 1초 미만.
 * @returns {{j:number, sim:number}[][]}
 */
export function topKNeighbors(vecs, k = 8) {
  const n = vecs.length;
  const nbrs = Array.from({ length: n }, () => []);
  const push = (list, j, sim) => {
    if (list.length < k) {
      list.push({ j, sim });
      list.sort((a, b) => b.sim - a.sim);
    } else if (sim > list[k - 1].sim) {
      list[k - 1] = { j, sim };
      list.sort((a, b) => b.sim - a.sim);
    }
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = dot(vecs[i], vecs[j]);
      push(nbrs[i], j, s);
      push(nbrs[j], i, s);
    }
  }
  return nbrs;
}

/** 임계값 이상 이웃으로 무방향 간선 목록 (중복 제거) */
export function edgesFromNeighbors(nbrs, threshold) {
  const edges = [];
  const seen = new Set();
  nbrs.forEach((list, i) => {
    for (const { j, sim } of list) {
      if (sim < threshold) break;
      const key = i < j ? i * 1e6 + j : j * 1e6 + i;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a: Math.min(i, j), b: Math.max(i, j), sim });
    }
  });
  return edges;
}

/** union-find 연결 성분 → cluster id 배열 (크기 내림차순으로 0,1,2… / 단독 노드는 -1) */
export function clustersFromEdges(n, edges) {
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (const { a, b } of edges) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  }
  const sorted = [...groups.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length);
  const ids = new Int32Array(n).fill(-1);
  sorted.forEach((g, ci) => g.forEach((i) => (ids[i] = ci)));
  return { ids, groups: sorted };
}

/** 상위 2개 주성분으로 2D 투영 (power iteration, 공분산 행렬을 만들지 않음) */
export function pca2(vecs, iters = 40) {
  const n = vecs.length;
  if (!n) return [];
  const d = vecs[0].length;
  const mean = new Float32Array(d);
  for (const v of vecs) for (let i = 0; i < d; i++) mean[i] += v[i] / n;
  const X = vecs.map((v) => v.map((x, i) => x - mean[i]));

  const comps = [];
  for (let c = 0; c < 2; c++) {
    let w = Float32Array.from({ length: d }, (_, i) => Math.sin(i * 12.9898 + c * 78.233)); // 결정적 초기값
    for (let t = 0; t < iters; t++) {
      const next = new Float32Array(d);
      for (const x of X) {
        const p = dot(x, w);
        for (let i = 0; i < d; i++) next[i] += p * x[i];
      }
      for (const prev of comps) {
        const p = dot(next, prev);
        for (let i = 0; i < d; i++) next[i] -= p * prev[i];
      }
      const norm = Math.sqrt(dot(next, next)) || 1;
      w = next.map((x) => x / norm);
    }
    comps.push(w);
  }
  return X.map((x) => [dot(x, comps[0]), dot(x, comps[1])]);
}
