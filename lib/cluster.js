// 주제 묶기: 구면 k-평균 (코사인 유사도 기준).
// 이전 방식(가까운 이웃끼리 이어 붙이기)은 댓글이 많아지면 서로 다른 이야기가 줄줄이 이어져 한 덩어리가 됐다.
// k-평균은 묶음 수를 직접 정하고, 각 댓글을 가장 가까운 중심 하나에만 넣으므로 덩어리가 생기지 않는다.
// 무작위 요소는 고정된 씨앗으로만 쓴다 → 같은 입력이면 항상 같은 결과.
import { normalize } from "./analyze.js";

/** 뜻을 묶기 어려운 짧은 반응 ("ㅋㅋ", "lol", "yes", 이모지…) — 주제 묶기에서 빼고 따로 모은다 */
export function isShortReaction(text) {
  const n = normalize(text);
  if (n.length < 8) return true;
  return String(text).trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length < 2;
}

/** 댓글 수에 맞는 '보통' 묶음 수 */
export function suggestK(n) {
  return Math.max(2, Math.min(28, Math.round(Math.sqrt(n) / 2.2)));
}

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * @param {Float32Array[]} vecs  L2 정규화된 벡터
 * @returns {{ids: Int32Array, centroids: Float32Array[], sizes: number[]}} 묶음 번호는 큰 묶음부터 0,1,2…
 */
export function kmeans(vecs, k, { iters = 30, seed = 20261124 } = {}) {
  const n = vecs.length;
  if (!n) return { ids: new Int32Array(0), centroids: [], sizes: [] };
  k = Math.max(1, Math.min(k, n));
  const d = vecs[0].length;
  const rand = rng(seed);
  const dotv = (a, b) => { let s = 0; for (let i = 0; i < d; i++) s += a[i] * b[i]; return s; };

  // k-means++ 초기화 (거리 = 1 − 코사인)
  const cents = [Float32Array.from(vecs[Math.floor(rand() * n)])];
  const best = new Float32Array(n).fill(-2);
  while (cents.length < k) {
    const c = cents[cents.length - 1];
    let total = 0;
    for (let i = 0; i < n; i++) { const s = dotv(vecs[i], c); if (s > best[i]) best[i] = s; total += Math.max(0, 1 - best[i]) ** 2; }
    let r = rand() * total, pick = n - 1;
    for (let i = 0; i < n; i++) { r -= Math.max(0, 1 - best[i]) ** 2; if (r <= 0) { pick = i; break; } }
    cents.push(Float32Array.from(vecs[pick]));
  }

  const ids = new Int32Array(n).fill(-1);
  for (let it = 0; it < iters; it++) {
    let changed = 0;
    for (let i = 0; i < n; i++) {
      let bi = 0, bs = -2;
      for (let c = 0; c < k; c++) { const s = dotv(vecs[i], cents[c]); if (s > bs) { bs = s; bi = c; } }
      if (ids[i] !== bi) { ids[i] = bi; changed++; }
    }
    if (!changed) break;
    const sums = Array.from({ length: k }, () => new Float32Array(d));
    const cnt = new Int32Array(k);
    for (let i = 0; i < n; i++) { const s = sums[ids[i]], v = vecs[i]; for (let j = 0; j < d; j++) s[j] += v[j]; cnt[ids[i]]++; }
    for (let c = 0; c < k; c++) {
      if (!cnt[c]) { cents[c] = Float32Array.from(vecs[Math.floor(rand() * n)]); continue; } // 빈 묶음은 다시 뽑는다
      let norm = 0;
      for (let j = 0; j < d; j++) norm += sums[c][j] * sums[c][j];
      norm = Math.sqrt(norm) || 1;
      for (let j = 0; j < d; j++) sums[c][j] /= norm;
      cents[c] = sums[c];
    }
  }

  // 큰 묶음부터 번호를 다시 매긴다 (빈 묶음 제거)
  const cnt = new Int32Array(k);
  for (let i = 0; i < n; i++) cnt[ids[i]]++;
  const order = [...cnt.keys()].filter((c) => cnt[c] > 0).sort((a, b) => cnt[b] - cnt[a] || a - b);
  const remap = new Int32Array(k).fill(-1);
  order.forEach((c, r) => (remap[c] = r));
  return {
    ids: ids.map((c) => remap[c]),
    centroids: order.map((c) => cents[c]),
    sizes: order.map((c) => cnt[c]),
  };
}

/** 묶음마다 중심에 가장 가까운 댓글 (대표 댓글) */
export function representatives(vecs, ids, centroids) {
  const best = centroids.map(() => ({ i: -1, s: -2 }));
  for (let i = 0; i < vecs.length; i++) {
    const c = ids[i];
    if (c < 0) continue;
    let s = 0;
    const v = vecs[i], ce = centroids[c];
    for (let j = 0; j < v.length; j++) s += v[j] * ce[j];
    if (s > best[c].s) best[c] = { i, s };
  }
  return best.map((b) => b.i);
}
