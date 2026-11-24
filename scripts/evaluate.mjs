// 검증 세트로 치우침·모델·기준을 점검한다 (객관성 기준 9).
//   npm run evaluate                     → 복붙 의심 치우침 점검 + 모델 비교(gemma, bekko)
//   npm run evaluate -- --bias           → 치우침 점검만 (모델 없이, 빠름)
//   npm run evaluate -- --models bekko   → 고른 모델만
//   npm run evaluate -- --json [파일]    → 영상별 숫자를 파일로 (기본 fixtures/set/evaluate.json, 키워드 낱말이 들어가므로 커밋 금지)
// 자료: fixtures/set/<분류>__<영상ID>.json (실제 댓글이라 저장소에 넣지 않음, .gitignore) 또는 fixtures/<분류>__<이름>.json
//   목록·수집법은 fixtures/README.md, fixtures/validation-set.json
// 통과 조건(치우침): (1) 오락 분류(music, game, daily)의 복붙 의심 비율 ≤ 5%  (2) politics-a 와 politics-b 의 의심 비율 차이 ≤ 5%p
// 모델 비교는 통과/실패가 아니라 숫자를 보여 준다(기본값을 정하는 근거). 임베딩은 Node(CPU)에서 패널과 같은 모델·설정으로 계산하고
// fixtures/set/emb/ 에 캐시한다. 처리 시간(GPU/CPU)은 브라우저에서 따로 잰다(qa 보고서).
import fs from "node:fs";
import path from "node:path";
import { hashEmbed } from "../lib/embed/hash.js";
import { dot, topKNeighbors, edgesFromNeighbors, clustersFromEdges, centerVectors, neighborsFast, pca2 } from "../lib/vec.js";
import { clusterSignals } from "../lib/signals.js";
import { DEFAULT_WEIGHTS } from "../lib/weights.js";
import { kmeans, isShortReaction } from "../lib/cluster.js";
import { fuzzyGraph, umapLayout, toPixels } from "../lib/umap.js";
import { snnGraph, overlapTopics } from "../lib/community.js";
import { topicPartition } from "../lib/topics.js";
import { keywordDocs, zScore } from "../lib/keywords.js";
import { createLayout, thinEdges } from "../lib/layout.js";
import { sil2d, silHigh, islands, hyperTail } from "./lib/metrics.mjs";

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true; };
const BIAS_ONLY = !!opt("bias", false);
const MODELS = String(opt("models", "gemma,bekko")).split(",");
// --json: 영상별 숫자 + 키워드·주제 이름(댓글에 쓰인 낱말)이 들어가므로 기본은 gitignore된 fixtures/set/ 아래
let JSON_OUT = opt("json", null);
if (JSON_OUT === true) JSON_OUT = "fixtures/set/evaluate.json";
const ONLY = opt("only", null); // 파일 이름 일부로 거르기

// ---------- 자료 ----------
const files = [];
for (const dir of ["fixtures/set", "fixtures"]) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".json") && f.includes("__")) files.push(path.join(dir, f));
}
const sets = files.filter((f) => !ONLY || f.includes(ONLY)).map((f) => ({ file: f, name: path.basename(f, ".json"), ...JSON.parse(fs.readFileSync(f, "utf8")) })).filter((s) => s.comments?.length);
if (!sets.length) { console.log("검증용 파일이 없습니다. fixtures/README.md 를 참고해 영상을 모아 주세요."); process.exit(0); }
const catOf = (s) => s.name.split("__")[0];
const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
const f3 = (x) => (x == null ? "—" : x.toFixed(3));

// ---------- 1. 복붙 의심 치우침 (예전 그대로) ----------
const byCat = new Map();
for (const s of sets) {
  const { doc, comments } = s;
  const nb = topKNeighbors(hashEmbed(comments.map((c) => c.text)), 8);
  const ed = edgesFromNeighbors(nb, 0.6);
  const cl = clustersFromEdges(comments.length, ed);
  const lexV = hashEmbed(comments.map((c) => c.text));
  const sig = clusterSignals(cl.groups, comments, ed, { doc, sim: (i, j) => dot(lexV[i], lexV[j]) });
  const flagged = sig.filter((x) => x.state === "scored" && x.score >= DEFAULT_WEIGHTS.thresholds.flag).reduce((n, x) => n + x.size, 0);
  const row = { name: s.name, comments: comments.length, flaggedShare: flagged / comments.length, natural: sig.filter((x) => x.state === "natural").length, hold: sig.filter((x) => x.state === "hold").length };
  s.bias = row;
  if (!byCat.has(catOf(s))) byCat.set(catOf(s), []);
  byCat.get(catOf(s)).push(row);
  console.log(`${s.name}: 댓글 ${row.comments}, 의심 비율 ${pct(row.flaggedShare)}, 자연 반복 ${row.natural}묶음, 보류 ${row.hold}묶음`);
}
const mean = (cat) => { const r = byCat.get(cat); return r ? r.reduce((a, x) => a + x.flaggedShare, 0) / r.length : null; };
let ok = true;
console.log("\n분류별 평균 의심 비율");
for (const cat of byCat.keys()) console.log(`  ${cat}: ${pct(mean(cat))} (영상 ${byCat.get(cat).length}개)`);
for (const cat of ["music", "game", "daily"]) {
  const m = mean(cat);
  if (m !== null && m > 0.05) { ok = false; console.log(`✗ ${cat}: 오락 영상의 의심 비율이 5%를 넘습니다 (${pct(m)})`); }
}
const pa = mean("politics-a"), pb = mean("politics-b");
if (pa !== null && pb !== null && Math.abs(pa - pb) > 0.05) { ok = false; console.log(`✗ politics-a 와 politics-b 의 차이가 5%p를 넘습니다 (${pct(pa)} vs ${pct(pb)})`); }
console.log(ok ? "✓ 치우침 점검 통과" : "✗ 치우침: 기준을 다시 살펴봐야 합니다");
if (BIAS_ONLY) process.exit(ok ? 0 : 1);

// ---------- 2. 의미 임베딩 (Node, 패널과 같은 모델·설정) ----------
const { MODELS: CFG, planBatches } = await import("../lib/embed/semantic.js");
const loaded = new Map();
async function embedder(key) {
  if (loaded.has(key)) return loaded.get(key);
  const { AutoTokenizer, AutoModel, pipeline } = await import("@huggingface/transformers");
  const cfg = CFG[key], dtype = cfg.dtype.wasm;
  let run;
  if (cfg.pooling === "sentence_embedding") {
    const tok = await AutoTokenizer.from_pretrained(cfg.id);
    const model = await AutoModel.from_pretrained(cfg.id, { dtype });
    run = async (t) => (await model(await tok(t, { padding: true, truncation: true, max_length: 192 }))).sentence_embedding.tolist();
  } else {
    const ex = await pipeline("feature-extraction", cfg.id, { dtype });
    run = async (t) => (await ex(t, { pooling: cfg.pooling, normalize: true })).tolist();
  }
  loaded.set(key, run);
  return run;
}
/** semantic.js semanticEmbed 와 같은 처리: 길이 자르기, 접두어, 중복 제거, 길이순 배치, 앞 dims만(MRL) 정규화 */
async function embed(key, texts, cacheFile) {
  const cfg = CFG[key];
  if (fs.existsSync(cacheFile)) {
    const b = fs.readFileSync(cacheFile);
    const f = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
    if (f.length === texts.length * cfg.dims) return { vecs: texts.map((_, i) => f.slice(i * cfg.dims, (i + 1) * cfg.dims)), ms: null };
  }
  const run = await embedder(key);
  const { unique, order, map } = planBatches(texts.map((t) => String(t).slice(0, cfg.maxChars)));
  const out = new Array(unique.length);
  const B = cfg.batch.wasm, t0 = performance.now();
  for (let i = 0; i < order.length; i += B) {
    const idx = order.slice(i, i + B);
    (await run(idx.map((j) => cfg.format(unique[j])))).forEach((full, k) => {
      const v = Float32Array.from(full.slice(0, cfg.dims));
      let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
      for (let d = 0; d < v.length; d++) v[d] /= n;
      out[idx[k]] = v;
    });
  }
  const vecs = map.map((u) => out[u]);
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  const buf = new Float32Array(vecs.length * cfg.dims);
  vecs.forEach((v, i) => buf.set(v, i * cfg.dims));
  fs.writeFileSync(cacheFile, Buffer.from(buf.buffer));
  return { vecs, ms: performance.now() - t0 };
}

// ---------- 3. 패널과 같은 주제·지도 계산 + 지표 ----------
const PROFANITY = /씨발|시발|ㅅㅂ|씨바|새끼|새기|색기|병신|븅신|ㅂㅅ|좆|존나|졸라|개같|개새|지랄|ㅈㄹ|미친놈|미친년|썅|fuck|shit|bitch/i; // 일반 욕설만 (대상별 멸칭은 넣지 않는다)
const OV_GRID = [
  { name: "지금 30%/85%/2", minShare: 0.3, nearTie: 0.85, minNeighbors: 2 },
  { name: "35%/90%/2", minShare: 0.35, nearTie: 0.9, minNeighbors: 2 },
  { name: "40%/100%/2", minShare: 0.4, nearTie: 1.0, minNeighbors: 2 },
  { name: "30%/85%/3", minShare: 0.3, nearTie: 0.85, minNeighbors: 3 },
  { name: "25%/80%/2", minShare: 0.25, nearTie: 0.8, minNeighbors: 2 },
];

async function analyze(s, key) {
  const { doc, comments } = s;
  const n = comments.length;
  const texts = comments.map((c) => c.text);
  const short = texts.map(isShortReaction);
  const idx = []; short.forEach((sh, i) => { if (!sh) idx.push(i); });
  const docText = `${doc.title}\n${doc.text}`.slice(0, 1500);
  const subTexts = [docText, ...idx.map((i) => texts[i])];
  const cache = path.join("fixtures/set/emb", key, `${s.name}.f32`);
  const { vecs, ms } = await embed(key, subTexts, cache);
  const all = centerVectors(vecs);
  // sidepanel.js run(): 이웃 15 → 퍼지 그래프(UMAP) + SNN(주제·선)
  const nb = await neighborsFast(all, 15, { partition: kmeans, pause: async () => {} });
  const snn = snnGraph(nb);
  const { x: ux, y: uy } = umapLayout(all.length, fuzzyGraph(nb), pca2(all));
  toPixels(ux, uy);
  const nodeOf = (l) => (l === 0 ? 0 : idx[l - 1] + 1);
  const X = new Array(n + 1).fill(0), Y = new Array(n + 1).fill(0);
  let maxY = -Infinity, sumX = 0;
  for (let l = 0; l < all.length; l++) { X[nodeOf(l)] = ux[l]; Y[nodeOf(l)] = uy[l]; maxY = Math.max(maxY, uy[l]); sumX += ux[l] / all.length; }
  const shortIdx = []; short.forEach((sh, i) => { if (sh) shortIdx.push(i); });
  shortIdx.sort((p, q) => (comments[q].likes || 0) - (comments[p].likes || 0) || p - q);
  const sr = 8 * Math.sqrt(shortIdx.length) + 10;
  shortIdx.forEach((i, t) => { const rad = sr * Math.sqrt((t + 0.5) / shortIdx.length), ang = t * 2.399963; X[i + 1] = sumX + rad * Math.cos(ang); Y[i + 1] = (isFinite(maxY) ? maxY : 0) + sr + 60 + rad * Math.sin(ang); });
  const graphEdges = snn.map((e) => ({ a: nodeOf(e.a), b: nodeOf(e.b), w: e.w }));
  // computeTopics ('보통' 세밀도)
  const tp = topicPartition({ n, graphEdges, short, texts, resolution: 1 });
  const ids = Int32Array.from(tp.ids);
  const K = tp.groups.length;
  const semN = idx.length;
  const r = { name: s.name, cat: catOf(s), model: key, n, semN, shortShare: 1 - semN / n, embedMs: ms, topics: K, merges: tp.merges.length };
  const sizes = tp.groups.map((g) => g.length);
  r.noKw = tp.keywords.filter((k) => !k.length).length;
  r.noKwShare = K ? r.noKw / K : 0;
  r.noKwComments = tp.groups.reduce((a, g, c) => a + (tp.keywords[c].length ? 0 : g.length), 0) / semN; // 이름 없는 주제에 든 댓글 몫
  r.biggest = Math.max(...sizes) / semN;
  // 겹침
  const ovShare = (ov) => { let k = 0; for (let i = 0; i < n; i++) if (ids[i] >= 0 && ov.extra[i + 1].length) k++; return k / semN; };
  r.overlap = ovShare(tp.ov);
  // 겹침 근거: 보조 주제로 넣은 댓글이 그 보조 주제의 키워드를 쓰는 비율 ÷ 같은 주 주제의 겹치지 않은 댓글이 그 키워드를 쓰는 비율
  const docs = keywordDocs(texts);
  const nodesIds = Int32Array.from({ length: n + 1 }, (_, k) => (k === 0 ? -1 : ids[k - 1]));
  const kwHit = (i, c) => tp.keywords[c].some((w) => docs[i].has(w));
  r.ovGrid = OV_GRID.map((g) => {
    const ov = g.name.startsWith("지금") ? tp.ov : overlapTopics(nodesIds, graphEdges, g);
    let hit = 0, tot = 0, bHit = 0, bTot = 0;
    for (let i = 0; i < n; i++) {
      if (ids[i] < 0) continue;
      for (const c of ov.extra[i + 1]) { if (!tp.keywords[c].length) continue; tot++; if (kwHit(i, c)) hit++; }
    }
    // 기준선: 겹치지 않은 댓글 i, 자기 주제가 아닌 키워드 있는 주제 c 전부 (같은 쌍 비교를 위해 i의 주 주제와 이어진 주제만)
    const pairCount = new Map();
    for (let i = 0; i < n; i++) for (const c of ov.extra[i + 1]) { const k = `${ids[i]}|${c}`; pairCount.set(k, (pairCount.get(k) || 0) + 1); }
    for (let i = 0; i < n; i++) {
      if (ids[i] < 0 || ov.extra[i + 1].length) continue;
      for (const [k] of pairCount) { const [a, c] = k.split("|").map(Number); if (a !== ids[i] || !tp.keywords[c].length) continue; bTot++; if (kwHit(i, c)) bHit++; }
    }
    return { name: g.name, share: ovShare(ov), hit: tot ? hit / tot : null, base: bTot ? bHit / bTot : null };
  });
  // 키워드 문제 세기
  const N = n, df = new Map();
  for (const d of docs) for (const w of d) df.set(w, (df.get(w) || 0) + 1);
  const countIn = (g, w) => g.reduce((a, i) => a + (docs[i].has(w) ? 1 : 0), 0);
  let kwTotal = 0, approxOnly = 0, approxOnlyFirst = 0, prof = 0, profFirst = 0;
  const approxList = [], profList = [];
  tp.groups.forEach((g, c) => tp.keywords[c].forEach((w, rank) => {
    kwTotal++;
    const cc = countIn(g, w), p = hyperTail(cc, g.length, df.get(w), N);
    if (p > 0.025) { approxOnly++; if (rank === 0) approxOnlyFirst++; approxList.push(`${w}(${cc}/${g.length}, p=${p.toFixed(3)})`); }
    if (PROFANITY.test(w)) { prof++; if (rank === 0) profFirst++; profList.push(w); }
  }));
  // 키워드 설명력: 주제 댓글 중 그 주제 키워드를 하나라도 쓰는 비율 (이름 없는 주제는 0으로 셈)
  r.kwCover = tp.groups.reduce((a, g, c) => a + g.filter((i) => kwHit(i, c)).length, 0) / semN;
  Object.assign(r, { kwTotal, approxOnly, approxOnlyFirst, prof, profFirst, approxList, profList });
  // 두 큰 주제가 함께 쓰는 핵심어가 양쪽 키워드에서 빠짐: 낱말이 큰 주제(≥5%) 둘 이상에서 각각 15% 이상 나오고,
  // 그 주제들을 하나로 보면 키워드 기준(z ≥ 1.96, 2배 또는 쏠림 0.4)을 넘는데, 어느 주제의 키워드에도 없음
  const big = tp.groups.map((g, c) => [g, c]).filter(([g]) => g.length >= 0.05 * semN);
  const allKw = new Set(tp.keywords.flat().flatMap((w) => w.split(" ")));
  const lost = [];
  for (const [w, d] of df) {
    if (w.includes(" ") || allKw.has(w) || d < 6) continue;
    const hits = big.filter(([g]) => countIn(g, w) >= 0.15 * g.length);
    if (hits.length < 2) continue;
    const U = hits.flatMap(([g]) => g), cu = countIn(U, w);
    const z = zScore(cu, U.length, d, N), f = U.length / N, spec = f < 1 ? (cu / d - f) / (1 - f) : 1;
    if (z >= 1.96 && ((cu / U.length) / (d / N) >= 2 || spec >= 0.4)) lost.push(`${w}(${hits.map(([g]) => `${countIn(g, w)}/${g.length}`).join("·")})`);
  }
  r.lostShared = lost.length; r.lostList = lost.slice(0, 5);
  // 압도적 주제(80% 이상)의 키워드 — 사람이 읽고 판단 (푸념인지)
  r.dominant = tp.groups.map((g, c) => [g.length / semN, tp.keywords[c]]).filter(([f]) => f >= 0.8).map(([f, k]) => `${pct(f)}: ${k.join(", ") || "(이름 없음)"}`);
  r.names = tp.keywords.map((k, c) => `${sizes[c]}:${k.slice(0, 2).join(" ") || "—"}`);
  // 분리: 고차원(코사인) 실루엣, 지도(힘 배치 뒤) 실루엣, 섬
  const local = new Map(); idx.forEach((ci, l) => local.set(ci + 1, l + 1));
  const lab = [-1, ...ids];
  const pts = []; for (let i = 1; i <= n; i++) if (lab[i] >= 0) pts.push(i);
  r.silHigh = K >= 2 ? silHigh(pts, lab, (i) => all[local.get(i)]) : null;
  const groups = [-1, ...Array.from(ids, (c, i) => (short[i] ? K : c))];
  const gEdges = thinEdges(graphEdges.filter((e) => e.a !== 0 && e.b !== 0), 3).map((e) => ({ a: e.a, b: e.b, sim: 0.45 + 0.55 * e.w }));
  const L = createLayout(X.map((xx, i) => [xx, Y[i]]), gEdges, { pinned: [0], groups, cohesion: 0.05, alpha: 0.6 });
  let frames = 0, running = true;
  while (running && frames < 3000) { for (let t = 0; t < 2 && running; t++) running = L.tick(); frames++; }
  r.frames = frames;
  r.sil2d = K >= 2 ? sil2d(L.x, L.y, pts, lab) : null;
  const isl = islands(L.x, L.y, pts, lab);
  r.comps = isl.comps; r.gap = isl.gap;
  const allPts = []; for (let i = 1; i <= n; i++) allPts.push(i);
  r.compsWithShort = islands(L.x, L.y, allPts, groups).comps;
  return r;
}

const rows = [];
for (const key of MODELS) {
  for (const s of sets) {
    const t0 = performance.now();
    const r = await analyze(s, key);
    r.ms = performance.now() - t0;
    rows.push(r);
    console.log(`[${key}] ${s.name}: 주제 ${r.topics}, 이름없음 ${r.noKw}, 겹침 ${pct(r.overlap)}, 실루엣 고차원 ${f3(r.silHigh)} / 지도 ${f3(r.sil2d)}, 덩어리 ${r.comps}(짧은 반응 포함 ${r.compsWithShort})`);
  }
}

// ---------- 4. 요약 ----------
const med = (a) => { const b = a.filter((x) => x != null).sort((p, q) => p - q); return b.length ? b[Math.floor((b.length - 1) / 2)] : null; };
const avg = (a) => { const b = a.filter((x) => x != null); return b.length ? b.reduce((p, q) => p + q, 0) / b.length : null; };
const range = (a) => { const b = a.filter((x) => x != null); return b.length ? [Math.min(...b), Math.max(...b)] : [null, null]; };
console.log("\n모델 비교 (영상 평균 [최소~최대])");
console.log("모델 | 영상 | 주제 수 | 이름 없는 주제 | 이름 없는 주제의 댓글 | 키워드를 쓰는 댓글 | 겹침 | 고차원 실루엣 | 지도 실루엣 | 덩어리 1개 | 짧은 반응 포함 1개");
for (const key of MODELS) {
  const R = rows.filter((r) => r.model === key);
  const fm = (k, f = f3) => { const [lo, hi] = range(R.map((r) => r[k])); return `${f(avg(R.map((r) => r[k])))} [${f(lo)}~${f(hi)}]`; };
  console.log(`${key} | ${R.length} | ${fm("topics", (x) => x?.toFixed(1))} | ${fm("noKwShare", pct)} | ${fm("noKwComments", pct)} | ${fm("kwCover", pct)} | ${fm("overlap", pct)} | ${fm("silHigh")} | ${fm("sil2d")} | ${R.filter((r) => r.comps === 1).length}/${R.length} | ${R.filter((r) => r.compsWithShort === 1).length}/${R.length}`);
}
if (MODELS.length === 2) {
  const [A, B] = MODELS;
  const pairs = sets.map((s) => [rows.find((r) => r.model === A && r.name === s.name), rows.find((r) => r.model === B && r.name === s.name)]);
  const win = (k, hi = true) => pairs.filter(([a, b]) => a[k] != null && b[k] != null && (hi ? a[k] > b[k] : a[k] < b[k])).length;
  console.log(`\n영상별 우위 (${A} 쪽이 나은 영상 수 / ${pairs.length}): 고차원 실루엣 ${win("silHigh")}, 지도 실루엣 ${win("sil2d")}, 키워드를 쓰는 댓글 ${win("kwCover")}, 이름 없는 주제 적음 ${win("noKwShare", false)}(같음 ${pairs.filter(([a, b]) => a.noKwShare === b.noKwShare).length})`);
}
console.log("\n분류별 (모델별 평균): 주제 수 / 이름 없는 주제 / 겹침 / 지도 실루엣");
for (const cat of byCat.keys()) console.log(`  ${cat}: ` + MODELS.map((key) => { const R = rows.filter((r) => r.model === key && r.cat === cat); return `${key} ${avg(R.map((r) => r.topics))?.toFixed(1)} / ${pct(avg(R.map((r) => r.noKwShare)))} / ${pct(avg(R.map((r) => r.overlap)))} / ${f3(avg(R.map((r) => r.sil2d)))}`; }).join("  |  "));
console.log("\n겹침 기준 비교 (영상 평균): 겹침 비율 / 보조 주제 키워드를 쓰는 비율 / 같은 주제의 겹치지 않은 댓글 기준선");
for (const key of MODELS) {
  const R = rows.filter((r) => r.model === key);
  for (let g = 0; g < OV_GRID.length; g++) {
    const sh = R.map((r) => r.ovGrid[g].share);
    console.log(`  ${key} ${OV_GRID[g].name}: ${pct(avg(sh))} [${pct(range(sh)[0])}~${pct(range(sh)[1])}, 중앙 ${pct(med(sh))}] / ${pct(avg(R.map((r) => r.ovGrid[g].hit)))} / ${pct(avg(R.map((r) => r.ovGrid[g].base)))}`);
  }
}
console.log("\n키워드 문제 (영상 합계)");
for (const key of MODELS) {
  const R = rows.filter((r) => r.model === key);
  const sum = (k) => R.reduce((a, r) => a + r[k], 0);
  console.log(`  ${key}: 키워드 ${sum("kwTotal")}개 중 정확 검정(p>0.025)으로는 못 넘는 것 ${sum("approxOnly")} (첫 키워드 ${sum("approxOnlyFirst")}), 일반 욕설 ${sum("prof")} (첫 키워드 ${sum("profFirst")}), 큰 주제 둘의 공통 핵심어 빠짐 ${sum("lostShared")} (영상 ${R.filter((r) => r.lostShared).length}개), 80% 넘는 주제 ${R.filter((r) => r.dominant.length).length}개 영상`);
}
if (JSON_OUT) {
  // 저장소가 추적할 수 있는 곳이면 경고 (키워드·주제 이름 = 댓글에 쓰인 낱말이 공개 저장소에 올라가지 않게)
  try {
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["check-ignore", "-q", JSON_OUT], { stdio: "ignore" });
  } catch (e) {
    // 1 = 무시 안 됨. 그 밖(128: 저장소 밖·git 오류, git 없음)은 무시되는지 확인하지 못한 것이므로 역시 경고한다
    if (e.status === 1) console.warn(`⚠ ${JSON_OUT} 는 git이 무시하지 않는 곳입니다. 키워드·주제 이름(댓글 낱말)이 들어 있으니 커밋하지 마세요. 기본 위치: fixtures/set/evaluate.json`);
    else console.warn(`⚠ ${JSON_OUT} 가 git에서 무시되는지 확인하지 못했습니다(${e.status ?? e.code}). 키워드·주제 이름(댓글 낱말)이 들어 있으니 공개 저장소에 올리지 마세요.`);
  }
  fs.mkdirSync(path.dirname(JSON_OUT) || ".", { recursive: true });
  fs.writeFileSync(JSON_OUT, JSON.stringify({ bias: [...byCat.entries()], rows }, null, 1));
  console.log(`\n저장: ${JSON_OUT}`);
}
process.exit(ok ? 0 : 1);
