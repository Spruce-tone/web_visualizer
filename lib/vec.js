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

/**
 * 큰 입력용 이웃 찾기: 화면이 멈추지 않게 중간중간 양보하고, 댓글이 많으면 구역을 나눠 가까운 구역 안에서만 찾는다.
 * n ≤ exactLimit 이면 topKNeighbors 와 같은 결과(정확). 그보다 크면 근사(아주 가까운 이웃은 거의 놓치지 않는다).
 * @param {(vecs, k) => {ids, centroids}} partition  구역 나누기 함수 (lib/cluster.js 의 kmeans)
 */
export async function neighborsFast(vecs, k = 8, { exactLimit = 1500, partition = null, onProgress = null, pause = () => new Promise((r) => setTimeout(r, 0)) } = {}) {
  const n = vecs.length;
  if (n <= exactLimit || !partition) {
    if (n > 600) await pause();
    return topKNeighbors(vecs, k);
  }
  const parts = Math.max(2, Math.round(n / 300));
  const { ids, centroids } = partition(vecs, parts);
  const members = centroids.map(() => []);
  for (let i = 0; i < n; i++) members[ids[i]].push(i);
  // 구역마다 가까운 구역 2곳
  const near = centroids.map((c, a) => centroids.map((o, b) => [b, a === b ? 2 : dot(c, o)]).sort((x, y) => y[1] - x[1]).slice(0, 3).map((x) => x[0]));
  const nbrs = Array.from({ length: n }, () => []);
  let last = performance.now();
  for (let i = 0; i < n; i++) {
    const list = nbrs[i], v = vecs[i];
    for (const p of near[ids[i]]) {
      for (const j of members[p]) {
        if (j === i) continue;
        const s = dot(v, vecs[j]);
        if (list.length < k) { list.push({ j, sim: s }); if (list.length === k) list.sort((a, b) => b.sim - a.sim); }
        else if (s > list[k - 1].sim) { let q = k - 1; while (q > 0 && list[q - 1].sim < s) { list[q] = list[q - 1]; q--; } list[q] = { j, sim: s }; }
      }
    }
    if (list.length < k) list.sort((a, b) => b.sim - a.sim);
    if (performance.now() - last > 40) { onProgress?.(i / n); await pause(); last = performance.now(); }
  }
  return nbrs;
}

/** 벡터 묶음을 문자열 하나로 (크게 보기 탭으로 넘겨줄 때) */
export function packVectors(vecs) {
  if (!vecs.length) return { n: 0, dim: 0, b64: "" };
  const dim = vecs[0].length;
  const flat = new Float32Array(vecs.length * dim);
  vecs.forEach((v, i) => flat.set(v, i * dim));
  const bytes = new Uint8Array(flat.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { n: vecs.length, dim, b64: btoa(bin) };
}
export function unpackVectors({ n, dim, b64 }) {
  if (!n) return [];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const flat = new Float32Array(bytes.buffer);
  return Array.from({ length: n }, (_, i) => flat.slice(i * dim, (i + 1) * dim));
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

/**
 * 모델마다 유사도 분포가 달라 고정 임계값이 안 맞는다.
 * 각 노드의 r번째 이웃 유사도의 중앙값을 기본 임계값으로 쓴다 → 노드당 평균 간선 수가 대략 r개 근처.
 */
export function adaptiveThreshold(nbrs, r = 2) {
  const xs = nbrs.map((l) => l[Math.min(r, l.length) - 1]?.sim).filter((x) => x !== undefined).sort((a, b) => a - b);
  if (!xs.length) return 0.5;
  return Math.round(xs[Math.floor(xs.length / 2)] * 100) / 100;
}

/**
 * 주제 묶음 기준 추천값: 각 노드의 2번째 이웃 유사도 분포의 분위수.
 * 값이 낮을수록 넓게(큰 묶음 몇 개), 높을수록 세밀하게(작은 묶음 여럿) 묶인다.
 */
export function thresholdPresets(nbrs) {
  const xs = nbrs.map((l) => l[Math.min(2, l.length) - 1]?.sim).filter((x) => x !== undefined).sort((a, b) => a - b);
  const q = (p) => (xs.length ? Math.round(xs[Math.min(xs.length - 1, Math.floor(xs.length * p))] * 100) / 100 : 0.5);
  return [
    { label: "넓게", value: q(0.3) },
    { label: "보통", value: q(0.5) },
    { label: "세밀하게", value: q(0.75) },
    { label: "아주 세밀하게", value: q(0.9) },
  ];
}

/**
 * 원하는 주제 수에 가장 가까운 기준값을 찾는다 (캐시된 이웃만 사용).
 * 한 묶음이 전체의 절반을 넘는 "덩어리" 상태는 가능하면 피한다.
 */
export function thresholdForTopicCount(nbrs, target, { minSize = 3 } = {}) {
  const n = nbrs.length;
  let best = null;
  for (let t = 0.99; t >= 0.1; t -= 0.01) {
    const th = Math.round(t * 100) / 100;
    const { groups } = clustersFromEdges(n, edgesFromNeighbors(nbrs, th));
    const count = groups.filter((g) => g.length >= minSize).length;
    const giant = groups.length ? groups[0].length > n * 0.5 : false;
    const cost = Math.abs(count - target) + (giant ? 1000 : 0);
    if (!best || cost < best.cost || (cost === best.cost && th < best.th)) best = { th, count, cost };
  }
  return best ? { threshold: best.th, count: best.count } : { threshold: 0.5, count: 0 };
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

/**
 * 평균 벡터를 빼고 다시 정규화한다.
 * 의미 임베딩은 모든 문장이 한쪽으로 쏠려 있어(유사도가 다 높게 나옴) 차이가 잘 안 보인다.
 * 공통 성분을 빼면 댓글 사이의 차이가 벌어져 묶음이 더 또렷해진다.
 */
export function centerVectors(vecs) {
  if (vecs.length < 3) return vecs;
  const d = vecs[0].length;
  const mean = new Float32Array(d);
  for (const v of vecs) for (let i = 0; i < d; i++) mean[i] += v[i] / vecs.length;
  return vecs.map((v) => {
    const o = new Float32Array(d);
    let n = 0;
    for (let i = 0; i < d; i++) { o[i] = v[i] - mean[i]; n += o[i] * o[i]; }
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < d; i++) o[i] /= n;
    return o;
  });
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
