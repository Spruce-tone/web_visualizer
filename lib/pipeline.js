// 패널 분석 계산 한곳: 댓글 → 문구 이웃 → (의미 임베딩) → 의미 이웃 → 지도 첫 배치 → 패턴·평가 표현 → 첫 주제 나누기.
// Web Worker(lib/analysis-worker.js)와 Worker를 못 쓸 때의 대체 경로(패널 메인 스레드)가 이 함수를 그대로 부른다.
// 그래서 같은 입력이면 어디서 돌든 결과(주제·키워드·점수·배치)가 같다. 화면(DOM)은 건드리지 않는다.
import { hashEmbed } from "./embed/hash.js";
import { dot, pca2, centerVectors, neighborsFast } from "./vec.js";
import { kmeans, isShortReaction } from "./cluster.js";
import { fuzzyGraph, umapLayout, toPixels } from "./umap.js";
import { louvain, snnGraph } from "./community.js";
import { topicPartition, resolutionOf } from "./topics.js";
import { paraphraseGroups, coActiveAuthors } from "./patterns.js";
import { toneSummary } from "./tone.js";
import { topicKeywords } from "./keywords.js";

const now = () => (globalThis.performance ? performance.now() : Date.now());
const num = (n) => Number(n).toLocaleString();

/** 세밀도 단추: [이름, 슬라이더 값] */
export const PRESETS = [["크게", 20], ["보통", 50], ["잘게", 75], ["아주 잘게", 100]];
/** 처음 그릴 때의 세밀도 */
export const FIRST_RES = 50;

/** 세밀도 단추마다 대략의 주제 수(3개 이상 묶음) */
export function presetCounts(n, graphEdges) {
  return PRESETS.map(([label, v]) => [label, v,
    louvain(n + 1, graphEdges, { resolution: resolutionOf(v), minSize: Math.max(3, Math.round(n / 200)) }).sizes.filter((x) => x >= 3).length]);
}

/** 평가 표현 탭의 낱말(비난·칭찬 표현 댓글에 많은 낱말) */
export function toneWords(rows, texts) {
  const words = (label) => {
    const idx = rows.find((r) => r.label === label).indices;
    if (idx.length < 5) return "댓글이 적어 보여주지 않아요.";
    return topicKeywords([idx], texts, { k: 10 })[0].join(", ") || "뚜렷한 낱말이 없어요.";
  };
  return { condemn: words("condemn"), praise: words("praise") };
}

/** 세밀도 v의 주제 나누기 (lib/topics.js). Worker에서도 같은 함수를 쓴다 */
export function topicsAt({ n, graphEdges, short, texts }, v) {
  return topicPartition({ n, graphEdges, short, texts, resolution: resolutionOf(v) });
}

/**
 * @param {{doc:object, comments:object[], useSemantic:boolean}} input
 * @param {{embed?: (texts:string[], onStatus) => Promise<{vecs:Float32Array[], where:string, modelName:string}>,
 *          onStatus?: (msg:string) => void, pause?: () => Promise<void>}} env
 *   embed: 의미 임베딩(없으면 문구 기준). pause: 긴 계산 중 양보(메인 스레드에서만 필요)
 */
export async function analyzeComments({ doc, comments, useSemantic }, { embed = null, onStatus = () => {}, pause = () => new Promise((r) => setTimeout(r, 0)) } = {}) {
  const notes = [];
  const n = comments.length;
  const docText = `${doc.title}\n${doc.text}`.slice(0, 1500);
  const t0 = now();

  // 1) 문구 비교 (복붙 의심용) — 댓글이 많으면 구역을 나눠 찾고, 중간중간 화면에 양보한다
  onStatus(`문구 비교 중 (${num(n)}개)`);
  await pause();
  const lexVecs = hashEmbed([docText, ...comments.map((c) => c.text)]).slice(1);
  const lexNbrs = await neighborsFast(lexVecs, 8, { partition: kmeans, pause, onProgress: (p) => onStatus(`문구 비교 중 ${Math.round(p * 100)}%`) });
  const t1 = now();

  // 2) 뜻 분석 — "lol", "ㅋㅋ" 같은 짧은 반응은 뜻으로 묶을 수 없어 따로 모으고, 모델에도 넣지 않는다(시간 절약)
  const short = comments.map((c) => isShortReaction(c.text));
  const idx = [];
  short.forEach((sh, i) => { if (!sh) idx.push(i); });
  const subTexts = [docText, ...idx.map((i) => comments[i].text)];
  let semAll = null, modelName = null, where = null;
  if (useSemantic && embed && idx.length) {
    try {
      const r = await embed(subTexts, onStatus);
      semAll = centerVectors(r.vecs); // 공통 성분을 빼서 댓글 사이 차이를 벌린다
      where = r.where; modelName = r.modelName;
    } catch (e) {
      console.warn("[WV] semantic failed", e);
      notes.push(`의미 모델을 쓰지 못해 문구 기준으로 묶었어요 (${e.message})`);
    }
  }
  const t2 = now();

  onStatus("지도 그리는 중");
  await pause();
  // 3) 연속 지도: 이웃 그래프 → UMAP 배치 (본문도 점 하나로 함께 놓는다). 주제 묶기도 같은 그래프를 쓴다.
  const all = semAll || hashEmbed(subTexts); // [본문, 짧은 반응을 뺀 댓글…]
  const nb = await neighborsFast(all, 15, { partition: kmeans, pause });
  const fg = fuzzyGraph(nb); // 첫 배치(UMAP)용
  const snn = snnGraph(nb);  // 주제 묶기·지도 선용 (PhenoGraph 방식 공유 이웃 가중치)
  const { x: ux, y: uy } = umapLayout(all.length, fg, pca2(all));
  toPixels(ux, uy);
  const nodeOf = (local) => (local === 0 ? 0 : idx[local - 1] + 1); // 지도 점 번호: 0 = 본문, i+1 = 댓글 i
  const X = new Array(n + 1).fill(0), Y = new Array(n + 1).fill(0);
  let maxY = -Infinity, sumX = 0;
  for (let l = 0; l < all.length; l++) { X[nodeOf(l)] = ux[l]; Y[nodeOf(l)] = uy[l]; maxY = Math.max(maxY, uy[l]); sumX += ux[l] / all.length; }
  // 짧은 반응은 뜻으로 놓을 수 없어 지도 아래에 따로 모아 둔다 (좋아요 많은 순으로 가운데부터)
  const shortIdx = [];
  short.forEach((sh, i) => { if (sh) shortIdx.push(i); });
  shortIdx.sort((p, q) => (comments[q].likes || 0) - (comments[p].likes || 0) || p - q);
  const sr = 8 * Math.sqrt(shortIdx.length) + 10;
  shortIdx.forEach((i, t) => {
    const rad = sr * Math.sqrt((t + 0.5) / shortIdx.length), ang = t * 2.399963;
    X[i + 1] = sumX + rad * Math.cos(ang); Y[i + 1] = (isFinite(maxY) ? maxY : 0) + sr + 60 + rad * Math.sin(ang);
  });
  const graphEdges = snn.map((e) => ({ a: nodeOf(e.a), b: nodeOf(e.b), w: e.w }));
  const semNbrs = comments.map(() => []);
  for (let l = 1; l < all.length; l++) semNbrs[idx[l - 1]] = nb[l].filter((q) => q.j !== 0).map(({ j, sim }) => ({ j: idx[j - 1], sim }));
  const para = semAll
    ? paraphraseGroups(semNbrs, (i, j) => dot(lexVecs[i], lexVecs[j]), comments)
    : { groups: [], note: "의미 모델로 분석했을 때만 볼 수 있어요." };
  const co = coActiveAuthors(comments);
  const tone = toneSummary(comments);
  const t3 = now();

  // 4) 화면을 처음 그릴 때 바로 필요한 계산: 세밀도 단추의 주제 수, 첫 세밀도의 주제, 평가 표현 낱말
  const texts = comments.map((c) => c.text);
  const firstTopics = topicsAt({ n, graphEdges, short, texts }, FIRST_RES);
  return {
    lexVecs, lexNbrs, semNbrs, x: X, y: Y, graphEdges, idx, short, semantic: !!semAll, modelName, where,
    para, co, tone: { tones: tone.tones, rows: tone.rows, topN: tone.topN, words: toneWords(tone.rows, texts) },
    presets: presetCounts(n, graphEdges),
    firstTopics, notes, times: { lex: t1 - t0, sem: t2 - t1, map: t3 - t2 },
  };
}

/** 문구 벡터를 Float32Array 하나로 편다 (Worker → 패널로 복사 없이 넘기기) */
export function flattenVectors(vecs) {
  const dim = vecs.length ? vecs[0].length : 0;
  const flat = new Float32Array(vecs.length * dim);
  vecs.forEach((v, i) => flat.set(v, i * dim));
  return { flat, dim, n: vecs.length };
}
/** flattenVectors의 반대. 복사하지 않고 같은 버퍼를 나눠 본다 */
export function viewVectors({ flat, dim, n }) {
  return Array.from({ length: n }, (_, i) => flat.subarray(i * dim, (i + 1) * dim));
}
