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
await import("../sidepanel/sidepanel.js");
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

// 2) 기준값 변경 → 다시 계산, 손 배치(레이아웃 객체) 유지
const before = V.commentLayout;
before.fix(5, 11, 22);
byId("th-lex").value = 0.7;
api.rebuild();
V = api.state().V;
assert.equal(V.commentLayout.x[5], 11, "기준값을 바꿔도 손으로 옮긴 위치 유지");

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

// 6) 댓글 위치로 이동: 답글이면 원댓글 id도 함께 보낸다
api.showDetail(replyIdx);
await api.gotoComment();
const focus = sent.find((m) => m.type === "WV_FOCUS");
assert.equal(focus.parentId, "P");
// 다른 영상이 열려 있으면 이동하지 않고 안내
tabUrl = "https://www.youtube.com/watch?v=OTHER";
sent.length = 0;
await api.gotoComment();
assert.equal(sent.filter((m) => m.type === "WV_FOCUS").length, 0, "다른 영상에서는 이동 요청을 보내지 않음");
await api.checkVideo();
assert.equal(byId("video-changed").hidden, false, "영상이 바뀌면 안내 띠가 보임");

// 7) 같은 창에서 두 번째 영상 분석 → 영상 간 교차 계산 경로
fixture.doc.meta.videoId = "OTHER"; fixture.doc.title = "두 번째 영상";
await byId("btn-all").onclick();
assert.ok(String(byId("status").textContent).includes("분석 완료"));
assert.equal(byId("video-changed").hidden, true, "새 영상을 분석하면 안내 띠가 사라짐");

console.log("panel smoke passed");
