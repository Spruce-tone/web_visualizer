// 간단 테스트: node tests/run.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { timeHistogram, exactDuplicates, normalize } from "../lib/analyze.js";

// content/parse.js 를 브라우저 전역처럼 로드
const ctx = { globalThis: {}, setTimeout, btoa, atob, URL };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL("../content/parse.js", import.meta.url), "utf8"), ctx);
const WV = ctx.__wvParse;
assert.equal(ctx.WV, undefined, "parse.js는 전역에 WV를 만들지 않는다 (메인 월드 충돌 방지)");

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
const { topicSummaries } = await import("../lib/analyze.js");
const { clusterSignals } = await import("../lib/signals.js");
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
assert.equal(lol.state, "natural", "짧은 반응은 자연스러운 반복으로 분류");
assert.equal(lol.score, null, "자연스러운 반복에는 점수를 내지 않는다");
assert.equal(copy.score, copy.parts.reduce((s2, p3) => s2 + p3.points, 0), "점수 = 항목 합 (분해 가능)");
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
assert.ok(copy.notes.some((r) => r.startsWith("공통 표현")), "복붙 묶음에 공통 표현 근거");
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
// 답글의 @아이디는 키워드가 되지 않는다 (작성자 이름 가림)
const { tokenize } = await import("../lib/keywords.js");
assert.deepEqual(tokenize("@한남m1s 그건 아니지 @kkh8030 맞아"), ["그건", "아니지", "맞아"]);

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

// ================= 객관성 기준 테스트 =================
const { DEFAULT_WEIGHTS, mergeWeights, validateWeights } = await import("../lib/weights.js");
const { naturalRepetition } = await import("../lib/signals.js");
const { toneOf, toneSummary } = await import("../lib/tone.js");
const { authorFeatures, authorSignals, authorMap } = await import("../lib/authors.js");
const { paraphraseGroups, pileOns, coActiveAuthors, SessionMemory } = await import("../lib/patterns.js");
const { centerVectors } = await import("../lib/vec.js");

// 묶음 신호를 한 번에 계산하는 도우미
// 패널과 같은 경로: 평균 유사도는 묶음 안 모든 쌍(sim), 사슬 기준은 묶는 기준(th)
function signalsFor(list, doc = null, th = 0.6) {
  const V = hashEmbed(list.map((c) => c.text));
  const nb = topKNeighbors(V, 8);
  const ed = edgesFromNeighbors(nb, th);
  const cl = clustersFromEdges(list.length, ed);
  return { sig: clusterSignals(cl.groups, list, ed, { doc, sim: (i, j) => dot(V[i], V[j]), linkThreshold: th }), cl, ed };
}
const mk = (text, author, extra = {}) => ({ id: `${author}-${text.length}-${Math.abs(text.charCodeAt(3) || 0)}`, text, author, authorId: author, likes: 0, createdAtRaw: "3일 전", createdAtApprox: "2026-11-21T00:00:00Z", parentId: null, meta: {}, ...extra });

// [기준 3] 바꿔 넣기: 대상만 바꾼 두 세트의 점수·판정이 같아야 한다
const template = (who) => [
  mk(`${who} 정책은 국민을 위한 최선의 선택이라고 생각합니다 모두 함께 지지합시다`, "u1"),
  mk(`${who} 정책은 국민을 위한 최고의 선택이라고 생각합니다 모두 함께 지지합시다`, "u2"),
  mk(`${who} 정책은 국민을 위한 최선의 선택이라고 생각합니다 다들 함께 지지합시다`, "u3"),
  mk("오늘 점심은 김치찌개를 먹었는데 생각보다 맛있어서 놀랐습니다", "u4"),
  mk("영상 편집이 예전보다 훨씬 깔끔해져서 보기 편해졌네요 자막도 좋아요", "u5"),
];
const swapPairs = [["가나당", "다라당"], ["홍길동 대통령", "임꺽정 대통령"], ["한국", "미국"], ["여당", "야당"]];
for (const [A, B] of swapPairs) {
  const sa = signalsFor(template(A)).sig[0], sb = signalsFor(template(B)).sig[0];
  assert.equal(sa.state, sb.state, `바꿔 넣기(${A}↔${B}): 판정 상태가 같아야 함`);
  assert.ok(Math.abs(sa.score - sb.score) <= 5, `바꿔 넣기(${A}↔${B}): 점수 차 ≤ 5 (${sa.score} vs ${sb.score})`);
  assert.deepEqual(sa.parts.map((x) => x.points), sb.parts.map((x) => x.points), `바꿔 넣기(${A}↔${B}): 항목별 점수 동일`);
}
// 어조 사전은 대상 이름을 모른다 → 대상만 바꾸면 결과가 완전히 같다
for (const [A, B] of swapPairs) {
  for (const tpl of [(w) => `${w} 정말 한심하고 뻔뻔하다`, (w) => `${w} 존경합니다 정말 훌륭해요`, (w) => `${w} 오늘 일정이 있다`]) {
    const ta = toneOf(tpl(A)), tb = toneOf(tpl(B));
    assert.deepEqual([ta.label, ta.condemn, ta.praise], [tb.label, tb.condemn, tb.praise], `어조 바꿔 넣기(${A}↔${B})`);
  }
}
assert.equal(toneOf("정말 한심하고 뻔뻔하다").label, "condemn");
assert.equal(toneOf("존경합니다 훌륭해요").label, "praise");
assert.equal(toneOf("한심하지만 그래도 응원합니다").label, "mixed", "섞이면 불확실로");
assert.equal(toneOf("오늘 날씨가 덥다").label, "none");
assert.equal(toneOf("한심하다").spans[0].start, 0, "근거 구절 위치");

// [기준 1] 의심 점수 항목에 어조·대상이 없다: 문구만 다른(어조가 다른) 두 묶음이 같은 구조면 같은 점수
const condemnSet = [mk("이 사람들 정말 한심하고 뻔뻔하다고 생각합니다 모두 반성해야 합니다", "a1"), mk("이 사람들 정말 한심하고 뻔뻔하다고 생각합니다 모두 반성해야 해요", "a2"), mk("이 사람들 진짜 한심하고 뻔뻔하다고 생각합니다 모두 반성해야 합니다", "a3")];
const praiseSet = [mk("이 사람들 정말 훌륭하고 대단하다고 생각합니다 모두 본받아야 합니다", "a1"), mk("이 사람들 정말 훌륭하고 대단하다고 생각합니다 모두 본받아야 해요", "a2"), mk("이 사람들 진짜 훌륭하고 대단하다고 생각합니다 모두 본받아야 합니다", "a3")];
const sc = signalsFor(condemnSet).sig[0], sp2 = signalsFor(praiseSet).sig[0];
assert.ok(Math.abs(sc.score - sp2.score) <= 5, `비난/칭찬 문구라도 구조가 같으면 점수가 같다 (${sc.score} vs ${sp2.score})`);
assert.ok(JSON.stringify(DEFAULT_WEIGHTS).match(/tone|어조|condemn|praise/i) === null, "가중치에 어조 항목이 없다");

// [기준 5] 자연스러운 반복은 점수를 내지 않는다
const greet = signalsFor([mk("영상 잘 보고 갑니다 감사합니다", "g1"), mk("영상 잘 보고 갑니다 감사합니다!", "g2"), mk("오늘도 영상 잘 보고 갑니다 감사합니다", "g3"), mk("전혀 다른 긴 이야기를 여기에 적어 봅니다 주제도 다르고요", "g4")]).sig[0];
assert.equal(greet.state, "natural", "흔한 인사·응원");
const quote = signalsFor([mk("내일은 해가 뜬다 우리 모두 힘내자", "q1"), mk("내일은 해가 뜬다 우리 모두 힘내자!!", "q2"), mk("내일은 해가 뜬다 우리 모두 힘내자 ㅠㅠ", "q3")], { title: "신곡 발표", text: "가사: 내일은 해가 뜬다 우리 모두 힘내자" }).sig[0];
assert.equal(quote.state, "natural", "영상 설명(가사) 인용");
const stamp = signalsFor([mk("3:12 여기 진짜 웃김", "s1"), mk("3:12 여기 진짜 웃김ㅋㅋ", "s2"), mk("3:12 여기 진짜 웃김 ㅋ", "s3")]).sig[0];
assert.equal(stamp.state, "natural", "타임스탬프 댓글");
const evt = signalsFor([mk("참여합니다 좋은 기회 주셔서 기쁩니다", "e1"), mk("참여합니다 좋은 기회 주셔서 기뻐요", "e2"), mk("참여합니다 좋은 기회 주셔서 기쁩니다!", "e3")], { title: "선물 나눔", text: "댓글로 참여 남겨주시면 추첨합니다" }).sig[0];
assert.equal(evt.state, "natural", "참여 요청 영상");

// [기준 6] 근거가 부족하면 판단 보류
const two = signalsFor([mk("이 정책은 국민을 위한 최선의 선택이라고 생각합니다 지지합시다", "h1"), mk("이 정책은 국민을 위한 최선의 선택이라고 생각합니다 지지합시다!", "h2"), mk("완전히 다른 이야기입니다 날씨가 참 좋네요 산책 가고 싶다", "h3")]).sig[0];
assert.equal(two.state, "hold");
assert.equal(two.score, null);
// 시각이 '며칠 전' 수준이면 시간 몰림 항목을 평가하지 않는다
assert.ok(!signalsFor(template("가나당")).sig[0].parts.some((x) => x.label.includes("시간대")), "거친 시각 → 시간 항목 없음");
assert.ok(signalsFor(template("가나당")).sig[0].notes.some((x) => x.includes("평가하지 않음")));
// 분·시간 단위 시각이 있고 영상 전체 대비 좁은 구간에 몰리면 항목이 붙는다
const base24 = Date.parse("2026-11-23T00:00:00Z");
const burst = [
  ...template("가나당").slice(0, 3).map((c, i) => ({ ...c, createdAtRaw: "5시간 전", createdAtApprox: new Date(base24 + 19 * 3600e3 + i).toISOString() })),
  ...Array.from({ length: 40 }, (_, i) => mk(`서로 다른 평범한 댓글 번호 ${i} 입니다 내용도 제각각 ${i * 7}`, `o${i}`, { createdAtRaw: `${i % 20 + 1}시간 전`, createdAtApprox: new Date(base24 + (i % 20) * 3600e3 - 3600e3 * 5).toISOString() })),
];
assert.ok(signalsFor(burst).sig[0].parts.some((x) => x.label.includes("시간대")), "세밀한 시각 + 좁은 구간 → 시간 항목");

// [기준 8] 같은 입력이면 같은 결과
assert.equal(JSON.stringify(signalsFor(template("가나당")).sig), JSON.stringify(signalsFor(template("가나당")).sig));

// 가중치 프로필
assert.ok(validateWeights(DEFAULT_WEIGHTS));
assert.equal(validateWeights({ cluster: { nearIdentical: 500 } }), false, "범위를 벗어난 보정값 거부");
assert.equal(mergeWeights(DEFAULT_WEIGHTS, { cluster: { nearIdentical: 40 }, source: "보정" }).cluster.nearIdentical, 40);
assert.equal(DEFAULT_WEIGHTS.cluster.nearIdentical, 35, "기본값은 변하지 않는다");

// ---- 작성자 ----
const ac = [
  mk("이 내용은 꼭 널리 알려야 한다고 생각합니다 공유 부탁드립니다", "rep"), mk("이 내용은 꼭 널리 알려야 한다고 생각합니다 공유 부탁드립니다", "rep"),
  mk("이 내용은 꼭 널리 알려야 한다고 생각합니다 공유 부탁드립니다", "rep"), mk("이 내용은 꼭 널리 알려야 한다고 생각합니다 공유 부탁드려요", "rep2"),
  mk("저는 조금 다르게 봅니다 근거가 부족해 보여요 자료를 더 봐야", "n1", { likes: 50 }), mk("편집이 좋아졌네요 다음 편도 기대합니다 수고 많으셨어요", "n1", { likes: 80 }), mk("배경음악 제목이 궁금합니다 아시는 분 계실까요 알려주세요", "n1", { likes: 20 }),
  mk("한 번만 씁니다 그냥 지나가다 남기는 평범한 감상입니다", "once"),
];
const anb = topKNeighbors(hashEmbed(ac.map((c) => c.text)), 8), aed = edgesFromNeighbors(anb, 0.6), acl = clustersFromEdges(ac.length, aed);
const af = authorFeatures(ac, acl.ids, acl.groups);
const rep = af.find((f) => f.key === "rep");
assert.ok(Math.abs(rep.selfDup - (1 - 1 / 3)) < 1e-9, "자기 복제 비율 = 1 − 고유/전체");
assert.equal(rep.crossMatch, 1, "다른 작성자(rep2)와 문구가 겹침");
const as = authorSignals(af);
assert.equal(as[0].key, "rep");
assert.ok(as[0].score >= 50 && as[0].score === Math.max(0, Math.min(100, as[0].parts.reduce((s2, p3) => s2 + p3.points, 0))));
assert.equal(as.find((f) => f.key === "once").state, "hold", "댓글 1개 작성자는 판단 보류");
assert.equal(as.find((f) => f.key === "n1").score, 0, "평범한 작성자는 0점");
assert.ok(authorMap(af).list.length >= 2);

// ---- 추가 패턴 ----
// 같은 주장 다른 표현: 의미 이웃은 가깝고 문구 유사도는 낮은 쌍만 묶인다
const pc = Array.from({ length: 30 }, (_, i) => mk(`평범한 댓글 ${i} 번째 내용은 서로 다릅니다 ${i * 13}`, `p${i}`));
const fakeSem = pc.map((_, i) => [{ j: (i + 1) % 30, sim: i < 4 ? 0.95 : 0.3 + (i % 5) * 0.01 }]);
fakeSem[0] = [{ j: 1, sim: 0.95 }, { j: 2, sim: 0.95 }]; fakeSem[1] = [{ j: 0, sim: 0.95 }, { j: 2, sim: 0.95 }]; fakeSem[2] = [{ j: 0, sim: 0.95 }, { j: 1, sim: 0.95 }];
const pg = paraphraseGroups(fakeSem, () => 0.1, pc);
assert.ok(pg.groups.length >= 1 && pg.groups[0].authors >= 3);
assert.equal(paraphraseGroups(fakeSem, () => 0.9, pc).groups.length, 0, "문구까지 같으면 '다른 표현'이 아니다 (복붙 쪽에서 다룸)");
assert.ok(paraphraseGroups(fakeSem.slice(0, 5), () => 0.1, pc.slice(0, 5)).note, "댓글이 적으면 보류");

// 몰려가기
const parent = mk("원댓글입니다 이 주제에 대한 제 의견을 길게 적어 봅니다", "root", { id: "P" });
const reps = Array.from({ length: 6 }, (_, i) => mk(`답글 ${i}`, `r${i}`, { id: `P.${i}`, parentId: "P" }));
const po = pileOns([parent, ...reps], (i) => (i >= 1 && i <= 4 ? 7 : -1));
assert.equal(po.length, 1);
assert.equal(po[0].similar, 4);
assert.equal(pileOns([parent, ...reps], () => -1).length, 0);

// 같이 움직이는 작성자: 거친 시각이면 보류
assert.ok(coActiveAuthors(pc).note);
const fineC = [];
for (const u of ["x", "y"]) for (const h of [1, 2, 3]) fineC.push(mk(`세밀한 시각 댓글 ${u} ${h}`, u, { createdAtRaw: `${h}시간 전`, createdAtApprox: new Date(base24 - h * 3600e3 + (u === "x" ? 60e3 : 120e3)).toISOString() }));
assert.equal(coActiveAuthors(fineC).groups[0].authors, 2);

// 영상 간 교차 (메모리)
const mem = new SessionMemory();
mem.add({ title: "A", author: "ch1", meta: { videoId: "v1" } }, [mk("a", "same"), mk("b", "only1")]);
mem.add({ title: "B", author: "ch2", meta: { videoId: "v2" } }, [mk("c", "same"), mk("d", "only2")]);
const cv = mem.crossVideo();
assert.equal(cv.authors.length, 1);
assert.equal(cv.authors[0].sameChannel, false);

// 평균 빼기: 한쪽으로 쏠린 벡터의 유사도 차이가 벌어진다
const skew = [[1, 0.1, 0], [1, 0, 0.1], [1, -0.1, 0]].map((v) => { const n = Math.hypot(...v); return Float32Array.from(v.map((x) => x / n)); });
const cen = centerVectors(skew);
assert.ok(dot(skew[0], skew[2]) > 0.9 && dot(cen[0], cen[2]) < 0, "쏠림 제거 후 반대 방향이 드러난다");

// 영상 메타: 새 HTML에서 읽는다
const wm = WV.parseWatchMeta(`<meta name="title" content="새 &amp; 제목"><link itemprop="name" content="채널A">"shortDescription":"설명 \\"x\\"\\n둘째"`);
assert.equal(wm.title, "새 & 제목");
assert.equal(wm.channel, "채널A");
assert.ok(wm.description.includes("둘째"));

// ---- 공개 데이터 보정 (합성 데이터로 계산만 검증) ----
const { calibrateAuthorWeights, aggregateUsers } = await import("../lib/calibrate.js");
const synth = [];
for (let u = 0; u < 120; u++) {
  const troll = u < 40;
  for (let k = 0; k < 6; k++) {
    synth.push({ user: `u${u}`, label: troll ? 1 : 0, likes: troll ? 0 : (u % 4 === 0 ? 30 : 2),
      text: troll && k < 4 ? "이 문장은 여러 계정이 그대로 되풀이하는 긴 문장입니다" : `사용자 ${u} 가 쓴 서로 다른 평범한 댓글 ${k} 번 내용 ${u * 31 + k}` });
  }
}
const agg = aggregateUsers(synth);
assert.ok(agg.find((x) => x.user === "u0").selfDup >= 0.5 && agg.find((x) => x.user === "u100").selfDup === 0);
const cal = calibrateAuthorWeights(synth, { date: "test" });
assert.ok(validateWeights(mergeWeights(DEFAULT_WEIGHTS, cal.override)), "보정 결과는 유효 범위 안");
assert.ok(cal.report.auc > 0.9, `합성 데이터에서 분리 가능 (AUC ${cal.report.auc})`);
assert.ok(!JSON.stringify(cal.override).match(/tone|condemn|praise/i), "보정 프로필에도 어조 항목이 없다");
assert.throws(() => calibrateAuthorWeights(synth.slice(0, 30)), "데이터가 부족하면 거부");

// ---- 주제 묶기(k-평균), 섬 배치, 무작위 추출 ----
const { kmeans, suggestK, isShortReaction, representatives } = await import("../lib/cluster.js");
const { placeAnchors } = await import("../lib/layout.js");
const { neighborsFast, packVectors, unpackVectors } = await import("../lib/vec.js");
const three = [];
for (let i = 0; i < 90; i++) three.push(["정부 정책 세금 예산 국회 논의", "고양이 강아지 귀여운 동물 영상", "게임 공략 보스 아이템 레벨"][i % 3] + ` 이야기 ${i}`);
const tv = hashEmbed(three);
const km = kmeans(tv, 3);
assert.equal(km.centroids.length, 3);
assert.deepEqual(km.sizes, [30, 30, 30], "세 주제가 정확히 갈라진다");
assert.ok([0, 3, 6].every((i) => km.ids[i] === km.ids[0]) && km.ids[0] !== km.ids[1], "같은 주제는 같은 묶음");
assert.deepEqual(Array.from(kmeans(tv, 3).ids), Array.from(km.ids), "같은 입력이면 같은 묶음 (결정적)");
assert.ok(representatives(tv, km.ids, km.centroids).every((i) => i >= 0));
assert.equal(isShortReaction("lol"), true);
assert.equal(isShortReaction("ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ"), true);
assert.equal(isShortReaction("이 영상 정말 잘 만들었네요"), false);
assert.ok(suggestK(1000) >= 10 && suggestK(1000) <= 20 && suggestK(10) >= 2);

const anc = placeAnchors([[0, 0], [0.01, 0], [1, 1], [-1, 0.5]], [300, 200, 50, 10]);
for (let i = 0; i < anc.length; i++) {
  assert.ok(Math.hypot(anc[i].x, anc[i].y) >= anc[i].r, "가운데(본문)와 겹치지 않음");
  for (let j = i + 1; j < anc.length; j++) assert.ok(Math.hypot(anc[i].x - anc[j].x, anc[i].y - anc[j].y) >= anc[i].r + anc[j].r + 30, "섬끼리 떨어져 있음");
}
const gl = createLayout(three.map(() => [0, 0]), [], { groups: Array.from(km.ids), anchors: placeAnchors([[1, 0], [-1, 0], [0, 1]], km.sizes) });
for (let i = 0; i < 150 && gl.tick(); i++);
assert.ok(three.every((_, i) => { const a = gl.anchors[km.ids[i]]; return Math.hypot(gl.x[i] - a.x, gl.y[i] - a.y) <= a.r * 1.15; }), "모든 점이 자기 섬 안에");
const gx = gl.x[0];
gl.moveGroup(km.ids[0], 100, -40);
assert.ok(Math.abs(gl.x[0] - gx - 100) < 1e-3 && three.every((_, i) => km.ids[i] === km.ids[0] || gl.x[i] !== undefined), "키워드를 끌면 그 주제의 점이 함께 이동");

const nf = await neighborsFast(tv, 5, { exactLimit: 20, partition: kmeans });
assert.ok(nf.every((l) => l.length === 5 && l[0].sim >= l[4].sim));
const packed = unpackVectors(JSON.parse(JSON.stringify(packVectors(tv.slice(0, 4)))));
assert.equal(packed[3][7], tv[3][7], "벡터 묶기·풀기");

const sh1 = WV.seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], "VID"), sh2 = WV.seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], "VID");
assert.equal(JSON.stringify(sh1), JSON.stringify(sh2), "같은 씨앗이면 같은 순서");
assert.notEqual(JSON.stringify(sh1), JSON.stringify(WV.seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], "OTHER")));
assert.equal([...sh1].sort().join(""), "12345678");
// 무작위 추출이 치우치지 않는지: 여러 씨앗에서 앞쪽 절반에 뽑히는 빈도가 원소마다 비슷해야 한다
const freq = new Array(8).fill(0);
for (let sd2 = 0; sd2 < 400; sd2++) WV.seededShuffle([0, 1, 2, 3, 4, 5, 6, 7], "seed" + sd2).slice(0, 4).forEach((x) => freq[x]++);
assert.ok(freq.every((f) => f > 150 && f < 250), `균등 추출 (${freq})`);
assert.equal(WV.linkedCommentParams("Ugxx6fT6wNdMlJLrBuJ4AaABAg").length, 52, "하이라이트 댓글 params (실제 YouTube 값과 같은 길이)");
// 스레드별 답글 주소
sample.onResponseReceivedEndpoints[0].reloadContinuationItemsCommand.continuationItems[1].commentThreadRenderer.commentViewModel = { commentViewModel: { commentId: "Ugx1" } };
const pr2 = WV.parseInnertubeComments(sample, "youtube:x", { now });
assert.equal(JSON.stringify(pr2.threads.map((x) => [x.id, x.endpoints.length])), '[["Ugx1",1]]');

// ---- 고르게 무작위 추출 (WV.sampleRandom): 가짜 YouTube로 공정성·동시 요청·물러나기 ----
{
  // tops개 원댓글, 한 쪽에 20개. i % 7 == 0 인 스레드는 답글 (i % 13) + 1개, 한 쪽에 5개씩(답글 더보기 사슬)
  // delay: true = 호출 순번으로 정한 0~3ms, 함수면 (st, ep) → ms (끝나는 순서를 바꿔 보기)
  const fakeYT = ({ tops = 3000, fail = () => null, delay = true } = {}) => {
    const st = { calls: 0, inflight: 0, peak: 0, replyCalls: 0 };
    const nRep = (i) => (i % 7 === 0 ? (i % 13) + 1 : 0);
    const page = async (ep) => {
      st.calls++; st.inflight++; st.peak = Math.max(st.peak, st.inflight);
      try {
        if (delay) await new Promise((r) => setTimeout(r, typeof delay === "function" ? delay(st, ep) : (st.calls * 7919) % 4)); // 끝나는 순서를 섞는다
        const err = fail(ep, st);
        if (err) throw err;
        const out = { comments: [], next: [], replies: [], threads: [], total: tops * 2, error: null };
        if ("p" in ep) {
          for (let i = ep.p * 20; i < Math.min(tops, ep.p * 20 + 20); i++) {
            out.comments.push({ id: `t${i}`, parentId: null, rank: i });
            const eps = nRep(i) ? [{ t: i, q: 0 }] : [];
            out.replies.push(...eps);
            out.threads.push({ id: `t${i}`, endpoints: eps });
          }
          if ((ep.p + 1) * 20 < tops) out.next.push({ p: ep.p + 1 });
        } else {
          st.replyCalls++;
          const n = nRep(ep.t);
          for (let j = ep.q * 5; j < Math.min(n, ep.q * 5 + 5); j++) out.comments.push({ id: `t${ep.t}.r${j}`, parentId: `t${ep.t}` });
          if ((ep.q + 1) * 5 < n) out.replies.push({ t: ep.t, q: ep.q + 1 });
        }
        return out;
      } finally { st.inflight--; }
    };
    return { page, st };
  };
  const noSleep = async () => {};
  const run = (o, yt = fakeYT()) => WV.sampleRandom({ start: { p: 0 }, page: yt.page, max: 300, seed: "VID", minGapMs: 0, sleep: noSleep, ...o });

  assert.equal(WV.poolLimit(100), 600);
  assert.equal(WV.poolLimit(300), 900);
  assert.equal(WV.poolLimit(1000), 3000);
  assert.equal(WV.poolLimit(10000), 20000);

  // 1) 예전 차례 방식(0.10.0 youtube.js)과 같은 결과: 같은 후보, 같은 섞기, 같은 순서로 담기
  const reference = async (yt, max, limit) => {
    const cand = [], eps = new Map(), q = [{ p: 0 }];
    while (q.length && cand.length < limit) { const r = await yt.page(q.shift()); for (const c of r.comments) cand.push(c); for (const t of r.threads) if (t.endpoints.length) eps.set(t.id, t.endpoints); q.push(...r.next); }
    const out = [];
    for (const top of WV.seededShuffle(cand, "VID")) {
      if (out.length >= max) break;
      out.push(top);
      const rq = [...(eps.get(top.id) || [])];
      while (rq.length && out.length < max) { const r = await yt.page(rq.shift()); for (const c of r.comments) if (out.length < max) out.push(c); rq.push(...r.replies); }
    }
    return out.map((c) => c.id);
  };
  const yRef = fakeYT();
  const ref = await reference(yRef, 300, WV.poolLimit(300));
  const y1 = fakeYT(), y3 = fakeYT();
  const s1 = await run({ concurrency: 1 }, y1), s3 = await run({ concurrency: 3 }, y3);
  assert.equal(JSON.stringify(s1.comments.map((c) => c.id)), JSON.stringify(ref), "동시 1개 = 예전 방식");
  assert.equal(JSON.stringify(s3.comments.map((c) => c.id)), JSON.stringify(ref), "동시 3개여도 결과(순서까지) 같음");
  assert.equal(s3.comments.length, 300);
  assert.ok(s3.comments.some((c) => c.parentId), "답글도 담김");
  assert.equal(s3.pool.size, 900); assert.equal(s3.pool.complete, false); assert.equal(s3.complete, false);
  assert.ok(y3.st.peak <= 3 && y3.st.peak >= 2, `동시 요청 ${y3.st.peak}개 (최대 3)`);
  assert.equal(y1.st.peak, 1);
  assert.equal(y1.st.replyCalls, yRef.st.replyCalls, "동시 1개는 예전 방식과 답글 요청 수도 같다");
  // 미리 받기는 스레드 첫 쪽만 → 다 채워 버리는 답글 요청은 미리 받던 스레드의 첫 쪽(동시 수 - 1개) 이하.
  // 응답이 끝나는 순서와 상관없이 지켜져야 한다(예전엔 미리 받던 사슬을 끝까지 받아 CI에서 4개까지 버렸다) → 지연 모양을 바꿔 가며 확인
  const lcg = (sd) => () => (sd = (sd * 1103515245 + 12345) % 2147483648) / 2147483648;
  const shapes = [true, (st, ep) => ("p" in ep ? 0 : ep.q === 0 ? 12 : 0), (st, ep) => ("p" in ep ? 0 : ep.t % 3 === 0 ? 15 : 0), ...[1, 2, 3].map((sd) => { const r = lcg(sd); return () => Math.floor(r() * 20); })];
  for (const [si, shape] of shapes.entries()) for (const seed of ["VID", "c"]) {
    const b1 = fakeYT({ delay: false }), b3 = fakeYT({ delay: shape });
    const r1 = await run({ concurrency: 1, seed }, b1), r3 = await run({ concurrency: 3, seed }, b3);
    assert.deepEqual(r3.comments.map((c) => c.id), r1.comments.map((c) => c.id), `지연 모양 ${si}, 씨앗 ${seed}: 결과 같음`);
    assert.ok(b3.st.replyCalls - b1.st.replyCalls <= 2, `지연 모양 ${si}, 씨앗 ${seed}: 버리는 답글 요청 ${b3.st.replyCalls - b1.st.replyCalls}개 (2개 이하)`);
  }

  // 2) 공정성: 뽑힌 원댓글의 후보 안 위치(최신순 순번)가 앞쪽에 몰리지 않는다 — 다섯 구간이 각각 20% 안팎
  const bins = [0, 0, 0, 0, 0];
  let picked = 0, rankSum = 0;
  for (let sd = 0; sd < 20; sd++) {
    const r = await run({ seed: "v" + sd, includeReplies: false, max: 300 }, fakeYT({ delay: false }));
    for (const c of r.comments) { bins[Math.floor((c.rank / r.pool.size) * 5)]++; picked++; rankSum += c.rank / r.pool.size; }
  }
  assert.ok(bins.every((b) => Math.abs(b / picked - 0.2) < 0.02), `구간별 비율 ${bins.map((b) => (b / picked).toFixed(3))}`);
  assert.ok(Math.abs(rankSum / picked - 0.5) < 0.01, `평균 위치 ${(rankSum / picked).toFixed(3)}`);
  // 후보가 영상 전체를 덮으면(원댓글 400개 < 900) 전체가 후보, '전체에서 추출'
  const small = await run({}, fakeYT({ tops: 400 }));
  assert.equal(small.pool.size, 400); assert.equal(small.pool.complete, true);
  assert.equal(new Set(small.comments.filter((c) => !c.parentId).map((c) => c.id)).size, small.comments.filter((c) => !c.parentId).length, "원댓글 중복 없음");

  // 3) 물러나기: 429가 두 번 나면 0.8초·1.6초 쉬고 다시, 그 뒤로는 동시 1개
  const waits = [];
  let n429 = 0;
  const yb = fakeYT({ fail: (ep, st) => (ep.p === 5 && n429 < 2 ? (n429++, { status: 429 }) : ("t" in ep && st.inflight > 1 ? new Error("동시 요청이 1개로 줄지 않음") : null)) });
  const sb = await run({ sleep: async (ms) => { waits.push(ms); } }, yb);
  assert.deepEqual(waits, [800, 1600], `물러난 시간 ${waits}`);
  assert.equal(JSON.stringify(sb.comments.map((c) => c.id)), JSON.stringify(ref), "다시 받아서 결과 같음");
  assert.equal(sb.complete, false); // 후보가 900개에서 끊겼으므로(전체 아님)
  // 다시 시도할 수 없는 실패(403)는 바로 멈춤
  const tries403 = [];
  await assert.rejects(WV.withBackoff(async () => { tries403.push(1); throw Object.assign(new Error("x"), { status: 403 }); }, { sleep: noSleep }));
  assert.equal(tries403.length, 1, "403은 다시 시도하지 않음");
  let t5 = 0;
  assert.equal(await WV.withBackoff(async () => { if (++t5 < 3) throw Object.assign(new Error("x"), { status: 503 }); return "ok"; }, { sleep: noSleep }), "ok", "503은 다시 시도");
  await assert.rejects(WV.withBackoff(async () => { throw Object.assign(new Error("x"), { status: 429 }); }, { sleep: noSleep }), "4번 다 실패하면 던짐");
  // 첫 쪽부터 계속 실패하면 오류, 후보를 모은 뒤 실패하면 모은 데까지로 뽑고 '덜 모음'
  await assert.rejects(run({}, fakeYT({ fail: () => ({ status: 500 }), delay: false })));
  const partial = await run({}, fakeYT({ fail: (ep) => ("p" in ep && ep.p >= 10 ? { status: 500 } : null), delay: false }));
  assert.equal(partial.pool.size, 200); assert.equal(partial.pool.complete, false); assert.equal(partial.complete, false);
  // 후보를 훑다 막힌 경우(10번째 쪽부터 계속 500): 더 요청하지 않고 모은 후보 200개 안에서 원댓글만 담는다
  assert.equal(partial.limited, true);
  assert.equal(partial.comments.length, 200, `후보 안에서 원댓글을 담음 (${partial.comments.length}개)`);
  assert.ok(partial.comments.every((c) => !c.parentId), "막힌 뒤에는 답글을 받지 않음");
  assert.equal(partial.noReplies, true, "답글을 못 받았다고 알린다");
  assert.equal((await run({ includeReplies: false }, fakeYT({ fail: (ep) => ("p" in ep && ep.p >= 10 ? { status: 500 } : null), delay: false }))).noReplies, false, "답글을 원하지 않았으면 알릴 것 없음");
  const y429 = fakeYT({ fail: (ep) => ("p" in ep && ep.p >= 10 ? { status: 429 } : null), delay: false });
  const p429 = await run({}, y429);
  assert.equal(p429.comments.length, 200); assert.equal(p429.limited, true);
  assert.equal(y429.st.replyCalls, 0, "후보 단계에서 막히면 답글 요청 0개");
  // 한 스레드의 답글이 다시 시도할 수 없는 오류(403)로 실패하면 그 답글만 빠지고 나머지는 그대로
  const ft = small.comments.find((c) => c.parentId).parentId; // 뽑힌 스레드 하나
  const rf = await run({}, fakeYT({ tops: 400, fail: (ep) => (`t${ep.t}` === ft ? { status: 403 } : null), delay: false }));
  assert.ok(!rf.comments.some((c) => c.parentId === ft) && rf.comments.some((c) => c.id === ft), "원댓글은 남고 답글만 빠짐");
  assert.ok(rf.comments.some((c) => c.parentId && c.parentId !== ft), "다른 스레드 답글은 그대로");
  assert.equal(rf.complete, false);
  // 회로 차단: 어느 순간부터 답글 요청이 계속 429면, 한 스레드에서 4번 시도한 뒤 남은 답글 받기를 모두 멈춘다(다음 스레드에서 또 두드리지 않음)
  {
    let hits = 0;
    const hitThreads = new Set();
    const yl = fakeYT({ fail: (ep, st) => ("t" in ep && st.replyCalls > 5 ? (hits++, hitThreads.add(`t${ep.t}`), { status: 429 }) : null) });
    const lw = [];
    const rl = await run({ sleep: async (ms) => { lw.push(ms); } }, yl);
    assert.equal(rl.limited, true); assert.equal(rl.complete, false);
    assert.equal(rl.noReplies, false, "답글을 받다 막힌 경우는 받은 답글이 있다");
    assert.ok(hits <= 4 + 2, `막힌 뒤 보낸 답글 요청 ${hits}개 (한 스레드 4번 + 이미 나간 것)`);
    assert.ok(rl.comments.length < 300, "그때까지 담은 것으로 끝냄");
    // 섞은 순서는 후보 수와 씨앗으로만 정해진다 → 막힌 스레드의 위치 뒤 원댓글은 담기지 않아야 한다
    const perm = WV.seededShuffle(Array.from({ length: 900 }, (_, i) => `t${i}`), "VID");
    const lastHit = Math.max(...[...hitThreads].map((t) => perm.indexOf(t)));
    assert.ok(rl.comments.filter((c) => !c.parentId).length <= lastHit + 1, "막힌 뒤 원댓글을 더 붙이지 않음");
    // 중지는 막힘이 아니다
    let stopRun = false;
    const rc = await run({ isCancelled: () => stopRun, onProgress: (n, t, ph) => { if (ph === "답글 받는 중" && n > 100) stopRun = true; } });
    assert.equal(rc.limited, false); assert.equal(rc.complete, false);
    // 403 같은 실패는 그 스레드만 빼고 계속 (limited 아님) — 위 rf 경우
    assert.equal(rf.limited, false);
    // 중지되면 물러나 쉬던 요청도 깨어나서 다시 보내지 않는다
    let stopNow = false, sent = 0;
    await assert.rejects(WV.withBackoff(async () => { sent++; throw Object.assign(new Error("x"), { status: 429 }); }, { sleep: async () => { stopNow = true; }, stop: () => stopNow }));
    assert.equal(sent, 1, "쉬는 동안 중지 → 다시 보내지 않음");
  }
  // 요청 시작 간격: minGapMs를 지킨다 (가짜 시계: sleep이 시계를 앞으로 돌린다 → 실제 타이머 오차와 무관)
  {
    let clock = 1000; const starts = [], waits = [];
    const yg = fakeYT({ tops: 200 });
    const pg = yg.page;
    await WV.sampleRandom({ start: { p: 0 }, page: (e, r) => { starts.push(clock); return pg(e, r); }, max: 40, seed: "g", minGapMs: 15,
      now: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms; } });
    const gaps = starts.slice(1).map((t, i) => t - starts[i]);
    assert.ok(starts.length > 5 && waits.length >= starts.length - 1, "요청마다 간격을 기다림");
    assert.ok(gaps.every((g) => g >= 15), `요청 시작 간격 ${Math.min(...gaps)} ≥ 15`);
    // 시계가 이미 간격만큼 갔으면 기다리지 않는다
    clock = 0; waits.length = 0;
    await WV.sampleRandom({ start: { p: 0 }, page: (e, r) => { clock += 20; return pg(e, r); }, max: 40, seed: "g", minGapMs: 15, includeReplies: false,
      now: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms; } });
    assert.equal(waits.length, 0, "간격이 이미 지났으면 쉬지 않음");
  }
}

// ---- 연속 지도(UMAP)와 커뮤니티(Louvain), 가르는 키워드 ----
const { fuzzyGraph, umapLayout, toPixels } = await import("../lib/umap.js");
const { louvain } = await import("../lib/community.js");
const { createStaticLayout } = await import("../lib/layout.js");
const cvec = centerVectors(hashEmbed(three));
const fgr = fuzzyGraph(topKNeighbors(cvec, 10));
assert.ok(fgr.every((e) => e.a < e.b && e.w > 0 && e.w <= 1.0001), "퍼지 그래프 간선 강도 0~1");
const um = umapLayout(three.length, fgr, pca2(cvec));
toPixels(um.x, um.y);
assert.ok([...um.x, ...um.y].every(Number.isFinite));
const um2 = umapLayout(three.length, fgr, pca2(cvec));
toPixels(um2.x, um2.y);
assert.equal(um.x[17], um2.x[17], "같은 입력이면 같은 지도");
// 같은 주제끼리 가까이: 주제 안 평균 거리 < 주제 사이 평균 거리
let within = 0, wn = 0, between = 0, bn = 0;
for (let i = 0; i < three.length; i++) for (let j = i + 1; j < three.length; j++) {
  const dd = Math.hypot(um.x[i] - um.x[j], um.y[i] - um.y[j]);
  if (i % 3 === j % 3) { within += dd; wn++; } else { between += dd; bn++; }
}
assert.ok(within / wn < (between / bn) * 0.6, `같은 주제는 지도에서 가까이 모인다 (${(within / wn).toFixed(0)} vs ${(between / bn).toFixed(0)})`);
let closest = Infinity;
for (let i = 0; i < three.length; i++) for (let j = i + 1; j < three.length; j++) closest = Math.min(closest, Math.hypot(um.x[i] - um.x[j], um.y[i] - um.y[j]));
assert.ok(closest >= 6, "점이 서로 겹치지 않는다");

const lvn = louvain(three.length, fgr, { resolution: 1 });
assert.equal(lvn.sizes.length, 3, "세 주제를 찾는다");
assert.ok([0, 3, 6, 9].every((i) => lvn.ids[i] === lvn.ids[0]) && lvn.ids[0] !== lvn.ids[1]);
assert.equal(JSON.stringify(Array.from(louvain(three.length, fgr, { resolution: 1 }).ids)), JSON.stringify(Array.from(lvn.ids)), "결정적");
assert.ok(louvain(three.length, fgr, { resolution: 4 }).sizes.length >= lvn.sizes.length, "세밀도를 올리면 묶음이 줄지 않는다");
// 두 무리를 다리 하나로 이은 그래프 → 두 묶음
const twoG = [];
for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) { twoG.push({ a: i, b: j, w: 1 }); twoG.push({ a: i + 6, b: j + 6, w: 1 }); }
twoG.push({ a: 0, b: 6, w: 0.2 });
assert.deepEqual(louvain(12, twoG).sizes, [6, 6]);

// 모든 묶음에 흔한 낱말은 키워드에서 빠진다
// 댓글 6개뿐이면 3/6은 우연과 가를 수 없다(정확 검정 p = 0.05) → 같은 글을 세 벌로 늘려(18개) 본다
const dTexts = ["민주당 탄핵 추진 반대", "민주당 탄핵 무리", "민주당 탄핵 절차", "민주당 경제 정책 실패", "민주당 경제 물가", "민주당 경제 대책"];
const kwD = topicKeywords([[0, 1, 2, 6, 7, 8, 12, 13, 14], [3, 4, 5, 9, 10, 11, 15, 16, 17]], [...dTexts, ...dTexts, ...dTexts]);
assert.deepEqual(topicKeywords([[0, 1, 2], [3, 4, 5]], dTexts), [[], []], "6개 중 3개는 우연과 가를 수 없어 이름을 짓지 않는다 (정확 검정)");
assert.ok(!kwD[0].includes("민주당") && !kwD[1].includes("민주당"), `흔한 낱말 제외 (${kwD})`);
assert.ok(kwD[0].includes("탄핵"));
assert.ok(kwD[1].includes("경제"));

// 큰 주제도 키워드를 갖는다 (실제 뉴스 댓글 모양의 합성 자료: 큰 주제는 흐릿하고 모든 주제에 공통 푸념이 섞임)
const { koreanTopics } = await import("./ko-topics.mjs");
const { minCount } = await import("../lib/keywords.js");
assert.equal(minCount(4), 2);
assert.equal(minCount(16), 2);
assert.equal(minCount(17), 3);
assert.equal(minCount(25), 3);
assert.equal(minCount(300), 9, "300개 묶음은 36번(12%)이 아니라 9번(3%)이면 된다");
// 모든 주제에 섞인 공통 푸념은 큰 주제에서 우연히 조금 많이 나와도 대개 키워드가 되지 않는다 (통계 검사라 드물게 섞일 수 있음 → 비율로 확인)
const COMMON_RE = /알겠지|놀람|어이가|답답하다|한심하다|나라냐|걱정|정신|믿냐|무섭|막힌다|손해|모르겠다|안 되는|국민/;
let koNoise = 0, koTopics = 0;
for (let seed = 1; seed <= 40; seed++) {
  const ko = koreanTopics({ seed });
  const kk = topicKeywords(ko.groups, ko.texts, { k: 4 });
  ko.names.forEach((name, i) => assert.equal(kk[i][0], name, `seed ${seed}: '${name}' 주제의 첫 키워드 (${kk[i]})`));
  kk.forEach((ws) => { koTopics++; if (ws.some((w) => COMMON_RE.test(w))) koNoise++; });
}
assert.ok(koNoise / koTopics <= 0.05, `공통 푸념이 섞인 주제 ${koNoise}/${koTopics}`);
// 주제 낱말이 아주 드문(8~10%) 두 주제, 큰 주제가 댓글의 71%를 차지해도 비지 않는다 (초기하 보정)
const ko2 = koreanTopics({ sizes: { 자유: 300, 가짜뉴스: 120 }, coreRate: { 자유: 0.08, 가짜뉴스: 0.1 } });
const kk2 = topicKeywords(ko2.groups, ko2.texts, { k: 4 });
assert.deepEqual(kk2.map((x) => x[0]), ["자유", "가짜뉴스"]);
// 묶음에만 나오는 낱말 24번, 묶음 몫 71%: 보정 없이는 z≈1.7(탈락), 보정하면 ≈3.1
const { zScore } = await import("../lib/keywords.js");
assert.ok(zScore(24, 300, 24, 420) > 3, `${zScore(24, 300, 24, 420)}`);
assert.ok(zScore(3, 3, 3, 6) >= 1.96, "작은 묶음에서도 그 묶음에만 나온 낱말은 통과");
assert.ok(Math.abs(zScore(10, 100, 20, 200)) < 1e-9, "기대만큼이면 0");
assert.equal(zScore(5, 10, 5, 10), Infinity, "묶음이 전부면 견줄 바깥이 없다");
// 푸념이 한 주제에 몰려도(그 주제 푸념의 20%를 앞 다섯 개에서) 주제 낱말이 이름에 들어가고, 대개 첫 키워드다
let skewFirst = 0;
for (let seed = 1; seed <= 40; seed++) {
  const ko3 = koreanTopics({ seed, skew: { 자유: 0.2 }, coreRate: { 자유: 0.15, 가짜뉴스: 0.6, 감시: 0.6, 기자: 0.7 } });
  const kk3 = topicKeywords(ko3.groups, ko3.texts, { k: 4 });
  ko3.names.forEach((name, i) => assert.ok(kk3[i].includes(name), `seed ${seed}: 몰린 푸념 속 주제 낱말 (${kk3[i]})`));
  if (ko3.names.every((name, i) => kk3[i][0] === name)) skewFirst++;
}
assert.ok(skewFirst >= 38, `몰린 푸념: 주제 낱말이 첫 키워드인 경우 ${skewFirst}/40`);
// 주제 낱말 없이 푸념만 있는 주제는 이름을 비워 둔다 ("주제 N"이 잡음 이름보다 낫다)
{
  const filler = ["이게 나라냐", "어이가 없네요", "참 답답하다", "세상 참 무섭네"];
  const tx = [], gA = [], gB = [];
  for (let i = 0; i < 40; i++) { gA.push(tx.length); tx.push(`표현의 자유 ${filler[i % 4]}`); }
  for (let i = 0; i < 40; i++) { gB.push(tx.length); tx.push(filler[i % 4]); }
  const kf = topicKeywords([gA, gB], tx, { k: 4 });
  assert.ok(kf[0].includes("자유"), `${kf[0]}`);
  assert.deepEqual(kf[1], [], "푸념만 있는 주제는 키워드 없음");
  // 작은 묶음(16개 이하)에도 같은 규칙: 푸념만 있으면 비어 있다
  const gC = [];
  for (let i = 0; i < 8; i++) { gC.push(tx.length); tx.push(filler[i % 4]); }
  const kfs = topicKeywords([gA, gB, gC], tx, { k: 4 });
  assert.deepEqual(kfs[2], [], `작은 푸념 묶음 (${kfs[2]})`);
  assert.ok(kfs[0].includes("자유"));
  // 무작위로 섞은 경우에도 대부분 비어 있다 (통계 검사라 가끔 우연한 낱말이 통과함)
  let named = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const kr = koreanTopics({ seed, sizes: { 자유: 300, 가짜뉴스: 120, 잡담: 150 } });
    if (topicKeywords(kr.groups, kr.texts, { k: 4 })[2].length) named++;
  }
  assert.ok(named <= 12, `푸념만 있는 주제에 이름이 붙은 경우 ${named}/40`);
}
// 두 주제에 걸쳐 많이 쓰인 낱말(쏠림은 낮지만 각 주제에서 영상 전체의 2배 넘게 나옴)도 두 주제 모두의 키워드가 된다
{
  const tx = [], gs = [];
  const other = ["오늘 날씨 이야기", "점심 메뉴 고민", "주말 계획 세우기", "운동 다녀옴", "책 읽는 중", "영화 보러 감", "커피 마시는 중", "산책 다녀옴"];
  for (let t = 0; t < 6; t++) {
    const g = [];
    for (let i = 0; i < 100; i++) {
      g.push(tx.length);
      const shared = t < 2 ? i < 25 : i === 0; // 주제 0·1: 25%, 나머지: 1개씩
      tx.push(`${shared ? "가짜뉴스 " : ""}${t === 0 ? "처벌" : t === 1 ? "검열" : ["날씨", "메뉴", "운동", "영화"][t - 2]} ${other[(i + t) % 8]}`);
    }
    gs.push(g);
  }
  const ks = topicKeywords(gs, tx, { k: 4 });
  assert.ok(ks[0].includes("가짜뉴스") && ks[1].includes("가짜뉴스"), `두 주제에 걸친 낱말 (${ks[0]} / ${ks[1]})`);
  assert.ok(!ks.slice(2).some((k) => k.includes("가짜뉴스")));
}
// 흔한 어미·복수 떼기: 말뭉치 안에 근거가 있을 때만
const st2 = buildStemmer([["처벌해야", "처벌하는", "처벌이", "기자들이", "기자는", "기자를", "하는"]]);
assert.equal(st2("처벌해야"), "처벌");
assert.equal(st2("기자들이"), "기자");
assert.equal(st2("하는"), "하는", "어간이 두 글자 미만이면 떼지 않는다");
const st3 = buildStemmer([["공부하는"]]);
assert.equal(st3("공부하는"), "공부하는", "표면형 하나뿐이면 떼지 않는다");
// "들"로 끝나는 명사는 "X들"과 "X들+조사"끼리 서로 근거가 되지 않는다
const st4 = buildStemmer([["큰아들", "큰아들이", "외아들", "외아들은"]]);
assert.equal(st4("큰아들"), "큰아들");
assert.equal(st4("큰아들이"), "큰아들");
assert.equal(st4("외아들은"), "외아들");
const st6 = buildStemmer([["큰아들", "큰아들이", "큰아이"], ["고양이", "고양들"]]);
assert.equal(st6("큰아들"), "큰아들", "검증 안 된 조사 떼기(큰아이 → 큰아)는 '들' 떼기 근거가 아니다");
assert.equal(st6("고양들"), "고양들");
const st5 = buildStemmer([["기자들이", "기자들"]]);
assert.equal(st5("기자들이"), "기자들", "'기자'나 '기자+조사'가 따로 없으면 '들'을 떼지 않는다");

const sl = createStaticLayout([0, 10, 20], [0, 0, 0], [-1, 0, 0]);
sl.moveGroup(0, 5, 5);
assert.deepEqual([sl.x[0], sl.x[1], sl.x[2], sl.pin[1]], [0, 15, 25, 1]);
sl.release(1);
assert.equal(sl.x[1], 10, "더블클릭(해제)하면 원래 자리로");

// ---- 공유 이웃(SNN) 그래프로 주제 묶기 ----
const { snnGraph } = await import("../lib/community.js");
const snnE = snnGraph(topKNeighbors(cvec, 10));
assert.ok(snnE.every((e) => e.w > 0 && e.w <= 1));
const lvS = louvain(three.length, snnE, { resolution: 1 });
assert.equal(lvS.sizes.length, 3, "SNN 그래프에서도 세 주제");
assert.ok([0, 3, 6].every((i) => lvS.ids[i] === lvS.ids[0]) && lvS.ids[1] !== lvS.ids[0]);
// 힘 배치(이웃 선 + 주제 응집): 섞인 자리에서 시작해도 같은 주제 점이 모인다
const fl = createLayout(three.map((_, i) => [Math.cos(i * 1.7) * 50, Math.sin(i * 1.3) * 50]), snnE.map((e) => ({ a: e.a, b: e.b, sim: 0.45 + 0.55 * e.w })), { groups: Array.from(lvS.ids), cohesion: 0.012 });
for (let i = 0; i < 200 && fl.tick(); i++);
let wi = 0, wc = 0, bt = 0, bc = 0;
for (let i = 0; i < three.length; i++) for (let j = i + 1; j < three.length; j++) {
  const dd = Math.hypot(fl.x[i] - fl.x[j], fl.y[i] - fl.y[j]);
  if (lvS.ids[i] === lvS.ids[j]) { wi += dd; wc++; } else { bt += dd; bc++; }
}
assert.ok(wi / wc < bt / bc, "같은 주제끼리 모인다");
const before0 = fl.x[0];
fl.moveGroup(lvS.ids[0], 30, 0);
assert.ok(Math.abs(fl.x[0] - (before0 + 30)) < 1e-3, "키워드를 끌면 그 주제의 점이 함께 이동 (힘 배치)");
{
  // 끄는 동안 그 주제는 힘에 밀리지 않고 커서를 그대로 따르고, 놓은 뒤에도 중심이 그 자리에 머문다
  const g0 = lvS.ids[0];
  const mem = [...three.keys()].filter((i) => lvS.ids[i] === g0);
  const cen = (L) => [mem.reduce((s, i) => s + L.x[i], 0) / mem.length, mem.reduce((s, i) => s + L.y[i], 0) / mem.length];
  const mk = () => { const L = createLayout(three.map((_, i) => [Math.cos(i * 1.7) * 50, Math.sin(i * 1.3) * 50]), snnE.map((e) => ({ a: e.a, b: e.b, sim: 0.45 + 0.55 * e.w })), { groups: Array.from(lvS.ids), cohesion: 0.012 }); for (let i = 0; i < 300 && L.tick(); i++); return L; };
  const L = mk();
  const c0 = cen(L);
  for (let f = 0; f < 20; f++) { L.moveGroup(g0, 15, 0); L.tick(); L.tick(); }
  const c1 = cen(L);
  assert.ok(Math.abs(c1[0] - c0[0] - 300) < 1e-2 && Math.abs(c1[1] - c0[1]) < 1e-2, "끄는 동안 주제 중심이 커서와 같이 움직인다");
  L.endGroupDrag();
  for (let i = 0; i < 400 && L.tick(); i++);
  const c2 = cen(L);
  assert.ok(Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) < 1, "놓은 뒤에도 주제 중심이 그 자리에 머문다");
  // 옮긴 주제 안의 점을 멀리 고정했다가 풀어도 주제가 튀지 않는다 (나머지 점은 한 프레임에 거의 그대로)
  {
    const p = mem[0], rest = mem.slice(1);
    const rc = () => [rest.reduce((s, i) => s + L.x[i], 0) / rest.length, rest.reduce((s, i) => s + L.y[i], 0) / rest.length];
    L.fix(p, L.x[p] + 400, L.y[p] - 300);
    const a0 = rc(); L.tick(); const a1 = rc();
    assert.ok(Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) < 1, "점을 고정해도 옮긴 주제가 튀지 않는다");
    L.release(p);
    const b0 = rc(); L.tick(); const b1 = rc();
    assert.ok(Math.hypot(b1[0] - b0[0], b1[1] - b0[1]) < 1, "고정을 풀어도 옮긴 주제가 튀지 않는다");
    for (let i = 0; i < 400 && L.tick(); i++);
    const a2 = rc();
    assert.ok(Math.hypot(a2[0] - a0[0], a2[1] - a0[1]) < 3, "풀린 점이 돌아오는 동안 주제는 조금만 움직인다");
  }
  const c1r = cen(L); // 위에서 점 하나를 고정했다 풀어 아주 조금 움직였으므로 지금 자리 기준
  // 다시 그릴 때 주제가 그대로면 옮긴 자리를 이어받는다
  const K2 = createLayout(three.map(() => [0, 0]), [], { groups: Array.from(lvS.ids), cohesion: 0.012, keep: L, alpha: 0.3 });
  for (let i = 0; i < 400 && K2.tick(); i++);
  const c3 = cen(K2);
  assert.ok(Math.hypot(c3[0] - c1r[0], c3[1] - c1r[1]) < 1, "다시 그려도 옮긴 주제 자리를 이어받는다");
  // 주제가 바뀌면(세밀도 변경 등) 옮긴 자리를 버린다
  const other = Array.from(lvS.ids, (g, i) => (i === mem[0] ? (g + 1) % 3 : g));
  const K3 = createLayout(three.map(() => [0, 0]), [], { groups: other, cohesion: 0.012, keep: L, alpha: 0.3 });
  assert.equal(K3.held.size, 0, "주제가 바뀌면 옮긴 자리를 이어받지 않는다");
  // '고정 풀기' 뒤에는 다시 힘을 받아 움직인다 (가운데 끌림·이웃 선)
  L.releaseGroups();
  assert.equal(L.held.size, 0);
  L.reheat(0.5);
  for (let i = 0; i < 400 && L.tick(); i++);
  const c4 = cen(L);
  assert.ok(Math.hypot(c4[0] - c1[0], c4[1] - c1[1]) > 20, "고정을 풀면 주제가 다시 움직인다");
}
{
  // 주제를 아는 배치: 이웃 선의 2/5가 다른 주제로 가는 섞인 그래프에서도 주제가 갈리되, 섬으로 끊기지 않는다
  // (주제를 모르는 예전 배치: 응집 0.012 → 실루엣 0.05, 응집 0.05 → 0.25)
  const N = 240, G = 4;
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const grp = Array.from({ length: N }, (_, i) => i % G);
  const es = [];
  for (let i = 0; i < N; i++) {
    for (let t = 0; t < 3; t++) { const j = grp[i] + G * Math.floor(rnd() * (N / G)); if (j !== i) es.push({ a: i, b: j, sim: 0.6 }); }
    for (let t = 0; t < 2; t++) { const j = Math.floor(rnd() * N); if (grp[j] !== grp[i]) es.push({ a: i, b: j, sim: 0.6 }); }
  }
  const init = Array.from({ length: N }, () => [rnd() * 200 - 100, rnd() * 200 - 100]);
  const settle = (cohesion) => { const L = createLayout(init, es, { groups: grp, cohesion, alpha: 0.6 }); for (let f = 0; f < 3000 && L.tick(); f++); return L; };
  const sil = (L) => {
    let s2 = 0;
    for (let i = 0; i < N; i++) {
      const sum = new Float64Array(G), cnt = new Float64Array(G);
      for (let j = 0; j < N; j++) if (j !== i) { sum[grp[j]] += Math.hypot(L.x[i] - L.x[j], L.y[i] - L.y[j]); cnt[grp[j]]++; }
      const a = sum[grp[i]] / cnt[grp[i]];
      let b = Infinity; for (let g = 0; g < G; g++) if (g !== grp[i]) b = Math.min(b, sum[g] / cnt[g]);
      s2 += (b - a) / Math.max(a, b);
    }
    return s2 / N;
  };
  /** 근접 그래프(점 간격 중앙값의 3배 안) 덩어리 수와, 다른 주제까지 가장 먼 틈(점 간격 배수) */
  const islandsOf = (L, grp) => {
    const N = grp.length, G = Math.max(...grp) + 1;
    const nn = Array.from({ length: N }, (_, i) => { let b = Infinity; for (let j = 0; j < N; j++) if (j !== i) b = Math.min(b, Math.hypot(L.x[i] - L.x[j], L.y[i] - L.y[j])); return b; }).sort((p, q) => p - q);
    const m = nn[N >> 1];
    const par = Array.from({ length: N }, (_, i) => i);
    const find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) if (Math.hypot(L.x[i] - L.x[j], L.y[i] - L.y[j]) <= 3 * m) par[find(i)] = find(j);
    const comps = new Set(Array.from({ length: N }, (_, i) => find(i))).size;
    let gap = 0;
    for (let g = 0; g < G; g++) {
      let b = Infinity;
      for (let i = 0; i < N; i++) if (grp[i] === g) for (let j = 0; j < N; j++) if (grp[j] !== g) b = Math.min(b, Math.hypot(L.x[i] - L.x[j], L.y[i] - L.y[j]));
      gap = Math.max(gap, b / m);
    }
    return { comps, gap };
  };
  const strong = settle(0.05);
  assert.ok(sil(strong) > 0.35, `주제가 또렷이 갈린다 (실루엣 ${sil(strong).toFixed(2)})`);
  const isl = islandsOf(strong, grp);
  assert.equal(isl.comps, 1, "섬으로 끊기지 않는다 (근접 덩어리 하나)");
  assert.ok(isl.gap < 3, `주제 사이 틈은 점 간격 3배 미만 (${isl.gap.toFixed(2)})`);
  // 멈출 때까지 틱 수: 거의 자리 잡은 뒤(alpha < 0.1)는 빨리 식힌다 → 0.6에서 0.02까지 약 150틱 (예전 0.985만 쓰면 225틱)
  { const L = createLayout(init, es, { groups: grp, cohesion: 0.05, alpha: 0.6 }); let t = 0; while (L.tick()) t++; assert.ok(t > 120 && t < 170, `멈출 때까지 ${t}틱`); }
  // 세밀도를 바꿔 주제가 갈라지면: 이전 자리를 이어받아 덜 움직이고, 갈라진 주제는 그래도 벌어진다
  {
    const nn = (L) => { const v = Array.from({ length: N }, (_, i) => { let b = Infinity; for (let j = 0; j < N; j++) if (j !== i) b = Math.min(b, Math.hypot(L.x[i] - L.x[j], L.y[i] - L.y[j])); return b; }).sort((p, q) => p - q); return v[N >> 1]; };
    const split = grp.map((g, i) => (g === 0 && i % 8 < 4 ? G : g)); // 주제 0을 반으로
    const silOf = (L, lab) => { const K = G + 1; let s2 = 0; for (let i = 0; i < N; i++) { const sum = new Float64Array(K), cnt = new Float64Array(K); for (let j = 0; j < N; j++) if (j !== i) { sum[lab[j]] += Math.hypot(L.x[i] - L.x[j], L.y[i] - L.y[j]); cnt[lab[j]]++; } const a = sum[lab[i]] / cnt[lab[i]]; let b = Infinity; for (let g = 0; g < K; g++) if (g !== lab[i] && cnt[g]) b = Math.min(b, sum[g] / cnt[g]); s2 += (b - a) / Math.max(a, b); } return s2 / N; };
    const before = silOf(strong, split);
    const R = createLayout(init, es, { groups: split, cohesion: 0.05, keep: strong, alpha: 0.25 });
    for (let f = 0; f < 3000 && R.tick(); f++);
    const m = nn(strong);
    const mv = Array.from({ length: N }, (_, i) => Math.hypot(R.x[i] - strong.x[i], R.y[i] - strong.y[i]) / m);
    const same = mv.filter((_, i) => grp[i] !== 0).sort((p, q) => p - q);
    assert.ok(silOf(R, split) > before + 0.03, `갈라진 주제가 벌어진다 (실루엣 ${before.toFixed(2)} → ${silOf(R, split).toFixed(2)})`);
    // 이전 자리 당김(REGROUP_HOLD)이 없으면 이동 중앙값 0.50, 그대로인 주제 0.34 (점 간격 배수)
    const all = [...mv].sort((p, q) => p - q)[N >> 1];
    assert.ok(all < 0.42 && same[same.length >> 1] < 0.3, `덜 움직인다 (중앙값 ${all.toFixed(2)}, 그대로인 주제 ${same[same.length >> 1].toFixed(2)} × 점 간격)`);
    // 이전 자리 당김은 첫 자리 잡기에만: 멈춘 뒤 다시 데워도(점 끌기·고정 풀기) 세밀도 바꾸기 전 자리로 끌려가지 않는다
    {
      const toHome = () => { const v = Array.from({ length: N }, (_, i) => Math.hypot(R.x[i] - strong.x[i], R.y[i] - strong.y[i]) / m).sort((p, q) => p - q); return v[N >> 1]; };
      const d0 = toHome();
      for (let k = 0; k < 3; k++) { R.reheat(0.5); for (let f = 0; f < 3000 && R.tick(); f++); }
      // 당김이 남아 있으면 0.76 (이전 자리 쪽으로 돌아감), 지우면 1.35 (점 간격 배수, 이동 중앙값)
      assert.ok(toHome() > 1.05, `다시 데워도 이전 자리로 당기지 않는다 (${d0.toFixed(2)} → ${toHome().toFixed(2)})`);
    }
  }
  // 보조 주제 댓글은 그 주제를 끌 때 반쯤 따라온다 (주 주제 댓글은 그 자리)
  {
    const extra = grp.map((g, i) => (g === 1 && i % 20 === 1 ? [2] : []));
    const L = createLayout(init, es, { groups: grp, cohesion: 0.05, alpha: 0.6, extra });
    for (let f = 0; f < 3000 && L.tick(); f++);
    const cenOf = (f) => { let sx = 0, c = 0; for (let i = 0; i < N; i++) if (f(i)) { sx += L.x[i]; c++; } return sx / c; };
    const isSec = (i) => extra[i].length > 0, isRest1 = (i) => grp[i] === 1 && !isSec(i);
    const s0 = cenOf(isSec), r0 = cenOf(isRest1), g0 = cenOf((i) => grp[i] === 2);
    for (let f = 0; f < 30; f++) { L.moveGroup(2, 10, 0); L.tick(); L.tick(); }
    L.endGroupDrag();
    const fs2 = (cenOf(isSec) - s0) / 300, fr = (cenOf(isRest1) - r0) / 300;
    assert.ok(cenOf((i) => grp[i] === 2) - g0 > 290, "끈 주제는 커서를 따른다");
    assert.ok(fs2 > 0.3 && fs2 > fr + 0.1, `보조 댓글은 따라온다 (${fs2.toFixed(2)}, 같은 주 주제의 나머지 ${fr.toFixed(2)})`);
  }
  // 어려운 경우: 주제 크기 차이가 큼 / 주제 사이 선이 거의 없음 / 선이 적은 주제 / 둘 다
  const hard = (sizes, { cross = 2, sparse = -1 } = {}) => {
    let sd = 11; const r = () => ((sd = (sd * 1103515245 + 12345) % 2147483648) / 2147483648);
    const gg = sizes.flatMap((m, g) => Array(m).fill(g)), M = gg.length;
    const byG = sizes.map((_, g) => gg.map((v, i) => (v === g ? i : -1)).filter((i) => i >= 0));
    const ee = [];
    for (let i = 0; i < M; i++) {
      for (let t = 0; t < (gg[i] === sparse ? 1 : 3); t++) { const j = byG[gg[i]][Math.floor(r() * byG[gg[i]].length)]; if (j !== i) ee.push({ a: i, b: j, sim: 0.6 }); }
      if (cross >= 1 || r() < cross) for (let t = 0; t < Math.max(1, Math.floor(cross)); t++) { const j = Math.floor(r() * M); if (gg[j] !== gg[i]) ee.push({ a: i, b: j, sim: 0.6 }); }
    }
    const L = createLayout(gg.map(() => [r() * 200 - 100, r() * 200 - 100]), ee, { groups: gg, cohesion: 0.05, alpha: 0.6 });
    for (let f = 0; f < 3000 && L.tick(); f++);
    return islandsOf(L, gg);
  };
  for (const [name, sizes, o] of [["크기 차이 큼", [200, 40, 15, 8], {}], ["주제 사이 선 거의 없음", [60, 60, 60, 60], { cross: 0.02 }],
    ["선이 적은 주제", [80, 80, 80], { sparse: 2 }], ["크기 차이 + 선 적음", [200, 40, 15, 8], { cross: 0.1 }]]) {
    const h = hard(sizes, o);
    assert.equal(h.comps, 1, `섬 없음: ${name} (덩어리 ${h.comps})`);
    assert.ok(h.gap < 3, `섬 없음: ${name} (틈 ${h.gap.toFixed(2)})`);
  }
}
{
  // 선 줄이기: 두 촘촘한 무리(각 5점 완전 그래프, 선 강도 0.9)를 잇는 약한 다리(0.1)는 점마다 3개 기준이면 버려진다 → 다시 잇는다
  const { thinEdges } = await import("../lib/layout.js");
  const es = [];
  for (const base of [0, 5]) for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) es.push({ a: base + i, b: base + j, w: 0.9 });
  es.push({ a: 4, b: 5, w: 0.1 }, { a: 3, b: 6, w: 0.05 });
  const kept = thinEdges(es, 3);
  assert.ok(kept.some((e) => e.a === 4 && e.b === 5), "끊긴 무리를 가장 강한 다리로 다시 잇는다");
  assert.ok(!kept.some((e) => e.a === 3 && e.b === 6), "다리는 하나만 더한다");
  assert.ok(kept.length < es.length, "줄이기는 그대로 한다");
}
{
  // 서로만 닿은 주제 무리(A–B, C–D, 무리 사이 선 0)를 멀리 떨어뜨려 시작해도 하나로 모인다 (주제별 틈 기준으로는 못 잡는 경우)
  let sd = 5; const r = () => ((sd = (sd * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pair = [0, 0, 1, 1];
  const gg = [0, 1, 2, 3].flatMap((g) => Array(60).fill(g)), M = gg.length;
  const ee = [];
  for (let i = 0; i < M; i++) {
    for (let t = 0; t < 3; t++) { const j = gg[i] * 60 + Math.floor(r() * 60); if (j !== i) ee.push({ a: i, b: j, sim: 0.6 }); }
    for (let t = 0; t < 2; t++) { const j = Math.floor(r() * M); if (gg[j] !== gg[i] && pair[gg[j]] === pair[gg[i]]) ee.push({ a: i, b: j, sim: 0.6 }); }
  }
  const L = createLayout(gg.map((g) => [r() * 100 - 50 + (pair[g] ? 300 : -300), r() * 100 - 50]), ee, { groups: gg, cohesion: 0.05, alpha: 0.6 });
  for (let f = 0; f < 3000 && L.tick(); f++);
  const nn = Array.from({ length: M }, (_, i) => { let b = Infinity; for (let j = 0; j < M; j++) if (j !== i) b = Math.min(b, Math.hypot(L.x[i] - L.x[j], L.y[i] - L.y[j])); return b; }).sort((p, q) => p - q);
  const m = nn[M >> 1], par = Array.from({ length: M }, (_, i) => i), find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
  for (let i = 0; i < M; i++) for (let j = i + 1; j < M; j++) if (Math.hypot(L.x[i] - L.x[j], L.y[i] - L.y[j]) <= 3 * m) par[find(i)] = find(j);
  assert.equal(new Set(Array.from({ length: M }, (_, i) => find(i))).size, 1, "서로만 닿은 주제 무리도 섬이 되지 않는다");
}
{
  // 주제 하나(40개)를 600px 끌어 놓으면 그 자리에 두고, 나머지 주제는 따라오지 않는다 (섬 방지 당김이 옮긴 주제를 쫓지 않게)
  let sd = 9; const r = () => ((sd = (sd * 1103515245 + 12345) % 2147483648) / 2147483648);
  const sizes = [150, 150, 40];
  const gg = sizes.flatMap((m, g) => Array(m).fill(g)), M = gg.length;
  const byG = sizes.map((_, g) => gg.map((v, i) => (v === g ? i : -1)).filter((i) => i >= 0));
  const ee = [];
  for (let i = 0; i < M; i++) {
    for (let t = 0; t < 3; t++) { const j = byG[gg[i]][Math.floor(r() * byG[gg[i]].length)]; if (j !== i) ee.push({ a: i, b: j, sim: 0.6 }); }
    const j = Math.floor(r() * M); if (gg[j] !== gg[i]) ee.push({ a: i, b: j, sim: 0.6 });
  }
  const L = createLayout(gg.map(() => [r() * 200 - 100, r() * 200 - 100]), ee, { groups: gg, cohesion: 0.05, alpha: 0.6 });
  for (let f = 0; f < 3000 && L.tick(); f++);
  const restCen = () => { let sx = 0, sy = 0, c = 0; for (let i = 0; i < M; i++) if (gg[i] !== 2) { sx += L.x[i]; sy += L.y[i]; c++; } return [sx / c, sy / c]; };
  const before = restCen();
  for (let f = 0; f < 30; f++) { L.moveGroup(2, 20, 0); L.tick(); L.tick(); }
  L.endGroupDrag();
  for (let i = 0; i < 600; i++) L.tick();
  const after = restCen();
  const moved = Math.hypot(after[0] - before[0], after[1] - before[1]);
  // 600px 끌었을 때 나머지는 주제 사이 선에 끌려 조금만 온다(약 66px). 끈 주제를 쫓아가면 수백 px가 된다.
  assert.ok(moved < 100, `주제 하나를 멀리 끌어 놓아도 나머지는 거의 그대로 (${moved.toFixed(1)}px)`);
}

// ---- 겹침 분류 (여러 주제) ----
const { overlapTopics, OVERLAP_MAX_EXTRA } = await import("../lib/community.js");
{
  // 두 주제 A(0~4), B(5~9), 서로 잘 이어진 덩어리. 다리 점 10(주 주제 A)은 A와 B 양쪽에 비슷하게 이어짐.
  const clique = (xs, w) => { const e = []; for (let p = 0; p < xs.length; p++) for (let q = p + 1; q < xs.length; q++) e.push({ a: xs[p], b: xs[q], w }); return e; };
  const ids = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0];
  const base = [...clique([0, 1, 2, 3, 4], 0.6), ...clique([5, 6, 7, 8, 9], 0.6)];
  // 겹침 없음: 다리 점이 A에만 이어지면 보조 주제 없음
  const none = overlapTopics(ids, [...base, { a: 10, b: 0, w: 0.5 }, { a: 10, b: 1, w: 0.5 }]);
  assert.ok(none.extra.every((x) => x.length === 0), "겹침 없음");
  assert.deepEqual(none.members.get(0), [0, 1, 2, 3, 4, 10]);
  // 두 주제 사이 댓글: A 쪽 2개, B 쪽 2개 → B에도 속함, 주 주제는 그대로
  const bridge = overlapTopics(ids, [...base, { a: 10, b: 0, w: 0.5 }, { a: 10, b: 1, w: 0.5 }, { a: 10, b: 5, w: 0.4 }, { a: 10, b: 6, w: 0.4 }]);
  assert.deepEqual(bridge.extra[10], [1], "두 주제 사이 댓글은 다른 주제에도 속한다");
  assert.ok(bridge.members.get(1).includes(10) && bridge.members.get(0).includes(10), "두 주제 목록 모두에 나온다");
  assert.ok(bridge.extra.slice(0, 10).every((x) => x.length === 0), "덩어리 안쪽 댓글은 겹치지 않는다");
  // 이웃 하나만 걸치면 넣지 않는다 (우연)
  const one = overlapTopics(ids, [...base, { a: 10, b: 0, w: 0.3 }, { a: 10, b: 5, w: 0.3 }]);
  assert.deepEqual(one.extra[10], [], "이웃 하나만 걸친 주제는 넣지 않는다");
  // 최대 개수: 네 주제에 고르게 이어진 점 → 보조는 OVERLAP_MAX_EXTRA개까지, 강한 순
  const ids4 = [0, 0, 1, 1, 2, 2, 3, 3, 0]; // 점 8: 주제 0·1 쪽 1.0씩, 2·3 쪽 0.9씩 → 세 주제가 기준을 넘음
  const e4 = [[0, 0.5], [1, 0.5], [2, 0.5], [3, 0.5], [4, 0.45], [5, 0.45], [6, 0.45], [7, 0.45]].map(([b, w]) => ({ a: 8, b, w }));
  const many = overlapTopics(ids4, e4);
  assert.equal(many.extra[8].length, OVERLAP_MAX_EXTRA, "보조 주제는 최대 개수까지");
  assert.deepEqual(many.extra[8], [1, 2], "강하게 이어진 주제부터");
  // 주제 없는 점(-1: 본문·짧은 반응)은 계산에서 빠진다
  const skip = overlapTopics([-1, 0, 0, 1, 1], [{ a: 0, b: 1, w: 1 }, { a: 0, b: 3, w: 1 }, { a: 1, b: 2, w: 1 }, { a: 3, b: 4, w: 1 }]);
  assert.deepEqual(skip.extra[0], []);
  assert.ok(!skip.members.get(0).includes(0));
  // 결정적
  assert.deepEqual(overlapTopics(ids, base).extra, overlapTopics(ids, base).extra);
  // 엣지 순서를 섞어도 같은 결과 (members 안의 순서까지)
  const bEdges = [...base, { a: 10, b: 0, w: 0.5 }, { a: 10, b: 1, w: 0.5 }, { a: 10, b: 5, w: 0.4 }, { a: 10, b: 6, w: 0.4 }];
  const ref = overlapTopics(ids, bEdges);
  for (const seed of [1, 7, 42]) {
    let x = seed;
    const shuffled = bEdges.map((e) => ({ e, k: (x = (x * 1103515245 + 12345) % 2147483648) })).sort((p, q) => p.k - q.k).map(({ e }) => e);
    const got = overlapTopics(ids, shuffled);
    assert.deepEqual(got.extra, ref.extra, "엣지 순서와 무관 (보조 주제)");
    assert.deepEqual([...got.members.entries()], [...ref.members.entries()], "엣지 순서와 무관 (구성원)");
  }
  const tie = overlapTopics(ids4, [...e4].reverse());
  assert.deepEqual(tie.extra[8], many.extra[8], "같은 힘이면 주제 번호 순 (엣지 순서와 무관)");
}

// ---- 같은 키워드 주제 합치기 ----
const { mergeSameKeywordTopics, topicLinkRatio } = await import("../lib/community.js");
{
  const clique = (xs, w) => { const e = []; for (let p = 0; p < xs.length; p++) for (let q = p + 1; q < xs.length; q++) e.push({ a: xs[p], b: xs[q], w }); return e; };
  const r = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
  // 점 0 = 본문(-1). 주제 0: 1~6, 주제 1: 7~12, 주제 2: 13~18, 주제 3: 19~24
  const ids = [-1, ...r(1, 7).map(() => 0), ...r(7, 13).map(() => 1), ...r(13, 19).map(() => 2), ...r(19, 25).map(() => 3)];
  const base = [...clique(r(1, 7), 0.5), ...clique(r(7, 13), 0.5), ...clique(r(13, 19), 0.5), ...clique(r(19, 25), 0.5)];
  // 주제 0–1: 서로 잘 이어짐 / 주제 2: 0과 다리 하나 / 주제 3: 1과 잘 이어졌지만 키워드가 다름
  const cross = [];
  for (const a of [1, 2, 3, 4]) for (const b of [7, 8, 9]) cross.push({ a, b, w: 0.3 });
  for (const a of [19, 20, 21, 22]) for (const b of [10, 11, 12]) cross.push({ a, b, w: 0.3 });
  const edges = [...base, ...cross, { a: 5, b: 13, w: 0.05 }, { a: 0, b: 1, w: 1 }];
  const KW = { 0: ["가짜뉴스", "처벌"], 1: ["가짜뉴스", "비판"], 2: ["가짜뉴스", "혐오"], 3: ["언론", "기자"] };
  // 키워드는 그 주제에 원래 주제 몫이 가장 많은 쪽을 따른다 (합치면 큰 쪽 이름)
  const kwOf = (cur) => { const out = []; for (let i = 1; i < cur.length; i++) if (cur[i] >= 0 && !out[cur[i]]) out[cur[i]] = KW[ids[i]]; return out; };
  const link = topicLinkRatio(ids, edges);
  assert.ok(link(0, 1) >= 0.5, `잘 이어진 두 주제의 연결 비율 ${link(0, 1)}`);
  assert.ok(link(0, 2) < 0.1, `다리 하나뿐인 주제의 연결 비율 ${link(0, 2)}`);
  assert.equal(link(0, 1), link(1, 0), "대칭");
  const mg = mergeSameKeywordTopics(ids, edges, kwOf);
  assert.equal(mg.ids[0], -1, "본문은 그대로");
  assert.ok(r(1, 13).every((i) => mg.ids[i] === mg.ids[1]), "첫 키워드가 같고 서로 이어진 두 주제는 합친다");
  assert.ok(r(13, 19).every((i) => mg.ids[i] === 2), "첫 키워드가 같아도 거의 안 이어진 주제는 그대로");
  assert.ok(r(19, 25).every((i) => mg.ids[i] === 3), "잘 이어져도 키워드가 다르면 그대로");
  assert.deepEqual(mg.merges.map((m) => m.by), ["keyword1"]);
  // 세밀도가 높을수록(잘게 나눌수록) 합치는 데 더 강한 연결이 필요하다
  const mgFine = mergeSameKeywordTopics(ids, edges, kwOf, { resolution: 2 });
  assert.notEqual(mgFine.ids[1], mgFine.ids[7], "세밀도 2: 연결 비율 0.65 < 1 → 합치지 않음");
  // 앞 두 키워드가 같으면 연결과 무관하게 합친다 (이전 규칙)
  const KW2 = { ...KW, 2: ["처벌", "가짜뉴스"] };
  const mg2 = mergeSameKeywordTopics(ids, edges, (cur) => { const out = []; for (let i = 1; i < cur.length; i++) if (cur[i] >= 0 && !out[cur[i]]) out[cur[i]] = KW2[ids[i]]; return out; });
  assert.ok(r(1, 19).every((i) => mg2.ids[i] === mg2.ids[1]), "앞 두 키워드가 같으면 합친다");
  // 첫 키워드로 합친 주제도, 앞 두 키워드가 같은 다른 주제와 합쳐진다 (A[가짜뉴스,처벌]–B[가짜뉴스,비판] 연결, C[비판,가짜뉴스] 따로)
  const KW3 = { ...KW, 2: ["비판", "가짜뉴스"] };
  const mg3 = mergeSameKeywordTopics(ids, edges, (cur) => { const out = []; for (let i = 1; i < cur.length; i++) if (cur[i] >= 0 && !out[cur[i]]) out[cur[i]] = KW3[ids[i]]; return out; });
  assert.ok(r(1, 19).every((i) => mg3.ids[i] === mg3.ids[1]), `B와 C(앞 두 키워드 같음)가 합쳐지고, 그 묶음이 A와 합쳐진다 (${[...mg3.ids]})`);
  assert.ok(r(19, 25).every((i) => mg3.ids[i] === 3));
  // 결정적, 엣지 순서와 무관
  assert.deepEqual([...mergeSameKeywordTopics(ids, [...edges].reverse(), kwOf).ids], [...mg.ids]);
  // 합친 뒤 겹침을 다시 재면, 두 주제 사이에 걸쳐 있던 점은 더 이상 겹침이 아니다
  const before = overlapTopics(ids, edges), after = overlapTopics(mg.ids, edges);
  assert.ok(before.extra.some((x) => x.length > 0), "합치기 전에는 0–1 사이 겹침이 있다");
  assert.ok(r(1, 13).every((i) => !after.extra[i].includes(mg.ids[1])), "합친 주제는 자기 보조 주제가 되지 않는다");
  assert.ok(after.extra.flat().length < before.extra.flat().length, "합친 뒤 겹침이 줄어든다");
}

// 다리 판: content/youtube.js 의 BRIDGE_V 와 content/page-bridge.js 의 V 가 같아야 이벤트 이름이 맞는다
{
  const yv = fs.readFileSync(new URL("../content/youtube.js", import.meta.url), "utf8").match(/const BRIDGE_V = (\d+);/)?.[1];
  const bv = fs.readFileSync(new URL("../content/page-bridge.js", import.meta.url), "utf8").match(/const V = (\d+);/)?.[1];
  assert.ok(yv && bv, "다리 판 상수를 찾지 못함");
  assert.equal(yv, bv, "youtube.js BRIDGE_V 와 page-bridge.js V 가 다름");
}

// 보정 파일이 확장 안에 없으면 fetch하지 않는다 (콘솔 404 방지)
{
  const { loadCalibrated, packageHas } = await import("../lib/weights.js");
  assert.equal(await packageHas("x"), null, "chrome 없으면 알 수 없음");
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; return { ok: false }; };
  globalThis.chrome = { runtime: { getPackageDirectoryEntry: (cb) => cb({ getFile: (p, _o, ok, fail) => (p === "calibration/weights.json" ? fail(new Error("NotFound")) : ok({})) }) } };
  assert.equal(await packageHas("manifest.json"), true);
  assert.equal(await loadCalibrated(), null);
  assert.equal(fetched, 0, "파일이 없으면 fetch하지 않음");
  delete globalThis.chrome;
  globalThis.fetch = realFetch;
}

// 하이라이트 댓글 토큰 고르기 (page-bridge.js가 씀): 실제 /next 응답 모양(fixtures, 토큰 값만 바꿈)
{
  const { response } = JSON.parse(fs.readFileSync(new URL("../fixtures/youtube-next-linked-comment.json", import.meta.url), "utf8"));
  assert.equal(WV.findCommentToken(response), "comments-section-120", "영상 아래 댓글(comments-section) 토큰을 고른다");
  // 키 순서가 바뀌어도(숨은 패널이 먼저 나와도) 같은 결과
  assert.equal(WV.findCommentToken({ engagementPanels: response.engagementPanels, contents: response.contents }), "comments-section-120");
  // 영상 아래 댓글 구역이 없으면 숨은 댓글 패널 토큰으로 대신한다 (관련 영상·정렬 메뉴 토큰은 고르지 않음)
  const noMain = structuredClone(response);
  noMain.contents.twoColumnWatchNextResults.results.results.contents = [];
  assert.equal(WV.findCommentToken(noMain), "engagement-panel-comments-section-142");
  noMain.engagementPanels = [];
  assert.equal(WV.findCommentToken(noMain), null, "댓글 구역이 없으면 null");
  assert.equal(WV.findCommentToken(null), null);
}

// ---- 주제 나누기 한곳 (lib/topics.js, 패널·검증 스크립트 공용) ----
{
  const { topicPartition, resolutionOf } = await import("../lib/topics.js");
  assert.equal(resolutionOf(50), 1);
  // 점 0 = 본문, 1..9 = 댓글 0..8. 댓글 0~4 한 무리(5개), 5~7 한 무리(3개), 8 = 짧은 반응
  const E = [];
  const clique = (arr) => { for (let p = 0; p < arr.length; p++) for (let q = p + 1; q < arr.length; q++) E.push({ a: arr[p] + 1, b: arr[q] + 1, w: 1 }); };
  clique([0, 1, 2, 3, 4]); clique([5, 6, 7]); E.push({ a: 5, b: 6, w: 0.05 });
  const texts = ["사과 맛있다", "사과 달다", "사과 최고", "사과 좋다", "사과 사자", "배 시원", "배 좋다", "배 달다", "ㅋㅋ"];
  const short = texts.map((_, i) => i === 8);
  const p = topicPartition({ n: 9, graphEdges: E, short, texts, resolution: 1 });
  assert.deepEqual(Array.from(p.ids), [0, 0, 0, 0, 0, 1, 1, 1, -1], "큰 주제가 0번, 짧은 반응은 -1");
  assert.deepEqual(p.groups.map((g) => g.length), [5, 3]);
  assert.equal(p.keywords[0][0], "사과");
  assert.equal(p.ov.extra.length, 10, "겹침은 점 번호 기준(본문 포함)");
}

// ---- 복붙 의심: 평균 유사도는 묶음 안 모든 쌍으로 (사슬처럼 이어진 짧은 응원은 같은 문구가 아님) ----
{
  const { pairMean } = await import("../lib/signals.js");
  const run = (list) => {
    const V = hashEmbed(list.map((c) => c.text));
    const ed = edgesFromNeighbors(topKNeighbors(V, 8), 0.6);
    const cl = clustersFromEdges(list.length, ed);
    const sim = (i, j) => dot(V[i], V[j]);
    return { withSim: clusterSignals(cl.groups, list, ed, { sim }), edgeOnly: clusterSignals(cl.groups, list, ed), V, cl };
  };
  // 사슬: 이웃끼리만 한 낱말씩 겹치는 서로 다른 응원 (실제 뮤직비디오 댓글 모양을 본뜸)
  const W = ["queen", "iconic", "mother", "slay", "legend", "goddess", "vocals", "visual", "comeback", "stream", "forever", "bestgirl", "superstar", "angel"];
  const chain = W.slice(0, -3).map((w, i) => mk(`${w} ${W[i + 1]} ${W[i + 2]} ${W[i + 3]}`, "c" + i)); // 이웃끼리 세 낱말, 두 칸 건너면 두 낱말…
  const r = run(chain);
  assert.equal(r.cl.groups[0].length, 11, "사슬이 한 묶음으로 이어진다");
  assert.equal(r.edgeOnly[0].state, "scored", "(예전) 이어진 쌍만 보면 점수를 낸다");
  assert.ok(r.withSim[0].meanSim < 0.6, "묶음 전체 평균 유사도는 낮다");
  assert.equal(r.withSim[0].state, "natural", "사슬 묶음은 점수를 받지 않는다");
  // 묶는 기준(슬라이더)을 낮춰도: 작은 묶음은 '판단 보류', 사슬 기준은 슬라이더 값을 따른다
  const pair = [mk("오늘 경기 정말 재밌었다 다음에도 꼭 보러 가야지", "s1"), mk("오늘 경기 정말 재밌었다 다음 주에 또 봐요", "s2"), mk("편집이 깔끔해서 보기 좋네요 자막도 좋고요", "s3")];
  for (const th of [0.3, 0.6]) {
    const ps = signalsFor(pair, null, th).sig.filter((x) => x.size === 2);
    if (th === 0.3) assert.equal(ps.length, 1, "문구 기준 0.3에서는 두 댓글(유사도 약 0.4)이 묶인다");
    assert.ok(ps.every((x) => x.state === "hold"), `문구 기준 ${th}: 2개짜리 묶음은 판단 보류 (${ps.map((x) => x.state)})`);
  }
  {
    const V = hashEmbed(chain.map((c) => c.text));
    const ed3 = edgesFromNeighbors(topKNeighbors(V, 8), 0.3), cl3 = clustersFromEdges(chain.length, ed3);
    const s3 = clusterSignals(cl3.groups, chain, ed3, { sim: (i, j) => dot(V[i], V[j]), linkThreshold: 0.3 });
    const big3 = s3.reduce((a, x) => (x.size > a.size ? x : a));
    assert.equal(big3.state === "natural", big3.meanSim < 0.3, `문구 기준 0.3: 평균 ${big3.meanSim.toFixed(2)}이면 사슬 판정은 0.3과 견준다`);
    assert.ok(big3.meanSim >= 0.3 ? big3.state === "scored" : true, "0.3 넘는 평균이면 사슬로 빼지 않고 점수를 낸다");
  }
  // 슬라이더를 0.6보다 올려도: 낱말 하나씩만 바꾼 복사 글(평균 0.76)은 사슬로 빠지지 않고 점수를 받는다
  {
    const base = "이 영상 꼭 끝까지 보세요 진실이 다 나옵니다 주변에 널리 알려 주세요";
    const near = [base, base.replace("꼭", "제발"), base.replace("널리", "많이"), base.replace("주변에", "가족들에게")].map((t, i) => mk(t, "n" + i));
    near.push(mk("오늘 점심은 김치찌개를 먹었는데 맛있었다", "n8"), mk("편집이 깔끔해서 보기 좋네요 자막도 좋고요", "n9"));
    const hi = signalsFor(near, null, 0.8).sig.find((x) => x.size >= 3);
    assert.ok(hi, "문구 기준 0.8에서도 복사 글 묶음이 생긴다");
    assert.equal(hi.state, "scored", `문구 기준 0.8: 거의 같은 복사 글(평균 ${hi.meanSim.toFixed(2)})은 점수를 받는다`);
  }
  // 같은 긴 문구를 여러 작성자가 그대로 쓰면 여전히 점수
  const copy = Array.from({ length: 6 }, (_, i) => mk("이 영상 꼭 끝까지 보세요 진실이 다 나옵니다 주변에 널리 퍼뜨려 주세요", "p" + i));
  copy.push(mk("오늘 점심은 김치찌개를 먹었는데 맛있었다", "q1"), mk("편집이 깔끔해서 보기 좋네요 자막도 좋고요", "q2"));
  const rc = run(copy);
  assert.ok(rc.withSim.some((x) => x.state === "scored" && x.score >= DEFAULT_WEIGHTS.thresholds.flag && x.size === 6), "그대로 복사한 묶음은 점수를 받는다");
  // 결정적: 큰 묶음(표본 추출)도 같은 입력이면 같은 값
  const g = Array.from({ length: 200 }, (_, i) => i), f2 = (i, j) => ((i * 31 + j * 17) % 100) / 100;
  assert.equal(pairMean(g, f2), pairMean(g, f2));
}

// '자동' 모델은 기기(GPU 유무)와 상관없이 Bekko (검증 세트 근거: docs/validation.md)
{
  const sem = await import("../lib/embed/semantic.js");
  assert.equal(await sem.resolveModel("auto"), "bekko");
  assert.equal(await sem.resolveModel("gemma"), "gemma", "직접 고르면 그대로");
  // 묶음에서 NaN이 나온 줄만 하나씩 다시 돌린다 (WebGPU 패딩 문제), 그래도 NaN이면 오류
  const calls = [];
  const flaky = async (texts) => { calls.push(texts.length); return texts.map((x) => (texts.length > 1 && x === "long" ? [NaN, 1] : [1, 0])); };
  assert.deepEqual(await sem.runChecked(flaky, ["a", "long", "b"]), [[1, 0], [1, 0], [1, 0]]);
  assert.deepEqual(calls, [3, 1], "NaN 줄만 따로 한 번");
  await assert.rejects(sem.runChecked(async (x) => x.map(() => [NaN]), ["a"]), /숫자가 아닌 값/);
  // 하나씩 돌려도 NaN이면 그 줄만 대체(CPU)로, 나머지 줄은 그대로
  const fb = [];
  const gpuBad = async (texts) => texts.map((x) => (x === "bad" ? [NaN, 0] : [1, 0]));
  assert.deepEqual(await sem.runChecked(gpuBad, ["a", "bad", "b"], async (xs) => { fb.push(...xs); return xs.map(() => [0, 1]); }), [[1, 0], [0, 1], [1, 0]]);
  assert.deepEqual(fb, ["bad"], "대체는 문제 줄만");
  await assert.rejects(sem.runChecked(gpuBad, ["bad"], async (xs) => xs.map(() => [NaN, 0])), /숫자가 아닌 값/, "대체도 NaN이면 오류");
  // CPU 대체는 GPU·CPU가 같은 가중치 파일인 모델만 (Qwen3은 GPU q4f16 / CPU q8 → 대체 없음, 오류 → 문구 기준)
  for (const [k, m] of Object.entries(sem.MODELS)) if (m.cpuFallback) assert.equal(m.dtype.webgpu, m.dtype.wasm, `${k}: 같은 가중치일 때만 CPU 대체`);
  assert.equal(sem.MODELS.bekko.cpuFallback, true);
  assert.ok(!sem.MODELS.qwen3.cpuFallback && !sem.MODELS.gemma.cpuFallback, "재지 않은 모델은 대체하지 않음");
}

// 분석 계산 한곳 (lib/pipeline.js): Worker와 메인 대체 경로가 같은 함수를 쓴다
{
  const P = await import("../lib/pipeline.js");
  const { koreanTopics } = await import("./ko-topics.mjs");
  const ko = koreanTopics({ seed: 3 });
  const pComments = ko.texts.map((text, i) => ({ id: "k" + i, parentId: i % 9 === 4 ? "k" + (i - 1) : null, author: "u" + (i % 97), authorId: "@u" + (i % 97), text, likes: (i * 13) % 50, createdAtRaw: "1일 전", createdAtApprox: new Date(Date.parse("2026-11-20") + i * 6e4).toISOString() }));
  pComments.push({ id: "s1", parentId: null, author: "x", authorId: "@x", text: "ㅋㅋ", likes: 0, createdAtRaw: "", createdAtApprox: null });
  const pDoc = { title: "점검", text: "설명" };
  const fakeEmbed = async (texts) => ({ vecs: (await import("../lib/embed/hash.js")).hashEmbed(texts, { dim: 128 }), where: "CPU", modelName: "가짜" });
  const statuses = [];
  const A = await P.analyzeComments({ doc: pDoc, comments: pComments, useSemantic: true }, { embed: fakeEmbed, onStatus: (m) => statuses.push(m), pause: async () => {} });
  const B = await P.analyzeComments({ doc: pDoc, comments: structuredClone(pComments), useSemantic: true }, { embed: fakeEmbed });
  const strip = (r) => ({ ...r, times: null });
  assert.deepEqual(strip(A), strip(B), "같은 입력이면 같은 결과 (양보 방식과 상관없이)");
  assert.equal(A.semantic, true); assert.equal(A.modelName, "가짜");
  assert.equal(A.x.length, pComments.length + 1);
  assert.equal(A.short[pComments.length - 1], true);
  assert.ok(statuses[0].startsWith("문구 비교 중") && statuses.includes("지도 그리는 중"));
  // Worker로 넘길 수 있는 값만 (structuredClone 그대로 같음)
  assert.deepEqual(structuredClone(strip(A)), strip(A));
  // 첫 주제·세밀도 단추·평가 낱말은 따로 계산한 것과 같다
  const texts = pComments.map((c) => c.text);
  assert.deepEqual(A.firstTopics, P.topicsAt({ n: pComments.length, graphEdges: A.graphEdges, short: A.short, texts }, P.FIRST_RES));
  assert.deepEqual(A.presets, P.presetCounts(pComments.length, A.graphEdges));
  assert.deepEqual(A.presets.map((p) => p[1]), [20, 50, 75, 100]);
  assert.deepEqual(A.tone.words, P.toneWords(A.tone.rows, texts));
  // 의미 모델이 실패하면 문구 기준 + 안내
  const C = await P.analyzeComments({ doc: pDoc, comments: pComments, useSemantic: true }, { embed: async () => { throw new Error("없음"); }, pause: async () => {} });
  assert.equal(C.semantic, false); assert.match(C.notes[0], /문구 기준/);
  const D = await P.analyzeComments({ doc: pDoc, comments: pComments, useSemantic: false }, { pause: async () => {} });
  assert.deepEqual(strip(C).graphEdges, D.graphEdges, "실패 시 결과는 문구만으로 분석한 것과 같다");
  // 벡터 펴기/나눠 보기
  const fv = P.flattenVectors(A.lexVecs);
  const back = P.viewVectors(fv);
  assert.equal(back.length, A.lexVecs.length);
  assert.deepEqual(Array.from(back[5]), Array.from(A.lexVecs[5]));
  assert.equal(back[5].buffer, fv.flat.buffer, "복사하지 않는다");
  assert.deepEqual(P.viewVectors(P.flattenVectors([])), []);
}

// 분석 Worker 처리 함수 (lib/worker-core.js)
{
  const { createHandler } = await import("../lib/worker-core.js");
  const P = await import("../lib/pipeline.js");
  const h = createHandler({ loadSemantic: async () => ({ MODELS: { m: { name: "가짜" } }, semanticEmbed: async (texts) => ({ vecs: (await import("../lib/embed/hash.js")).hashEmbed(texts, { dim: 64 }), where: "GPU", model: "m" }) }) });
  const wc = Array.from({ length: 40 }, (_, i) => ({ id: "w" + i, parentId: null, author: "a" + (i % 7), authorId: "@a" + (i % 7), text: ["고양이 사료 추천 부탁해요 " + i, "주식 시장 전망 궁금합니다 " + i, "축구 경기 결과 대박 " + i][i % 3], likes: i, createdAtRaw: "", createdAtApprox: null }));
  const out = [];
  const post = (m, tr) => out.push({ m, tr });
  await h({ type: "analyze", run: 7, doc: { title: "t", text: "" }, comments: wc, useSemantic: true, mode: "auto" }, post);
  const done = out.find((o) => o.m.type === "done");
  assert.ok(out.some((o) => o.m.type === "status" && o.m.run === 7), "진행 문구를 보낸다");
  assert.equal(done.m.run, 7); assert.equal(done.m.result.where, "GPU"); assert.equal(done.m.result.modelName, "가짜");
  assert.deepEqual(done.tr, [done.m.result.lexVecs.flat.buffer], "문구 벡터는 transfer로");
  const direct = await P.analyzeComments({ doc: { title: "t", text: "" }, comments: wc, useSemantic: true }, { embed: async (x) => ({ vecs: (await import("../lib/embed/hash.js")).hashEmbed(x, { dim: 64 }), where: "GPU", modelName: "가짜" }), pause: async () => {} });
  assert.deepEqual(done.m.result.graphEdges, direct.graphEdges, "Worker와 직접 계산이 같다");
  assert.deepEqual(done.m.result.firstTopics, direct.firstTopics);
  out.length = 0;
  await h({ type: "topics", run: 8, key: 7, v: 80 }, post);
  assert.equal(out[0].m.type, "topics");
  assert.deepEqual(out[0].m.part, P.topicsAt({ n: 40, graphEdges: direct.graphEdges, short: direct.short, texts: wc.map((c) => c.text) }, 80));
  out.length = 0;
  await h({ type: "topics", run: 9, key: "모름", v: 50 }, post);
  assert.equal(out[0].m.code, "no-input", "모르는 입력이면 data를 달라고 한다");
  await h({ type: "topics", run: 10, key: "모름", v: 50, data: { n: 40, graphEdges: direct.graphEdges, short: direct.short, texts: wc.map((c) => c.text) } }, post);
  assert.deepEqual(out[1].m.part, direct.firstTopics);
  await h({ type: "?", run: 11 }, post);
  assert.equal(out[2].m.type, "error");
}

console.log("all tests passed");
