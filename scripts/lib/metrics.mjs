// 검증 세트 지표 (scripts/evaluate.mjs). 외부 정답 없이 잴 수 있는 것만: 분리(실루엣), 섬(덩어리 수), 겹침의 근거, 키워드 근거.

const d2 = (x, y, i, j) => (x[i] - x[j]) ** 2 + (y[i] - y[j]) ** 2;

/** 실루엣 (dist(p,q) 함수, 점 목록, 점 → 주제). 주제가 2개 미만이면 null */
function silhouette(pts, lab, dist) {
  const K = Math.max(...pts.map((i) => lab[i])) + 1;
  if (new Set(pts.map((i) => lab[i])).size < 2) return null;
  let sil = 0;
  for (const i of pts) {
    const s = new Float64Array(K), c = new Float64Array(K);
    for (const j of pts) { if (j === i) continue; s[lab[j]] += dist(i, j); c[lab[j]]++; }
    const a = c[lab[i]] ? s[lab[i]] / c[lab[i]] : 0;
    let b = Infinity;
    for (let k = 0; k < K; k++) if (k !== lab[i] && c[k]) b = Math.min(b, s[k] / c[k]);
    sil += c[lab[i]] && isFinite(b) ? (b - a) / Math.max(a, b) : 0;
  }
  return sil / pts.length;
}
/** 2D 실루엣 (유클리드) */
export const sil2d = (x, y, pts, lab) => silhouette(pts, lab, (i, j) => Math.sqrt(d2(x, y, i, j)));
/** 고차원 실루엣 (코사인 거리). vecOf(점) → 정규화 벡터 */
export function silHigh(pts, lab, vecOf) {
  const V = new Map(pts.map((i) => [i, vecOf(i)]));
  return silhouette(pts, lab, (i, j) => { const a = V.get(i), b = V.get(j); let s = 0; for (let t = 0; t < a.length; t++) s += a[t] * b[t]; return 1 - s; });
}

/**
 * 섬 검사 (qa/2026-11-25 LAYOUT-PLAN과 같은 정의).
 * comps: 점 사이 거리 ≤ 3 × (가장 가까운 점까지 거리의 중앙값)을 이은 근접 그래프에서 10점 이상 덩어리 수.
 * gap: 주제마다 '다른 주제의 가장 가까운 점'까지 거리 ÷ 그 중앙값의 최댓값 (가장 떨어진 주제의 틈).
 */
export function islands(x, y, pts, lab) {
  const nn = pts.map((i) => { let b = Infinity; for (const j of pts) if (j !== i) b = Math.min(b, d2(x, y, i, j)); return Math.sqrt(b); }).sort((a, b) => a - b);
  const m = nn[Math.floor(nn.length / 2)] || 1;
  const R2 = (3 * m) ** 2;
  const par = new Map(pts.map((i) => [i, i]));
  const find = (i) => { while (par.get(i) !== i) { par.set(i, par.get(par.get(i))); i = par.get(i); } return i; };
  for (let p = 0; p < pts.length; p++) for (let q = p + 1; q < pts.length; q++) if (d2(x, y, pts[p], pts[q]) <= R2) par.set(find(pts[p]), find(pts[q]));
  const sz = new Map();
  for (const i of pts) { const r = find(i); sz.set(r, (sz.get(r) || 0) + 1); }
  const comps = [...sz.values()].filter((s) => s >= 10).length;
  let gap = 0;
  for (const t of new Set(pts.map((i) => lab[i]))) {
    const A = pts.filter((i) => lab[i] === t);
    if (A.length < 10) continue;
    let b = Infinity;
    for (const i of A) for (const j of pts) if (lab[j] !== t) b = Math.min(b, d2(x, y, i, j));
    gap = Math.max(gap, Math.sqrt(b) / m);
  }
  return { comps, gap };
}

export { hyperTail } from "../../lib/keywords.js";
