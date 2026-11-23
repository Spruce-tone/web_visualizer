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
function signalsFor(list, doc = null, th = 0.6) {
  const nb = topKNeighbors(hashEmbed(list.map((c) => c.text)), 8);
  const ed = edgesFromNeighbors(nb, th);
  const cl = clustersFromEdges(list.length, ed);
  return { sig: clusterSignals(cl.groups, list, ed, { doc }), cl, ed };
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
const kwD = topicKeywords([[0, 1, 2], [3, 4, 5]], ["민주당 탄핵 추진 반대", "민주당 탄핵 무리", "민주당 탄핵 절차", "민주당 경제 정책 실패", "민주당 경제 물가", "민주당 경제 대책"]);
assert.ok(!kwD[0].includes("민주당") && !kwD[1].includes("민주당"), `흔한 낱말 제외 (${kwD})`);
assert.ok(kwD[0].includes("탄핵"));
assert.ok(kwD[1].includes("경제"));

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
assert.equal(fl.x[0], before0 + 30, "키워드를 끌면 그 주제의 점이 함께 이동 (힘 배치)");

console.log("all tests passed");
