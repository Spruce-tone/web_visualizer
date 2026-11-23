// 역할 분리
// - 문구 임베딩(n-gram 해싱, 항상 계산, 즉시): 복붙·템플릿 의심 신호
// - 의미 임베딩(자동 선택: GPU → EmbeddingGemma, CPU → Bekko): 지도 배치, 주제 묶음(색), 본문 관련도
//   의미 모델을 못 쓰면 문구 임베딩으로 대체한다.
// 이 페이지는 사이드 패널로도, "크게 보기" 탭(?tab=<YouTube 탭 id>)으로도 열린다.
import { hashEmbed } from "../lib/embed/hash.js";
import {
  dot, topKNeighbors, edgesFromNeighbors, clustersFromEdges, pca2,
  thresholdPresets, thresholdForTopicCount,
} from "../lib/vec.js";
import { createLayout } from "../lib/layout.js";
import { timeHistogram, clusterSignals, topicSummaries, authorActivity } from "../lib/analyze.js";
import { topicKeywords } from "../lib/keywords.js";
import { createGraph, TOPIC_COLORS, TAG_COLORS } from "./graph.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const num = (n) => Number(n).toLocaleString();
const FLAG_SCORE = 50;
const MAX_TAGS = 9;
const fixedTab = Number(new URLSearchParams(location.search).get("tab")) || null; // 크게 보기 모드

// 모든 상태는 메모리에만. 창을 닫으면 사라진다.
let S = null;       // 분석 결과
let V = null;       // 현재 화면에 그린 파생값 (주제, 신호 …)
let focusKey = null;
let picked = -1;    // 상세 카드에 띄운 댓글 인덱스
let tagDefs = ["분류 1", "분류 2", "분류 3", "분류 4"];
let semantic = null; // 의미 모델 모듈 (없으면 null)

$("ver").textContent = "v" + chrome.runtime.getManifest().version;
if (fixedTab) $("btn-wide").hidden = true;

const graph = createGraph($("graph"), $("tooltip"), {
  onPick: (i) => showDetail(i > 0 ? i - 1 : -1),
  onTagsChange: (counts) => renderTags(counts),
  onSelectionChange: (sel) => ($("sel-count").textContent = `선택 ${num(sel.length)}개`),
});

// ---------- 상태 표시 ----------
function setStatus(msg, kind = "") {
  $("status").textContent = msg;
  $("status").className = "status " + kind;
}

// ---------- 대상 탭과 통신 ----------
async function targetTab() {
  const tab = fixedTab
    ? await chrome.tabs.get(fixedTab).catch(() => null)
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab) throw new Error("분석하던 YouTube 탭이 닫혔어요. 영상을 다시 열고 패널에서 시작하세요.");
  if (!tab.url?.includes("youtube.com/watch")) throw new Error("YouTube 영상 페이지에서 사용하세요.");
  return tab;
}

async function send(type, extra = {}) {
  const tab = await targetTab();
  try {
    return await chrome.tabs.sendMessage(tab.id, { type, ...extra });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/parse.js", "content/youtube.js"] });
    return await chrome.tabs.sendMessage(tab.id, { type, ...extra });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "WV_PROGRESS") {
    if (fixedTab && sender.tab?.id !== fixedTab) return;
    if ($("btn-cancel").hidden) return; // 이 창에서 시작한 수집이 아님
    setStatus(`댓글 모으는 중 ${num(msg.count)}개${msg.total ? ` (전체 약 ${num(msg.total)}개)` : ""}`, "busy");
  } else if (msg?.type === "WV_STATE_REQUEST" && !fixedTab && S && S.tabId === msg.tabId) {
    sendResponse(snapshot()); // 크게 보기 탭에 현재 결과를 넘겨준다 (메모리 → 메모리)
  }
});

// ---------- 분석 ----------
function setBusy(busy) {
  document.querySelectorAll(".controls button, .controls select, .controls input").forEach((b) => (b.disabled = busy));
  $("btn-cancel").hidden = !busy;
  $("btn-cancel").disabled = false;
}
const yieldUI = () => new Promise((r) => setTimeout(r, 0));

async function run(type, extra) {
  setBusy(true);
  try {
    const tab = await targetTab();
    setStatus(type === "WV_COLLECT_ALL" ? "댓글 모으기 시작" : "화면의 댓글 읽는 중", "busy");
    const res = await send(type, extra);
    if (!res?.ok) throw new Error(res?.error || "페이지에서 응답이 없어요. 영상을 새로고침한 뒤 다시 시도하세요.");
    const { doc, comments } = res.data;
    if (!comments.length) throw new Error("댓글을 찾지 못했어요. 댓글이 꺼진 영상인지 확인하세요.");
    const notes = [];
    if (res.fallback) notes.push(`전체 수집이 안 돼서 화면에 보이는 댓글만 분석했어요 (${res.fallback})`);
    if (doc.meta.collection?.cancelled) notes.push("중지해서 모은 만큼만 분석했어요");

    const texts = [`${doc.title}\n${doc.text}`.slice(0, 1500), ...comments.map((c) => c.text)];
    const t0 = performance.now();

    setStatus(`문구 비교 중 (${num(comments.length)}개)`, "busy");
    await yieldUI();
    const lexNbrs = topKNeighbors(hashEmbed(texts).slice(1), 8);
    const t1 = performance.now();

    let semAll = null, modelName = null, where = null;
    const mode = $("mode").value;
    if (mode !== "fast" && semantic) {
      try {
        const r = await semantic.semanticEmbed(texts, { model: mode, onStatus: (m) => setStatus(m, "busy") });
        semAll = r.vecs; where = r.where; modelName = semantic.MODELS[r.model].name;
      } catch (e) {
        console.warn("[WV] semantic failed", e);
        notes.push(`의미 모델을 쓰지 못해 문구 기준으로 묶었어요 (${e.message})`);
      }
    }
    const t2 = performance.now();

    setStatus("지도 그리는 중", "busy");
    await yieldUI();
    const layoutAll = semAll || hashEmbed(texts);
    const semVecs = layoutAll.slice(1);
    const semNbrs = semAll ? topKNeighbors(semVecs, 8) : lexNbrs;
    const docSims = semVecs.map((v) => dot(layoutAll[0], v));
    const init = pca2(layoutAll);
    const t3 = performance.now();

    S = { tabId: tab.id, doc, comments, lexNbrs, semNbrs, docSims, init, semantic: !!semAll, modelName, where };
    picked = -1;
    showResult();
    const presets = renderPresets();
    setSlider("th-sem", presets[1].value); // "보통"
    rebuild({ fresh: true });

    const sec = (a, b) => `${((b - a) / 1000).toFixed(1)}초`;
    const parts = [`댓글 ${num(comments.length)}개 분석 완료`, `문구 ${sec(t0, t1)}`, semAll ? `의미 ${sec(t1, t2)} (${where})` : null, `지도 ${sec(t2, t3)}`].filter(Boolean);
    setStatus([parts.join(" / "), ...notes].join(" — "), notes.length ? "error" : "");
  } catch (e) {
    setStatus(e.message, "error");
  } finally {
    setBusy(false);
  }
}

function showResult() {
  $("empty").hidden = true;
  $("result").hidden = false;
}

function setSlider(id, v) {
  $(id).value = v;
  $(id + "-val").textContent = Number(v).toFixed(2);
}

/** 기준값이 바뀌면 캐시된 이웃으로 묶음만 다시 계산. 손으로 옮긴 배치와 분류는 유지한다. */
function rebuild({ fresh = false, restore = null } = {}) {
  if (!S) return;
  const { doc, comments, lexNbrs, semNbrs, docSims, init } = S;
  const thSem = Number($("th-sem").value), thLex = Number($("th-lex").value);
  const n = comments.length;

  // 문구 → 복붙 의심 신호
  const lexEdges = edgesFromNeighbors(lexNbrs, thLex);
  const lex = clustersFromEdges(n, lexEdges);
  const signals = clusterSignals(lex.groups, comments, lexEdges);
  const flagged = new Set(signals.filter((s) => s.score >= FLAG_SCORE).flatMap((s) => s.indices));

  // 의미 → 배치·주제·키워드
  const semEdges = edgesFromNeighbors(semNbrs, thSem);
  const topic = clustersFromEdges(n, semEdges);
  const topics = topicSummaries(topic.groups, comments, semEdges, docSims).filter((t) => t.size >= 3);
  const kws = topicKeywords(topics.map((t) => t.indices), comments.map((c) => c.text), { k: 4 });
  topics.forEach((t, i) => (t.keywords = kws[i]));
  const kwByCluster = new Map(topics.map((t) => [t.cluster, t.keywords]));
  const authors = authorActivity(comments, { minCount: 3, topicIds: topic.ids });

  // 지도: 0 = 본문, 1..n = 댓글
  const gEdges = semEdges.map((e) => ({ a: e.a + 1, b: e.b + 1, sim: e.sim }));
  docSims.forEach((s, i) => { if (s >= thSem) gEdges.push({ a: 0, b: i + 1, sim: s }); });
  const nodes = [
    { kind: "doc", label: doc.title, sub: "영상 제목과 설명", cluster: -1 },
    ...comments.map((c, i) => ({
      kind: "comment",
      label: c.text.slice(0, 160),
      sub: `${c.parentId ? "답글  " : ""}${c.author}  ${c.createdAtRaw}  ♥ ${num(c.likes)}`,
      reply: !!c.parentId,
      cluster: topic.ids[i],
      likes: c.likes,
      flag: flagged.has(i),
    })),
  ];
  const prev = !fresh && V?.layout ? V.layout : restore?.pos || null;
  const layout = createLayout(init, gEdges, { pinned: [0], keep: prev });
  // 답글 → 원댓글 연결 (원댓글이 수집 범위 안에 있을 때만)
  const indexById = new Map(comments.map((c, i) => [c.id, i]));
  const replyEdges = [];
  comments.forEach((c, i) => { const p = c.parentId && indexById.get(c.parentId); if (p !== undefined && p !== null && p !== false) replyEdges.push({ a: p + 1, b: i + 1 }); });
  const labels = topics.slice(0, 10).map((t) => ({ cluster: t.cluster, text: t.keywords.slice(0, 2).join(" ") }));
  const tags = restore?.tags || (!fresh && V ? graph.tagsArray() : null);
  graph.setTagCount(tagDefs.length);
  graph.set({ layout, edges: gEdges, nodes, focus: null, labels, replyEdges }, { keepView: !fresh, tags });
  focusKey = null;

  V = { layout, topic, topics, signals, flagged, authors, kwByCluster, indexById };
  renderSummary();
  renderTopics();
  renderSignals();
  renderAuthors();
  renderHistogram();
  syncGrain();
  showDetail(picked < n ? picked : -1, { quiet: true });
}

// ---------- 요약 ----------
function renderSummary() {
  const { doc, comments } = S;
  $("doc-title").textContent = doc.title;
  const total = doc.meta.totalComments ? ` (전체 약 ${num(doc.meta.totalComments)}개 중)` : "";
  $("doc-meta").textContent = `${doc.author} — 댓글 ${num(comments.length)}개 수집${total}, ${S.semantic ? `${S.modelName} 모델로 주제 분석` : "문구 기준으로 주제 분석"}`;
  const authors = new Set(comments.map((c) => c.authorId || c.author)).size;
  const pct = Math.round((V.flagged.size / comments.length) * 100);
  const replies = comments.filter((c) => c.parentId).length;
  const stats = [["댓글", num(comments.length - replies)], ["답글", num(replies)], ["작성자", num(authors)], ["주제", V.topics.length], ["복붙 의심", `${pct}%`, pct >= 10]];
  $("stats").replaceChildren(...stats.map(([k, v, warn]) => {
    const d = el("div", warn ? "warn" : "");
    d.append(el("dt", "", k), el("dd", "", v));
    return d;
  }));
  $("n-topics").textContent = V.topics.length;
  $("n-signals").textContent = V.signals.filter((s) => s.score >= FLAG_SCORE).length;
  $("n-authors").textContent = V.authors.length;
}

// ---------- 주제 세밀도 (추천값 / 슬라이더 / 주제 수) ----------
function renderPresets() {
  const presets = thresholdPresets(S.semNbrs);
  $("presets").replaceChildren(...presets.map((p) => {
    const b = el("button");
    b.type = "button";
    b.dataset.value = p.value;
    b.append(el("span", "", p.label), el("small", "", p.value.toFixed(2)));
    b.onclick = () => { setSlider("th-sem", p.value); rebuild(); };
    return b;
  }));
  return presets;
}
function syncGrain() {
  const v = Number($("th-sem").value).toFixed(2);
  $("presets").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.value).toFixed(2) === v)));
  $("k-val").textContent = V.topics.length;
}
function stepTopics(delta) {
  if (!S) return;
  const target = Math.max(1, V.topics.length + delta);
  const { threshold } = thresholdForTopicCount(S.semNbrs, target);
  setSlider("th-sem", threshold);
  rebuild();
}

// ---------- 목록 ----------
function item({ key, color, title, meta, score, sample, why, indices }) {
  const li = el("li", "item");
  if (color) li.style.setProperty("--c", color);
  const row = el("div", "row");
  row.append(el("span", title ? "kw" : "meta", title || meta));
  if (score !== undefined) row.append(el("span", "score" + (score >= FLAG_SCORE ? " hi" : ""), `의심 점수 ${score}`));
  li.append(row);
  if (title && meta) li.append(el("div", "meta", meta));
  if (sample) li.append(el("div", "sample", sample));
  if (why?.length) { const ul = el("ul", "why"); why.forEach((r) => ul.append(el("li", "", r))); li.append(ul); }
  li.tabIndex = 0;
  const toggle = () => {
    const on = focusKey !== key;
    focusKey = on ? key : null;
    const nodeIdx = indices.map((i) => i + 1);
    graph.focus(on ? new Set([0, ...nodeIdx]) : null);
    if (on) graph.select(nodeIdx); else graph.clearSelection(); // 고른 묶음을 바로 '내 분류'에 담을 수 있게
    document.querySelectorAll(".item").forEach((x) => x.classList.remove("active"));
    if (on) li.classList.add("active");
  };
  li.onclick = toggle;
  li.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } };
  return li;
}
const none = (text) => el("li", "none", text);

function renderTopics() {
  const list = V.topics.slice(0, 30).map((t) => item({
    key: "t" + t.cluster,
    color: TOPIC_COLORS[t.cluster % TOPIC_COLORS.length],
    title: t.keywords.length ? t.keywords.join(", ") : "키워드 없음",
    meta: `댓글 ${num(t.size - t.replies)}개, 답글 ${num(t.replies)}개, 작성자 ${num(t.authors)}명, 좋아요 ${num(t.likes)}`,
    sample: t.sample,
    indices: t.indices,
  }));
  $("topics").replaceChildren(...(list.length ? list : [none("3개 이상 모인 주제가 없어요. 위에서 \"넓게\"를 눌러 보세요.")]));
}

function renderSignals() {
  const list = V.signals.slice(0, 30).map((s) => item({
    key: "s" + s.cluster,
    color: s.score >= FLAG_SCORE ? "var(--signal)" : null,
    meta: `${num(s.size)}개 (답글 ${num(s.indices.filter((i) => S.comments[i].parentId).length)}개 포함), 작성자 ${num(s.authors)}명`,
    score: s.score,
    sample: s.sample,
    why: s.reasons,
    indices: s.indices,
  }));
  $("signals").replaceChildren(...(list.length ? list : [none("문구가 겹치는 댓글 묶음이 없어요.")]));
}

function fmtSpan(ms) {
  if (ms === null) return null;
  const h = ms / 3600e3;
  return h < 1 ? "1시간 안에 모두 작성" : h < 48 ? `${Math.round(h)}시간에 걸쳐 작성` : `${Math.round(h / 24)}일에 걸쳐 작성`;
}
function renderAuthors() {
  const list = V.authors.slice(0, 30).map((a) => item({
    key: "a" + (a.authorId || a.author),
    title: a.author,
    meta: `댓글 ${a.count}개 (전체의 ${(a.share * 100).toFixed(1)}%), 그중 답글 ${a.replies}개, 좋아요 ${num(a.likes)}`,
    why: [fmtSpan(a.span), a.topics ? `주제 ${a.topics}곳에 걸쳐 있음` : null].filter(Boolean),
    indices: a.indices,
  }));
  $("authors").replaceChildren(...(list.length ? list : [none("댓글을 3개 이상 쓴 사람이 없어요.")]));
}

function renderHistogram() {
  const bins = timeHistogram(S.comments);
  const box = $("hist");
  if (!bins.length) { box.replaceChildren(el("p", "pane-note", "시간 정보가 없어요.")); return; }
  const W = 320, H = 90, pad = 14, max = Math.max(...bins.map((b) => b.count));
  const bw = (W - 4) / bins.length;
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H + pad}" role="img" aria-label="작성 시각 분포">` +
    bins.map((b, i) => {
      const h = max ? (b.count / max) * H : 0;
      return `<rect x="${2 + i * bw}" y="${H - h}" width="${Math.max(bw - 1.5, 1)}" height="${h}" rx="1"><title>${esc(b.label)}: ${b.count}개</title></rect>`;
    }).join("") +
    `<text x="2" y="${H + 11}">${esc(bins[0].label)}</text><text x="${W - 2}" y="${H + 11}" text-anchor="end">${esc(bins.at(-1).label)}</text></svg>`;
}

// ---------- 댓글 상세 + 실제 위치로 이동 ----------
function commentUrl(c) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(S.doc.meta.videoId)}&lc=${encodeURIComponent(c.id)}`;
}
function showDetail(i, { quiet = false } = {}) {
  picked = i;
  const box = $("detail");
  if (i < 0 || !S) { box.hidden = true; return; }
  const c = S.comments[i];
  box.hidden = false;
  $("d-author").textContent = c.author || "(이름 없음)";
  $("d-meta").textContent = `${c.createdAtRaw}  ♥ ${num(c.likes)}`;
  $("d-text").textContent = c.text;
  // 답글이면 어떤 댓글에 달렸는지 보여주고, 누르면 그 원댓글로 이동
  const pBtn = $("d-parent");
  const pi = c.parentId ? V.indexById.get(c.parentId) : undefined;
  pBtn.hidden = !c.parentId;
  if (c.parentId) {
    const p = pi !== undefined ? S.comments[pi] : null;
    pBtn.textContent = p ? `↳ ${p.author}의 댓글에 단 답글: ${p.text.slice(0, 80)}` : "↳ 답글 (원댓글은 수집 범위 밖)";
    pBtn.disabled = !p;
    pBtn.onclick = p ? () => { graph.select([pi + 1]); showDetail(pi); } : null;
  }
  const badges = [];
  const cl = V.topic.ids[i];
  if (cl >= 0 && V.kwByCluster.has(cl)) {
    const b = el("span", "badge"); b.style.setProperty("--c", TOPIC_COLORS[cl % TOPIC_COLORS.length]);
    b.append(el("i"), document.createTextNode(V.kwByCluster.get(cl).slice(0, 3).join(", ") || "주제"));
    badges.push(b);
  }
  if (V.flagged.has(i)) badges.push(el("span", "badge warn", "복붙 의심 묶음에 포함"));
  badges.push(el("span", "badge", c.parentId ? "답글" : c.meta?.replyCount ? `댓글 (답글 ${num(c.meta.replyCount)}개)` : "댓글"));
  if (c.meta?.hearted) badges.push(el("span", "badge", "채널 주인이 하트"));
  const tag = graph.tagsArray()[i + 1];
  if (tag >= 0) { const b = el("span", "badge"); b.style.setProperty("--c", TAG_COLORS[tag % TAG_COLORS.length]); b.append(el("i"), document.createTextNode(tagDefs[tag])); badges.push(b); }
  $("d-badges").replaceChildren(...badges);
  $("d-link").href = commentUrl(c);
  if (!quiet && !fixedTab && window.innerWidth < 820) box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function gotoComment() {
  if (picked < 0 || !S) return;
  try {
    const tab = await targetTab();
    if (fixedTab) { // 크게 보기에서는 영상 탭을 앞으로
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    }
    const r = await send("WV_FOCUS", { id: S.comments[picked].id });
    setStatus(r?.navigated
      ? "아직 화면에 없던 댓글이라, 그 댓글이 댓글 맨 위에 오도록 영상을 다시 열었어요."
      : "페이지에서 그 댓글로 이동했어요.");
  } catch (e) {
    setStatus(e.message, "error");
  }
}

// ---------- 내 분류 (개수 조절 가능) ----------
function renderTags(counts = []) {
  const box = $("tags");
  const chips = tagDefs.map((name, t) => {
    const chip = el("div", "tag");
    chip.style.setProperty("--c", TAG_COLORS[t % TAG_COLORS.length]);
    const put = el("button", "put"); put.type = "button"; put.title = `선택한 댓글을 이 분류에 담기 (숫자키 ${t + 1})`;
    put.append(el("i"), document.createTextNode(String(t + 1)));
    put.onclick = () => graph.tagSelection(t);
    const input = el("input"); input.value = name; input.setAttribute("aria-label", `분류 ${t + 1} 이름`);
    input.oninput = () => (tagDefs[t] = input.value);
    const n = el("button", "n", `${num(counts[t] || 0)}개`); n.type = "button"; n.title = "이 분류의 댓글을 지도에서 고르기";
    n.onclick = () => graph.select(graph.tagged(t));
    chip.append(put, input, n);
    if (tagDefs.length > 1) {
      const del = el("button", "del", "×"); del.type = "button"; del.title = "이 분류 지우기";
      del.onclick = () => { tagDefs.splice(t, 1); graph.setTagCount(tagDefs.length); graph.removeTag(t); };
      chip.append(del);
    }
    return chip;
  });
  if (tagDefs.length < MAX_TAGS) {
    const add = el("button", "tag-add", "분류 추가"); add.type = "button";
    add.onclick = () => { tagDefs.push(`분류 ${tagDefs.length + 1}`); graph.setTagCount(tagDefs.length); renderTags(graph.tagCounts()); };
    chips.push(add);
  }
  // 이름을 입력하는 중이면 다시 그리지 않고 개수만 갱신
  if (box.contains(document.activeElement) && document.activeElement.tagName === "INPUT" && box.querySelectorAll(".tag").length === tagDefs.length) {
    box.querySelectorAll(".tag .n").forEach((b, t) => (b.textContent = `${num(counts[t] || 0)}개`));
    return;
  }
  box.replaceChildren(...chips);
  if (picked >= 0) showDetail(picked, { quiet: true });
}

// ---------- 크게 보기로 넘겨주기 ----------
function snapshot() {
  return {
    S, tagDefs,
    thSem: $("th-sem").value, thLex: $("th-lex").value,
    tags: Array.from(graph.tagsArray()),
    pos: V ? { x: Array.from(V.layout.x), y: Array.from(V.layout.y), pin: Array.from(V.layout.pin) } : null,
  };
}
async function restoreFromPanel() {
  try {
    const snap = await chrome.runtime.sendMessage({ type: "WV_STATE_REQUEST", tabId: fixedTab });
    if (!snap?.S) return;
    S = snap.S;
    picked = -1;
    tagDefs = snap.tagDefs;
    showResult();
    renderPresets();
    setSlider("th-sem", snap.thSem);
    setSlider("th-lex", snap.thLex);
    rebuild({ fresh: true, restore: { tags: snap.tags, pos: snap.pos } });
    setStatus("패널의 분석 결과를 그대로 가져왔어요.");
  } catch { /* 패널이 닫혀 있으면 여기서 새로 분석하면 된다 */ }
}

// ---------- 이벤트 ----------
$("btn-all").onclick = () => run("WV_COLLECT_ALL", {
  options: { max: Number($("max").value), sort: $("sort").value, includeReplies: $("replies").checked },
});
$("btn-visible").onclick = () => run("WV_EXTRACT");
$("btn-cancel").onclick = () => {
  $("btn-cancel").disabled = true;
  setStatus("중지하는 중. 지금까지 모은 댓글로 분석합니다.", "busy");
  send("WV_CANCEL").catch(() => {});
};
$("btn-wide").onclick = async () => {
  try {
    const tab = await targetTab();
    await chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel/sidepanel.html?tab=${tab.id}`), index: tab.index + 1 });
  } catch (e) { setStatus(e.message, "error"); }
};
for (const id of ["th-sem", "th-lex"]) {
  $(id).oninput = () => { $(id + "-val").textContent = Number($(id).value).toFixed(2); };
  $(id).onchange = () => rebuild();
}
setSlider("th-lex", 0.6);
$("k-minus").onclick = () => stepTopics(-1);
$("k-plus").onclick = () => stepTopics(+1);
$("filter").onchange = () => graph.setFilter($("filter").value);
$("links-on").onchange = () => graph.toggleReplyLinks($("links-on").checked);
$("labels-on").onchange = () => graph.toggleLabels($("labels-on").checked);
$("btn-fit").onclick = () => graph.fit();
$("btn-unpin").onclick = () => graph.unpinAll();
$("d-goto").onclick = gotoComment;
document.querySelectorAll(".tabs button").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    document.querySelectorAll(".pane").forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.tab));
  };
});
$("btn-export").onclick = () => {
  if (!S) return;
  const tags = graph.tagsArray();
  const comments = S.comments.map((c, i) => ({
    ...c,
    topic: V.kwByCluster.get(V.topic.ids[i])?.join(", ") || null,
    copySuspect: V.flagged.has(i),
    myCategory: tags[i + 1] >= 0 ? tagDefs[tags[i + 1]] : null,
  }));
  const blob = new Blob([JSON.stringify({ doc: S.doc, comments }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${S.doc.id.replace(":", "_")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

// ---------- 의미 모델 선택지 ----------
async function initModels() {
  const sel = $("mode");
  const add = (value, text) => { const o = el("option", "", text); o.value = value; sel.append(o); return o; };
  let mod = null;
  try {
    mod = await import("../lib/embed/semantic.js");
    if (!(await mod.semanticAvailable())) mod = null;
  } catch { mod = null; }
  semantic = mod;
  if (!mod) {
    add("fast", "문구만 (모델 없음)");
    $("model-note").textContent = "의미 모델이 설치되지 않아 문구 기준으로만 묶습니다. 릴리스 zip으로 설치하면 의미 분석을 쓸 수 있어요.";
    return;
  }
  const auto = await mod.resolveModel("auto");
  const gpu = await mod.hasGPU();
  add("auto", `자동 (${mod.MODELS[auto].name})`);
  for (const [k, m] of Object.entries(mod.MODELS)) add(k, `${m.label}: ${m.name}`);
  add("fast", "문구만 (모델 없음, 즉시)");
  const describe = () => {
    const v = sel.value;
    if (v === "fast") return "모델 없이 글자가 겹치는 정도로만 묶습니다. 가장 빠르지만 표현이 다른 같은 뜻은 못 묶어요.";
    const m = mod.MODELS[v === "auto" ? auto : v];
    const dev = gpu ? "이 기기는 GPU를 씁니다" : `이 기기는 CPU로 돕니다${globalThis.crossOriginIsolated ? " (멀티스레드)" : ""}`;
    return `${m.name}: ${m.note}. ${dev}. 댓글은 기기 밖으로 나가지 않아요.`;
  };
  sel.onchange = () => { $("model-note").textContent = describe(); if (S) setStatus("모델을 바꿨어요. 다시 분석하면 적용됩니다."); };
  $("model-note").textContent = describe();
}

renderTags();
initModels();
if (fixedTab) restoreFromPanel();
