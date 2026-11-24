// 패널 스크립트 연기 점검: 브라우저 없이, 화면 요소를 '무엇이든 받아주는 가짜'로 바꿔 끼우고
// 분석 → 다시 계산 → 작성자 지도 → 상세 → 넘겨주기까지 실제 코드 경로를 한 번씩 돌린다.
// 화면이 어떻게 보이는지는 확인하지 못한다. 데이터 처리 중 예외가 나는지만 잡는다.
import assert from "node:assert/strict";

function stub() {
  const store = {};
  const f = function () {};
  return new Proxy(f, {
    get(_t, k) {
      if (k in store) return store[k];
      if (k === Symbol.toPrimitive) return () => "";
      if (k === Symbol.iterator) return function* () {};
      if (k === "then") return undefined;
      if (k === "length") return 0;
      return (store[k] = stub());
    },
    set(_t, k, v) { store[k] = v; return true; },
    apply() { return stub(); },
    construct() { return stub(); },
  });
}
const els = new Map();
const byId = (id) => { if (!els.has(id)) els.set(id, stub()); return els.get(id); };
const doc = stub();
doc.getElementById = byId;
globalThis.document = doc;
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.location = { search: "" };
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 400;
globalThis.ResizeObserver = class { observe() {} };
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => "#000" });

// 가짜 댓글 데이터: 복붙 묶음, 답글 스레드, 다작 작성자 포함
const now = Date.parse("2026-11-24T00:00:00Z");
const comments = [];
const add = (id, author, text, extra = {}) => comments.push({ id, docId: "youtube:VID", parentId: null, author, authorId: "@" + author, text, likes: 0, createdAtRaw: "3일 전", createdAtApprox: new Date(now - 3 * 86400e3).toISOString(), edited: false, meta: {}, ...extra });
for (let i = 0; i < 120; i++) add(`c${i}`, `user${i % 70}`, `${["영상 편집이 정말 깔끔해서 보기 좋았습니다", "이 주제는 더 깊이 다뤄 주면 좋겠어요", "배경 음악 제목이 궁금합니다 알려주세요", "설명이 쉬워서 이해가 잘 됐어요", "출처를 같이 적어 주시면 좋겠습니다"][i % 5]} ${i} 번째 생각 ${i * 17}`, { likes: (i * 37) % 400 });
for (let i = 0; i < 6; i++) add(`dup${i}`, `copy${i}`, "이 내용은 반드시 널리 알려야 한다고 생각합니다 모두 공유해 주세요", { likes: 3 });
for (let i = 0; i < 4; i++) add(`self${i}`, "repeater", "제 채널에도 비슷한 자료를 올려 두었으니 꼭 한번 들러 주세요", {});
add("P", "starter", "여기에 대해 다들 어떻게 생각하시는지 궁금합니다 의견 주세요", { likes: 50, meta: { replyCount: 6 } });
for (let i = 0; i < 6; i++) add(`P.r${i}`, `rep${i}`, "저도 완전히 같은 생각입니다 이건 정말 한심한 일이라고 봅니다", { parentId: "P", createdAtRaw: "2시간 전", createdAtApprox: new Date(now - 2 * 3600e3).toISOString() });
const fixture = { doc: { id: "youtube:VID", site: "youtube", url: "https://www.youtube.com/watch?v=VID", title: "점검용 영상", author: "점검 채널", text: "설명", meta: { videoId: "VID", totalComments: 5000, collection: { sort: "mix" } } }, comments };

let tabUrl = "https://www.youtube.com/watch?v=VID";
const sent = [];
globalThis.chrome = {
  runtime: { getManifest: () => ({ version: "test" }), onMessage: { addListener() {} }, sendMessage: async () => undefined, getURL: (p) => p },
  tabs: {
    query: async () => [{ id: 1, url: tabUrl, index: 0, windowId: 1 }],
    get: async () => ({ id: 1, url: tabUrl, index: 0, windowId: 1 }),
    sendMessage: async (_id, msg) => { sent.push(msg); return msg.type === "WV_COLLECT_ALL" ? { ok: true, data: structuredClone(fixture) } : { ok: true }; },
    onUpdated: { addListener() {} }, onActivated: { addListener() {} }, update: async () => {}, create: async () => {},
  },
  windows: { update: async () => {} },
  scripting: { executeScript: async () => {} },
};

let api = null;
globalThis.__WV_TEST__ = (a) => (api = a);
// 주제 목록 줄과 목록 드롭다운 항목을 붙잡아 둔다 (가짜 요소라 화면에는 안 남음)
let topicLis = [], listOpts = [];
byId("topics").replaceChildren = (...k) => { topicLis = k; };
byId("clist-topic").replaceChildren = (...k) => { listOpts = k; };
// 가짜 Worker: 실제 Worker 처리 함수(lib/worker-core.js)를 같은 스레드에서 비동기로 부르고, 메시지는 structuredClone으로 오간다.
// workerMode = "crash"면 Worker가 죽은 것처럼 onerror → 패널이 같은 계산을 직접 해야 한다(대체 경로).
const { createHandler } = await import("../lib/worker-core.js");
let workerMode = "ok";
const workerMsgs = [];
globalThis.Worker = class {
  constructor(url, opts) {
    assert.ok(String(url).endsWith("/lib/analysis-worker.js") && opts?.type === "module", "같은 확장 안의 module Worker");
    this.h = createHandler({ loadSemantic: async () => { throw new Error("Node에는 의미 모델이 없음"); } });
  }
  postMessage(m) {
    const msg = structuredClone(m);
    workerMsgs.push(msg.type);
    setTimeout(() => {
      if (workerMode === "crash") { this.onerror?.({ message: "죽음", preventDefault() {} }); return; }
      this.h(msg, (out, tr) => this.onmessage?.({ data: structuredClone(out, { transfer: tr || [] }) }));
    }, 0);
  }
  terminate() {}
};
const panelMod = await import("../sidepanel/sidepanel.js");
assert.ok(api, "패널 스크립트가 끝까지 실행됨");
await new Promise((r) => setTimeout(r, 50)); // 모델·가중치 초기화 대기

// 1) 분석 실행 (의미 모델은 Node에 없으므로 문구 기준 경로)
await byId("btn-all").onclick();
const status = String(byId("status").textContent);
assert.ok(status.includes("분석 완료"), `분석이 끝까지 돌아야 함: ${status}`);
let { S, V } = api.state();
assert.equal(S.comments.length, comments.length);
assert.ok(V.signals.some((s) => s.state === "scored" && s.score >= 50), "복붙 묶음이 점수를 받음");
assert.ok(V.aSignals.find((a) => a.key === "@repeater").score >= 30, "되풀이 작성자가 점수를 받음");
assert.ok(V.piles.length >= 1, "비슷한 답글이 몰린 스레드를 찾음");
assert.equal(api.state().shown, "comments");
assert.deepEqual(workerMsgs, ["analyze"], "분석은 Worker에서");

// 1-1) 세밀도 바꾸기도 Worker에서 계산하고, Worker가 죽으면 패널에서 같은 계산을 한다 (결과 같음)
{
  const fp = () => { const { S, V } = api.state(); return JSON.stringify({ e: S.graphEdges, x: S.x, ln: S.lexNbrs, ids: Array.from(V.topic.ids), kw: V.topics.map((t) => t.keywords), sg: V.signals.map((x) => [x.state, x.score, x.indices]), pr: S.presets, tw: S.tone.words, lx: S.lexVecs.slice(0, 5).map((v) => Array.from(v)) }); };
  const viaWorker = fp();
  byId("res-range").value = 75;
  await byId("res-range").onchange();
  assert.deepEqual(workerMsgs, ["analyze", "topics"], "세밀도를 바꾸면 Worker가 주제를 나눈다");
  const k75 = api.state().V.K;
  byId("res-range").value = 50;
  await byId("res-range").onchange();
  assert.equal(workerMsgs.length, 2, "처음 세밀도는 분석 때 함께 계산해 두었다");
  workerMode = "crash";
  await byId("btn-all").onclick();
  assert.ok(String(byId("status").textContent).includes("분석 완료"), "Worker가 죽어도 분석이 끝난다");
  assert.equal(fp(), viaWorker, "Worker와 패널 계산 결과가 같다");
  byId("res-range").value = 75;
  await byId("res-range").onchange();
  assert.equal(api.state().V.K, k75, "세밀도 다시 나누기도 같다");
  byId("res-range").value = 50;
  await byId("res-range").onchange();
  ({ S, V } = api.state());
}

// 주제: 이웃 그래프의 커뮤니티로 나뉘고, 짧은 반응은 따로 모인다. 지도 좌표는 댓글마다 하나씩.
assert.ok(V.K >= 2 && V.topics.length >= V.K, "주제가 여러 개로 나뉨");
assert.ok(V.topics.every((t) => t.short || t.keywords.length), "주제마다 키워드");
assert.equal(S.x.length, comments.length + 1);
assert.ok(S.x.every(Number.isFinite) && S.y.every(Number.isFinite), "지도 좌표가 모두 유효");
const labelSets = V.topics.filter((t) => !t.short && t.keywords.length >= 2).map((t) => t.keywords.slice(0, 2).sort().join("|"));
assert.equal(new Set(labelSets).size, labelSets.length, "키워드가 같은 주제는 하나로 합쳐진다");

// 2) 문구 기준·세밀도를 바꿔도 점의 위치(손으로 옮긴 것 포함)는 그대로
const before = V.commentLayout;
before.fix(5, 11, 22);
byId("th-lex").value = 0.7;
api.rebuild();
V = api.state().V;
assert.equal(V.commentLayout.x[5], 11, "문구 기준을 바꿔도 손으로 옮긴 위치 유지");
const x9 = V.commentLayout.x[9], kBefore = V.K;
byId("res-range").value = 100;
api.rebuild();
V = api.state().V;
assert.equal(V.commentLayout.x[5], 11, "세밀도를 바꿔도 손으로 옮긴 위치 유지");
assert.equal(V.commentLayout.x[9], x9, "세밀도를 바꿔도 다른 점의 위치는 그대로 (색만 다시 나눔)");
assert.ok(V.K >= kBefore, "더 잘게 나누면 주제 수가 줄지 않는다");
// 키워드를 끌면 그 주제의 점이 함께 움직인다
const g0 = V.topic.ids[0];
const mx = V.commentLayout.x[1];
V.commentLayout.moveGroup(g0, 40, 0);
assert.equal(V.commentLayout.x[1], mx + 40);

// 2-1) 댓글 목록: 첫 주제가 기본, 지도 점 → 목록, 목록 → 지도, 여러 개 고르기
{
  let st = api.state();
  const t0 = st.V.topics[0];
  assert.equal(st.listSrc, "t" + t0.cluster, "목록은 처음에 가장 큰 주제");
  assert.deepEqual([...st.listRows].sort((a, b) => a - b), [...t0.members].sort((a, b) => a - b), "목록 = 그 주제의 댓글 (겹침 포함)");
  // 겹침: 주 주제 댓글은 모두 들어 있고, 보조로 들어온 댓글은 extraOf에 그 주제가 있다
  for (const t of st.V.topics) {
    assert.ok(t.indices.every((i) => t.members.includes(i)));
    assert.equal(t.members.length, t.indices.length + t.extra);
    for (const i of t.members.slice(t.indices.length)) assert.ok(st.V.extraOf[i].includes(t.cluster) && st.V.topic.ids[i] !== t.cluster);
  }
  assert.ok(st.V.extraOf.every((x) => x.length <= 2), "보조 주제는 2개까지");
  // 주제를 통째로 골라 '내 분류'에 담으면 주 주제 댓글만 담긴다 (보조 댓글은 강조만, 다른 분류에서 옮겨지지 않음)
  const tx = st.V.topics.find((t) => t.extra > 0);
  assert.ok(tx, "점검용 데이터에 겹치는 댓글이 있어야 함");
  const sec = tx.members[tx.members.length - 1];
  api.graph.select([sec + 1]);
  api.graph.tagSelection(1); // 보조 댓글을 먼저 분류 2에
  api.graph.select(tx.members.map((i) => i + 1), { tagOnly: tx.indices.map((i) => i + 1) });
  api.graph.tagSelection(0);
  const tg = api.graph.tagsArray();
  assert.ok(tx.indices.every((i) => tg[i + 1] === 0), "주 주제 댓글은 분류 1에 담김");
  assert.equal(tg[sec + 1], 1, "보조 댓글은 원래 분류(2)에 그대로");
  api.graph.select([sec + 1]);
  api.graph.tagSelection(-1 + 1); // 직접 고른 점은 그대로 담긴다
  assert.equal(api.graph.tagsArray()[sec + 1], 0);
  tg.fill(-1);
  const other = st.V.topics.find((t) => t.cluster !== t0.cluster);
  const j = other.indices[0];
  api.revealInList(j);
  st = api.state();
  assert.equal(st.listSrc, "t" + other.cluster, "목록에 없는 점을 누르면 그 댓글의 주제로 바뀐다");
  assert.ok(st.listRows.includes(j) && st.listActive === j, "누른 댓글이 목록에서 강조된다");
  api.pickFromList(t0.indices[0]);
  assert.equal(api.state().listActive, t0.indices[0]);
  assert.equal(api.graph.marked(), t0.indices[0] + 1, "목록에서 누른 점은 굵은 테로 표시");
  api.graph.select([1]);
  assert.equal(api.graph.marked(), -1, "선택이 바뀌면 굵은 테는 사라진다");
  api.listFromSelection([1, 2, 3]);
  st = api.state();
  assert.equal(st.listSrc, "sel");
  assert.deepEqual(st.listRows.slice().sort((a, b) => a - b), [0, 1, 2], "지도에서 고른 댓글이 목록이 된다");
  api.pickFromList(1);
  assert.equal(api.state().listSrc, "sel", "고른 댓글 목록에서 줄을 눌러도 목록·지도 선택이 그대로");
  api.listFromSelection([3]);
  st = api.state();
  assert.equal(st.listSrc, "t" + st.V.topic.ids[2], "선택이 1개로 줄면 그 댓글의 주제 목록으로");
  api.listFromSelection([1, 2, 3]);
  api.listFromSelection([]);
  assert.notEqual(api.state().listSrc, "sel", "고른 것을 풀면 주제 목록으로 돌아간다");
  // 주제 탭에서 주제를 누르면 목록이 그 주제가 되고, 같은 내용의 '지도에서 고른 댓글' 항목은 남지 않는다
  api.listFromSelection([1, 2, 3]);
  assert.ok(listOpts.some((o) => o.value === "sel"));
  topicLis[0].onclick();
  assert.equal(api.state().listSrc, "t" + st.V.topics[0].cluster, "주제를 누르면 목록이 그 주제로");
  assert.ok(!listOpts.some((o) => o.value === "sel"), "주제를 눌렀을 때 '지도에서 고른 댓글' 항목이 생기지 않는다");
  topicLis[0].onclick(); // 다시 눌러 풂
  // 지도 필터를 목록도 따른다
  const big = st.V.topics.find((t) => t.members.some((i) => comments[i].parentId) && t.members.some((i) => !comments[i].parentId)) || st.V.topics[0];
  api.setList("t" + big.cluster);
  byId("filter").value = "reply";
  await byId("filter").onchange();
  assert.ok(api.state().listRows.every((i) => comments[i].parentId), "답글만 보기면 목록도 답글만");
  byId("filter").value = "top";
  await byId("filter").onchange();
  assert.ok(api.state().listRows.every((i) => !comments[i].parentId), "댓글만 보기면 목록도 원댓글만");
  byId("filter").value = "all";
  await byId("filter").onchange();
  // 최근 순
  byId("clist-sort").value = "new";
  api.setList("t" + big.cluster);
  const rr = api.state().listRows;
  assert.ok(rr.every((i, k) => k === 0 || String(comments[rr[k - 1]].createdAtApprox) >= String(comments[i].createdAtApprox)), "최근 순 정렬");
  byId("clist-sort").value = "likes";
  // 보이는 줄만 그린다: 목록 높이 360px / 줄 68px → 앞뒤 여유 포함 많아야 14줄
  const pad = byId("clist-pad");
  let drawn = 0;
  pad.replaceChildren = (...kids) => { drawn = kids.length; };
  api.setList("t" + st.V.topics[0].cluster);
  assert.ok(drawn > 0 && drawn <= 14 && drawn <= api.state().listRows.length, `보이는 줄만 그림 (${drawn}줄)`);
}

// 3) 상세 카드, 답글, 색 기준 전환
const replyIdx = comments.findIndex((c) => c.parentId);
api.showDetail(replyIdx);
api.showDetail(0);
byId("color-by").value = "tone";
api.drawMap();
byId("color-by").value = "topic";
api.drawMap();

// 4) 작성자 지도 왕복, 이름 가리기 끄기
api.setMapMode("authors");
assert.equal(api.state().shown, "authors");
assert.equal(byId("clist").hidden, true, "작성자 지도에서는 댓글 목록을 숨김");
api.showAuthor(0);
api.rebuild();
api.setMapMode("comments");
assert.equal(api.state().shown, "comments");
byId("mask").checked = false;
api.rebuild();

// 5) 크게 보기로 넘겨줄 상태는 JSON으로 직렬화 가능해야 한다
const snap = JSON.parse(JSON.stringify(api.snapshot()));
assert.equal(snap.S.comments.length, comments.length);
assert.equal(snap.pos.x.length, comments.length + 1);
assert.equal(snap.S.x.length, comments.length + 1, "지도 좌표도 함께 넘어감");
assert.equal(snap.lexVecs.n, comments.length, "문구 벡터도 함께 넘어감 (복붙 묶음의 평균 유사도 계산용)");
assert.equal(snap.S.lexVecs, undefined, "벡터는 S 안에 Float32Array로 넘기지 않는다");

// 6) 댓글 위치로 이동: 답글이면 원댓글 id도 함께 보낸다
api.showDetail(replyIdx);
await api.gotoComment();
const focus = sent.find((m) => m.type === "WV_FOCUS");
assert.equal(focus.parentId, "P");
// 화면에 없다고 하면 YouTube 내부 이동을 실행하고, 하이라이트 댓글이 뜨기를 기다린다
sent.length = 0;
chrome.tabs.sendMessage = async (_id, msg) => { sent.push(msg); return msg.type === "WV_FOCUS" ? { ok: false, need: "navigate", t: 42, paused: false } : msg.type === "WV_COLLECT_ALL" ? { ok: true, data: structuredClone(fixture) } : { ok: true }; };
let injected = null;
const injections = [];
chrome.scripting.executeScript = async (opts) => { injections.push(opts); if (opts.func) injected = opts; return [{ result: true }]; };
await api.gotoComment();
assert.equal(injected.world, "MAIN");
assert.ok(injections.some((o) => o.world === "MAIN" && o.files?.includes("content/page-bridge.js")), "댓글을 열기 전에 페이지 쪽 다리를 넣어 준다");
assert.deepEqual(injected.args, ["VID", comments[replyIdx].id]);
assert.equal(sent.find((m) => m.type === "WV_FOCUS_WAIT").t, 42, "보던 위치를 함께 전달");
// 다른 영상이 열려 있으면 이동하지 않고 안내
tabUrl = "https://www.youtube.com/watch?v=OTHER";
sent.length = 0;
await api.gotoComment();
assert.equal(sent.filter((m) => m.type === "WV_FOCUS").length, 0, "다른 영상에서는 이동 요청을 보내지 않음");
await api.checkVideo();
assert.equal(byId("video-changed").hidden, false, "영상이 바뀌면 안내 띠가 보임");

// 7) 같은 창에서 두 번째 영상(댓글이 더 적음) 분석 → 영상 간 교차 계산 경로
//    목록이 이전 영상의 큰 번호를 가리키고 있어도 새 분석이 끝까지 그려져야 한다
{
  const st = api.state();
  const far = st.V.topics.find((t) => t.members.some((i) => i >= 40));
  api.setList("t" + far.cluster);
  assert.ok(api.state().listRows.some((i) => i >= 40));
}
fixture.doc.meta.videoId = "OTHER"; fixture.doc.title = "두 번째 영상";
fixture.comments = comments.slice(0, 40);
await byId("btn-all").onclick();
assert.ok(String(byId("status").textContent).includes("분석 완료"), `두 번째 분석이 끝까지: ${byId("status").textContent}`);
assert.equal(api.state().S.comments.length, 40);
assert.ok(api.state().listRows.every((i) => i < 40), "목록은 새 영상의 댓글만");
assert.equal(byId("video-changed").hidden, true, "새 영상을 분석하면 안내 띠가 사라짐");

// 스크립트 넣기 오류 안내: 잠든 탭 = '아직 안 열림', 네트워크 오류 페이지 = '새로고침' (같은 문구로 뭉뚱그리지 않음)
{
  const ex = panelMod.explainInjectError;
  assert.match(ex(new Error("Cannot access contents of the page. Extension manifest must request permission")).message, /아직 열리지 않았어요/);
  assert.match(ex(new Error("Frame with ID 0 is showing error page")).message, /제대로 열리지 않았어요/);
  const other = new Error("Something else");
  assert.equal(ex(other), other);
}
// 요청 제한으로 중간에 멈춘 수집: 모은 댓글로 분석하고 '요청 제한' 안내를 띄운다(댓글이 꺼졌다는 틀린 안내가 아니라)
{
  fixture.doc.meta.collection = { sort: "random", limited: true, complete: false, pool: { size: 200, limit: 900, complete: false } };
  await byId("btn-all").onclick();
  const st = String(byId("status").textContent);
  assert.ok(st.includes("분석 완료") && st.includes("요청을 계속 받지 않아서"), `limited 안내: ${st}`);
  assert.ok(!st.includes("댓글이 꺼진"), "댓글이 꺼졌다는 안내는 없음");
}
console.log("panel smoke passed");
