// 공개 데이터로 작성자 점수 가중치를 보정하는 순수 계산 (개발 단계용. 확장 프로그램에는 결과 JSON만 들어간다).
// 입력 행: { user, text, likes, label }  — label: 1 = 논문에서 의심 계정으로 분류, 0 = 그 외
// 특징은 lib/authors.js 와 같은 정의(자기 복제 비율, 다른 사람과 같은 문장 비율, 다작, 평균 좋아요)이고 어조·주장·대상은 쓰지 않는다.
import { normalize } from "./analyze.js";

const quantile = (xs, q) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };

export function aggregateUsers(rows, { minComments = 3 } = {}) {
  const users = new Map();
  const owners = new Map(); // 정규화한 문장 → 작성자 집합
  for (const r of rows) {
    if (!users.has(r.user)) users.set(r.user, { user: r.user, texts: [], likes: 0, label: 0 });
    const u = users.get(r.user);
    const t = normalize(String(r.text || ""));
    u.texts.push(t);
    u.likes += Number(r.likes) || 0;
    u.label = Math.max(u.label, Number(r.label) ? 1 : 0);
    if (t.length >= 10) { if (!owners.has(t)) owners.set(t, new Set()); owners.get(t).add(r.user); }
  }
  const list = [...users.values()].filter((u) => u.texts.length >= minComments);
  const p95 = quantile(list.map((u) => u.texts.length), 0.95);
  const p75 = quantile(list.map((u) => u.likes / u.texts.length), 0.75);
  return list.map((u) => {
    const eligible = u.texts.filter((t) => t.length >= 10);
    const avgLikes = u.likes / u.texts.length;
    return {
      user: u.user, label: u.label, count: u.texts.length,
      selfDup: eligible.length >= 2 ? 1 - new Set(eligible).size / eligible.length : 0,
      crossMatch: u.texts.filter((t) => t.length >= 10 && owners.get(t).size >= 2).length / u.texts.length,
      volume: u.texts.length >= 5 && u.texts.length >= p95 ? 1 : 0,
      highLikes: avgLikes > 0 && avgLikes >= p75 ? 1 : 0,
    };
  });
}

/** 로지스틱 회귀 (경사 하강, 결정적) */
export function fitLogistic(X, y, { iters = 2000, lr = 0.5 } = {}) {
  const d = X[0].length, n = X.length;
  const w = new Float64Array(d);
  let b = 0;
  for (let it = 0; it < iters; it++) {
    const gw = new Float64Array(d);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let k = 0; k < d; k++) z += w[k] * X[i][k];
      const e = 1 / (1 + Math.exp(-z)) - y[i];
      for (let k = 0; k < d; k++) gw[k] += e * X[i][k];
      gb += e;
    }
    for (let k = 0; k < d; k++) w[k] -= (lr * gw[k]) / n;
    b -= (lr * gb) / n;
  }
  return { w: Array.from(w), b };
}

function auc(scores, y) {
  const idx = scores.map((s, i) => [s, y[i]]).sort((a, b) => a[0] - b[0]);
  let rankSum = 0, pos = 0;
  idx.forEach(([, label], i) => { if (label) { rankSum += i + 1; pos++; } });
  const neg = y.length - pos;
  return pos && neg ? (rankSum - (pos * (pos + 1)) / 2) / (pos * neg) : NaN;
}

/**
 * @returns {{override, report}} override 는 calibration/weights.json 에 그대로 저장한다
 */
export function calibrateAuthorWeights(rows, { flag = 50, date = "unknown" } = {}) {
  const users = aggregateUsers(rows);
  const y = users.map((u) => u.label);
  if (users.length < 50 || !y.includes(1) || !y.includes(0)) throw new Error("보정하려면 의심/일반 작성자가 모두 포함된 50명 이상의 데이터가 필요합니다.");
  const X = users.map((u) => [u.selfDup, u.crossMatch, u.volume, u.highLikes]);
  const { w } = fitLogistic(X, y);
  const scale = 40 / Math.max(1e-9, ...w.slice(0, 3).map((x) => Math.max(0, x)));
  const pts = (x) => Math.max(0, Math.min(100, Math.round(x * scale)));
  const author = { selfDup: pts(w[0]), crossMatch: pts(w[1]), volume: pts(w[2]), likesDiscount: pts(-w[3]) };
  const score = (u) => Math.max(0, Math.min(100, Math.round(author.selfDup * u.selfDup) + Math.round(author.crossMatch * u.crossMatch) + author.volume * u.volume - author.likesDiscount * u.highLikes));
  const scores = users.map(score);
  const flagged = scores.map((s) => s >= flag);
  const tp = flagged.filter((f, i) => f && y[i]).length, fp = flagged.filter((f, i) => f && !y[i]).length;
  const pos = y.filter(Boolean).length, neg = y.length - pos;
  return {
    override: { version: `calibrated-${date}`, source: "공개 데이터 보정", author },
    report: {
      users: users.length, suspected: pos, coefficients: { selfDup: w[0], crossMatch: w[1], volume: w[2], highLikes: w[3] },
      auc: auc(scores, y), precision: tp + fp ? tp / (tp + fp) : null, recall: pos ? tp / pos : null, falseFlagRate: neg ? fp / neg : null,
      note: "묶음 점수(복붙 의심) 가중치는 묶음 단위 정답이 없어 보정하지 않고 기본 규칙을 그대로 씁니다.",
    },
  };
}
