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

// --- YouTube 내부 API 응답 파싱 (2024~ entity 형식을 흉내낸 최소 샘플) ---
const ep = (token) => ({ commandMetadata: { webCommandMetadata: { apiUrl: "/youtubei/v1/next" } }, continuationCommand: { token } });
const sample = {
  onResponseReceivedEndpoints: [
    { reloadContinuationItemsCommand: { targetId: "comments-section", continuationItems: [
      { commentsHeaderRenderer: { countText: { runs: [{ text: "댓글 " }, { text: "1,234" }, { text: "개" }] } } },
      { commentThreadRenderer: { replies: { commentRepliesRenderer: { contents: [{ continuationItemRenderer: { continuationEndpoint: ep("REPLY1") } }] } } } },
      { continuationItemRenderer: { continuationEndpoint: ep("NEXT1") } },
    ] } },
  ],
  frameworkUpdates: { entityBatchUpdate: { mutations: [
    { payload: { commentEntityPayload: {
      properties: { commentId: "Ugx1", content: { content: "좋은 영상" }, publishedTime: "3일 전", toolbarStateKey: "k1" },
      author: { displayName: "@kim", channelId: "UC1", isCreator: false },
      toolbar: { likeCountNotliked: "1.2천", replyCount: "5" },
    } } },
    { payload: { commentEntityPayload: {
      properties: { commentId: "Ugx1.r1", content: { content: "동의해요" }, publishedTime: "2일 전(수정됨)", toolbarStateKey: "k2" },
      author: { displayName: "@lee", channelId: "UC2" },
      toolbar: { likeCountNotliked: " ", replyCount: "" },
    } } },
    { payload: { engagementToolbarStateEntityPayload: { key: "k1", heartState: "TOOLBAR_HEART_STATE_HEARTED" } } },
  ] } },
};
const pr = WV.parseInnertubeComments(sample, "youtube:x", { now });
assert.equal(pr.total, 1234);
assert.equal(pr.comments.length, 2);
assert.equal(pr.comments[0].likes, 1200);
assert.equal(pr.comments[0].meta.hearted, true);
assert.equal(pr.comments[0].meta.replyCount, 5);
assert.equal(pr.comments[1].parentId, "Ugx1");
assert.equal(pr.comments[1].edited, true);
assert.equal(pr.comments[1].likes, 0);
assert.equal(pr.next[0].continuationCommand.token, "NEXT1");
assert.equal(pr.replies[0].continuationCommand.token, "REPLY1");
assert.equal(WV.parseInnertubeComments(sample, "x", { includeReplies: false }).replies.length, 0);

const html = `<script>ytcfg.set({"INNERTUBE_API_KEY":"K","INNERTUBE_CONTEXT":{"client":{"clientVersion":"2.1"}}});</script><script>var ytInitialData = {"a":{"itemSectionRenderer":{"x":1}}};</script>`;
const wh = WV.parseWatchHtml(html);
assert.equal(wh.cfg.INNERTUBE_API_KEY, "K");
assert.ok(wh.data.a.itemSectionRenderer);

// --- 설명 가능한 근거 / 작성자 활동 ---
const { sharedPhrases, authorActivity } = await import("../lib/analyze.js");
const sp = sharedPhrases(["이 정책은 국민을 위한 최고의 선택", "이 정책은 국민을 위한 좋은 선택", "이 정책은 국민을 위한 최선"]);
assert.equal(sp[0], "이 정책은 국민을 위한");
assert.ok(copy.reasons.some((r) => r.startsWith("공통 표현")), "복붙 묶음에 공통 표현 근거");
const act = authorActivity([
  { author: "a", authorId: "A", text: "1", likes: 1, createdAtApprox: "2026-11-20T00:00:00Z" },
  { author: "a", authorId: "A", text: "2", likes: 2, parentId: "p", createdAtApprox: "2026-11-20T01:00:00Z" },
  { author: "a", authorId: "A", text: "3", likes: 0, createdAtApprox: "2026-11-20T02:00:00Z" },
  { author: "b", authorId: "B", text: "4", likes: 0, createdAtApprox: null },
], { minCount: 3, topicIds: [0, 0, 1, -1] });
assert.equal(act.length, 1);
assert.equal(act[0].count, 3);
assert.equal(act[0].replies, 1);
assert.equal(act[0].span, 2 * 3600e3);
assert.equal(act[0].topics, 2);

// --- 레이아웃: 손으로 고정 ---
const many = Array.from({ length: 400 }, (_, i) => [Math.cos(i), Math.sin(i * 1.3)]);
const lay2 = createLayout(many, [], {});
lay2.fix(5, 123, -45);
for (let i = 0; i < 50; i++) lay2.tick();
assert.equal(lay2.x[5], 123);
assert.equal(lay2.y[5], -45);
lay2.release(5); lay2.reheat(0.5);
for (let i = 0; i < 5; i++) lay2.tick();
assert.ok([...lay2.x, ...lay2.y].every(Number.isFinite));

// --- 키워드 / 추천 기준값 / 배치 계획 ---
const { topicKeywords, buildStemmer } = await import("../lib/keywords.js");
const kt = ["이 정책은 정말 문제가 많다", "정책을 다시 검토해야 한다", "정책이 국민을 힘들게 한다", "정부 정책 반대합니다",
  "고양이가 너무 귀엽다", "고양이는 사랑입니다", "우리 고양이 보고 싶다", "고양이 영상 최고",
  "편집이 깔끔하네요", "편집 진짜 잘했다", "편집자 월급 올려줘라 편집 최고"];
const kw = topicKeywords([[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10]], kt);
assert.equal(kw[0][0], "정책");
assert.equal(kw[1][0], "고양이", "근거 없는 조사 떼기 금지 (고양이 → 고양 ✗)");
assert.equal(kw[2][0], "편집");
const st = buildStemmer([["정책은", "정책을", "고양이", "고양이가"]]);
assert.equal(st("정책은"), "정책");
assert.equal(st("고양이"), "고양이");

const { thresholdPresets, thresholdForTopicCount } = await import("../lib/vec.js");
const knb = topKNeighbors(hashEmbed(kt), 8);
const ps = thresholdPresets(knb);
assert.equal(ps.length, 4);
assert.ok(ps.every((p2, i) => i === 0 || p2.value >= ps[i - 1].value), "추천값은 넓게 → 세밀하게 순으로 커진다");
const tk = thresholdForTopicCount(knb, 3);
assert.ok(tk.threshold >= 0.1 && tk.threshold <= 0.99 && tk.count >= 0);

const { planBatches } = await import("../lib/embed/semantic.js");
const pb = planBatches(["bbb", "a", "bbb", "cc"]);
assert.deepEqual(pb.unique, ["bbb", "a", "cc"]);
assert.deepEqual(pb.map, [0, 1, 0, 2]);
assert.deepEqual(pb.order, [1, 2, 0], "짧은 것부터");

// 손 배치 유지: 기준값만 바꿔 다시 만들 때 좌표·고정 상태를 이어받는다
const keepL = createLayout(many, [], { keep: { x: lay2.x, y: lay2.y, pin: lay2.pin } });
assert.equal(keepL.x[7], lay2.x[7]);

console.log("all tests passed");
