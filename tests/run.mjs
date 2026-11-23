// 간단 테스트: node tests/run.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { timeHistogram, exactDuplicates, normalize } from "../lib/analyze.js";

// content/parse.js 를 브라우저 전역처럼 로드
const ctx = { globalThis: {}, setTimeout };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL("../content/parse.js", import.meta.url), "utf8"), ctx);
const WV = ctx.WV;

assert.equal(WV.parseCount("1.2천"), 1200);
assert.equal(WV.parseCount("3.4만"), 34000);
assert.equal(WV.parseCount("1.5K"), 1500);
assert.equal(WV.parseCount("12"), 12);
assert.equal(WV.parseCount(""), 0);

const now = Date.parse("2026-11-24T00:00:00Z");
assert.equal(WV.parseRelativeTime("3일 전", now).approx, "2026-11-21T00:00:00.000Z");
assert.equal(WV.parseRelativeTime("2 hours ago (edited)", now).edited, true);
assert.equal(WV.parseRelativeTime("1년 전(수정됨)", now).edited, true);
assert.equal(WV.parseRelativeTime("방금", now).approx, null);

assert.equal(normalize("좋아요!! 최고 👍"), "좋아요최고");
const cs = [
  { text: "이 영상 진짜 최고네요!", author: "a" },
  { text: "이 영상 진짜 최고네요", author: "b" },
  { text: "이영상 진짜 최고네요!!", author: "c" },
  { text: "ㅋㅋ", author: "d" },
  { text: "ㅋㅋ", author: "e" },
];
const d = exactDuplicates(cs);
assert.equal(d.length, 1);
assert.equal(d[0].count, 3);
assert.equal(d[0].authors, 3);

const h = timeHistogram([
  { createdAtApprox: "2026-11-20T00:00:00Z" },
  { createdAtApprox: "2026-11-20T00:00:00Z" },
  { createdAtApprox: "2026-11-23T00:00:00Z" },
]);
assert.equal(h.length, 4);
assert.equal(h[0].count, 2);

// --- 임베딩 / 벡터 ---
const { hashEmbed } = await import("../lib/embed/hash.js");
const { dot, topKNeighbors, edgesFromNeighbors, clustersFromEdges, pca2 } = await import("../lib/vec.js");
const { createLayout } = await import("../lib/layout.js");
const { clusterSignals, topicSummaries } = await import("../lib/analyze.js");
const { adaptiveThreshold } = await import("../lib/vec.js");

const texts = [
  "이 영상 진짜 최고네요! 구독 박고 갑니다",
  "이 영상 진짜 최고네요 구독 박고 가요",
  "이영상 진짜 최고네요 구독 박고 갑니다!!",
  "오늘 날씨가 너무 덥다",
  "정부 정책은 다시 검토해야 한다고 생각합니다",
  "ㅋㅋㅋㅋ",
  "ㅋㅋㅋ",
];
const vecs = hashEmbed(texts);
assert.ok(Math.abs(dot(vecs[0], vecs[0]) - 1) < 1e-5, "L2 정규화");
assert.ok(dot(vecs[0], vecs[1]) > 0.7, "유사 문구는 높은 유사도");
assert.ok(dot(vecs[0], vecs[3]) < 0.3, "무관한 문구는 낮은 유사도");

const nbrs = topKNeighbors(vecs, 3);
assert.equal(nbrs[0][0].sim >= nbrs[0][1].sim, true);
const edges = edgesFromNeighbors(nbrs, 0.6);
assert.ok(edges.every((e) => e.a < e.b && e.sim >= 0.6));
const { ids, groups } = clustersFromEdges(texts.length, edges);
assert.equal(groups[0].length, 3, "복붙 댓글 3개가 한 묶음");
assert.equal(ids[3], -1, "단독 댓글은 -1");
assert.equal(ids[5], ids[6], "ㅋㅋ 류는 같은 묶음");

const p = pca2(vecs);
assert.equal(p.length, texts.length);
assert.ok(p.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));

const lay = createLayout(p, edges, { pinned: [3] });
for (let i = 0; i < 200 && lay.tick(); i++);
assert.ok([...lay.x, ...lay.y].every(Number.isFinite), "레이아웃 수치 안정");
assert.equal(lay.x[3], 0, "고정 노드");

const fakeComments = texts.map((t, i) => ({ text: t, author: i < 3 ? `u${i}` : `x${i}`, likes: 1, createdAtApprox: null }));
const sig = clusterSignals(groups, fakeComments, edges);
const copy = sig.find((s) => s.size === 3);
assert.ok(copy.score >= 50, `복붙 묶음은 높은 신호 (score=${copy.score})`);
const lol = sig.find((s) => s.indices.includes(5));
assert.equal(lol.score, 0, "짧은 반응은 신호 0");
assert.ok(sig.every((s) => s.reasons.every((r) => !r.includes("조작"))), "'조작' 판정 문구 금지");

// 적응형 임계값 / 주제 요약
const th = adaptiveThreshold(nbrs, 2);
assert.ok(th > -1 && th <= 1, `임계값 범위 (${th})`);
assert.equal(adaptiveThreshold([], 2), 0.5);
const ts = topicSummaries(groups, fakeComments, edges, texts.map(() => 0.5));
assert.equal(ts[0].size, 3);
assert.ok(texts.slice(0, 3).includes(ts[0].sample), "대표 댓글은 묶음 안에서 선택");
assert.equal(ts[0].docSim, 0.5);

console.log("all tests passed");
