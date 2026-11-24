// Web Visualizer 패널. 사이드 패널로도, "크게 보기" 탭(?tab=<YouTube 탭 id>)으로도 열린다.
//
// 역할 분리 (docs/objectivity.md)
// - 문구 임베딩(n-gram 해싱): 복붙 의심 신호 — 행동·구조만으로 점수
// - 의미 임베딩(자동 선택): 지도 배치, 주제 묶음, '같은 주장 다른 표현'
// - 평가 표현(어조): 설명용 탭과 색칠에만. 점수·배치에는 쓰지 않는다
import { dot, edgesFromNeighbors, clustersFromEdges, packVectors, unpackVectors } from "../lib/vec.js";
import { analyzeComments, topicsAt, presetCounts, toneWords, FIRST_RES } from "../lib/pipeline.js";
import { createLayout, thinEdges } from "../lib/layout.js";
import { timeHistogram } from "../lib/analyze.js";
import { clusterSignals } from "../lib/signals.js";
import { DEFAULT_WEIGHTS, loadCalibrated } from "../lib/weights.js";
import { authorFeatures, authorSignals, authorMap } from "../lib/authors.js";
import { pileOns, SessionMemory } from "../lib/patterns.js";
import { TONE_LABEL } from "../lib/tone.js";
import { createGraph, TOPIC_COLORS, TAG_COLORS } from "./graph.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const num = (n) => Number(n).toLocaleString();
const keyOf = (c) => c.authorId || c.author;
const MAX_TAGS = 9;
const TONE_TINT = { condemn: ["#7048E8", "#B197FC"], praise: ["#0B7285", "#66D9E8"], mixed: ["#868E96", "#ADB5BD"], none: ["#C5CCD8", "#3A4458"] };
const fixedTab = Number(new URLSearchParams(location.search).get("tab")) || null; // 크게 보기 모드

// 모든 상태는 메모리에만. 창을 닫으면 사라진다.
let S = null;            // 분석 결과 (영상 하나)
let V = null;            // 현재 기준값으로 계산한 파생값
let mapMode = "comments"; // comments | authors
let shown = null;        // 지금 지도에 그려진 것
let savedTags = null;    // 댓글 지도의 내 분류 (작성자 지도로 갔다 와도 유지)
let focusKey = null;
let picked = -1;         // 상세 카드의 댓글 인덱스
let tagDefs = ["분류 1", "분류 2", "분류 3", "분류 4"];
let semantic = null;
let weights = DEFAULT_WEIGHTS;
let calibrated = null;
let finding = false;
// 댓글 목록 (주제별)
let listSrc = null;      // 지금 목록의 출처: "t<주제 번호>" | "sel"(지도에서 여러 개 고름)
let listRows = [];       // 목록에 보이는 순서대로 댓글 인덱스
let listActive = -1;     // 목록에서 강조한 댓글 인덱스
let listSel = [];        // 지도에서 여러 개 고른 댓글 인덱스
const memory = new SessionMemory();
let topicCache = new Map(); // 세밀도 값 → 주제 나누기 결과 (분석마다 새로)

$("ver").textContent = "v" + chrome.runtime.getManifest().version;
if (fixedTab) $("btn-wide").hidden = true;

const graph = createGraph($("graph"), $("tooltip"), {
  onPick: (i) => {
    if (shown === "authors") showAuthor(i);
    else { showDetail(i > 0 ? i - 1 : -1); revealInList(i > 0 ? i - 1 : -1); }
  },
  onTagsChange: (counts) => renderTags(counts),
  onSelectionChange: (sel) => { $("sel-count").textContent = `선택 ${num(sel.length)}개`; listFromSelection(sel); },
});

// ---------- 상태 표시 ----------
function setStatus(msg, kind = "") {
  $("status").textContent = msg;
  $("status").className = "status " + kind;
}

// ---------- 작성자 이름 (기본은 가림) ----------
function nameOf(key, real) {
  if (!$("mask").checked) return real || "(이름 없음)";
  if (!S.names) {
    S.names = new Map();
    for (const c of S.comments) { const k = keyOf(c); if (!S.names.has(k)) S.names.set(k, `작성자 ${S.names.size + 1}`); }
  }
  return S.names.get(key) || "다른 영상의 작성자";
}

// ---------- 대상 탭 ----------
async function currentTab() {
  return fixedTab
    ? await chrome.tabs.get(fixedTab).catch(() => null)
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
}
const videoIdOf = (tab) => {
  try { return tab?.url?.includes("youtube.com/watch") ? new URL(tab.url).searchParams.get("v") : null; } catch { return null; }
};
async function targetTab() {
  const tab = await currentTab();
  if (!tab) throw new Error("분석하던 YouTube 탭이 닫혔어요. 영상을 다시 열고 패널에서 시작하세요.");
  if (!videoIdOf(tab)) throw new Error("YouTube 영상 페이지에서 사용하세요.");
  if (tab.discarded || tab.status === "unloaded") throw new Error(NOT_LOADED);
  return tab;
}
// 브라우저를 다시 켜 복원만 되고 아직 열리지 않은 탭(또는 메모리 절약으로 잠든 탭)에는 스크립트를 넣을 수 없다.
// 브라우저의 영어 오류("Cannot access contents of the page…") 대신 할 일을 알려 준다.
const NOT_LOADED = "영상 탭이 아직 열리지 않았어요. 영상 탭을 한 번 눌러 연 뒤 다시 시도해 주세요.";
const isNotLoaded = (e) => /Cannot access contents|cannot be scripted|discarded/i.test(String(e?.message || e));
// 탭이 열려 있어도 네트워크 오류 등으로 브라우저 오류 페이지가 떠 있으면 스크립트를 넣을 수 없다("Frame … is showing error page"). 이건 '아직 안 열림'이 아니다.
const ERROR_PAGE = "영상 페이지가 제대로 열리지 않았어요(인터넷 연결 등). 영상 탭을 새로고침한 뒤 다시 시도해 주세요.";
const isErrorPage = (e) => /showing error page/i.test(String(e?.message || e));
/** 스크립트 넣기 오류 → 사용자에게 보일 오류 */
export const explainInjectError = (e) => (isErrorPage(e) ? new Error(ERROR_PAGE) : isNotLoaded(e) ? new Error(NOT_LOADED) : e);
async function send(type, extra = {}) {
  const tab = await targetTab();
  try {
    return await chrome.tabs.sendMessage(tab.id, { type, ...extra });
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/parse.js", "content/youtube.js"] });
      return await chrome.tabs.sendMessage(tab.id, { type, ...extra });
    } catch (e) {
      throw explainInjectError(e);
    }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (fixedTab && sender.tab && sender.tab.id !== fixedTab) return;
  if (msg?.type === "WV_PROGRESS") {
    if ($("btn-cancel").hidden) return; // 이 창에서 시작한 수집이 아님
    const what = msg.phase === "후보 확인" ? "무작위로 뽑을 후보 댓글 확인 중" : msg.phase === "답글 받는 중" ? "뽑힌 댓글의 답글 받는 중" : "댓글 모으는 중";
    setStatus(`${what} ${num(msg.count)}개${msg.total ? ` (전체 약 ${num(msg.total)}개)` : ""}`, "busy");
  } else if (msg?.type === "WV_FIND_PROGRESS") {
    if (finding) $("d-status").textContent = msg.text;
  } else if (msg?.type === "WV_STATE_REQUEST" && !fixedTab && S && S.tabId === msg.tabId) {
    sendResponse(snapshot()); // 크게 보기 탭에 현재 결과를 넘겨준다 (메모리 → 메모리)
  }
});

// ---------- 영상이 바뀌면 알려주기 ----------
async function checkVideo() {
  const vid = videoIdOf(await currentTab().catch(() => null));
  const changed = !!S && !!vid && vid !== S.doc.meta.videoId;
  $("video-changed").hidden = !changed;
  if (changed) $("video-changed-text").textContent = `다른 영상이 열려 있어요. 아래는 이전 영상 "${S.doc.title.slice(0, 40)}"의 결과입니다.`;
  return vid;
}
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.url || info.status === "complete") checkVideo(); });
chrome.tabs.onActivated.addListener(() => checkVideo());

// ---------- 분석 ----------
function setBusy(busy) {
  document.querySelectorAll(".controls button, .controls select, .controls input, #btn-reanalyze").forEach((b) => (b.disabled = busy));
  $("btn-cancel").hidden = !busy;
  $("btn-cancel").disabled = false;
  if (!busy) refreshWeightsOption();
}

/** 분석 계산 (lib/pipeline.js). onStatus로 진행 문구를 받는다 */
async function analyze(input, onStatus) {
  const embed = async (texts, st) => {
    const r = await semantic.semanticEmbed(texts, { model: input.mode, onStatus: st });
    return { vecs: r.vecs, where: r.where, modelName: semantic.MODELS[r.model].name };
  };
  return analyzeComments(input, { embed, onStatus });
}

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
    if (doc.meta.collection?.limited) notes.push("YouTube가 요청을 계속 받지 않아서(요청 제한이나 서버 오류) 중간에 멈추고, 모은 만큼만 분석했어요. 잠시 뒤 다시 모으면 더 받을 수 있어요");

    const n = comments.length;
    const mode = $("mode").value;
    const A = await analyze({ doc, comments, useSemantic: mode !== "fast" && !!semantic, mode }, (m) => setStatus(m, "busy"));
    notes.push(...A.notes);

    S = {
      tabId: tab.id, doc, comments, lexVecs: A.lexVecs, lexNbrs: A.lexNbrs, semNbrs: A.semNbrs, x: A.x, y: A.y, graphEdges: A.graphEdges,
      idx: A.idx, short: A.short, semantic: A.semantic, modelName: A.modelName, where: A.where, para: A.para, co: A.co, tone: A.tone, presets: A.presets,
    };
    topicCache = new Map([[FIRST_RES, A.firstTopics]]);
    memory.add(doc, comments);
    picked = -1; savedTags = null; V = null; mapMode = "comments";
    showResult();
    setRes(FIRST_RES);
    renderPresets();
    rebuild({ fresh: true });
    await checkVideo();

    const sec = (ms) => `${(ms / 1000).toFixed(1)}초`;
    const parts = [`댓글 ${num(n)}개 분석 완료`, `문구 ${sec(A.times.lex)}`, A.semantic ? `의미 ${sec(A.times.sem)} (${A.where})` : null, `지도 ${sec(A.times.map)}`].filter(Boolean);
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

function setRes(v) {
  const x = Math.max(0, Math.min(100, Math.round(v)));
  $("res-range").value = x;
  return x;
}

/** 문구 쪽 계산 (복붙 의심, 작성자, 몰림). 문구 기준·점수 기준이 바뀔 때만 다시 한다. */
function computeLex() {
  const { doc, comments, lexNbrs } = S;
  const thLex = Number($("th-lex").value);
  const key = `${thLex}|${weights.version}`;
  if (V?.lexKey === key) return V.lexPart;
  const n = comments.length;
  const lexEdges = edgesFromNeighbors(lexNbrs, thLex);
  const lex = clustersFromEdges(n, lexEdges);
  const signals = clusterSignals(lex.groups, comments, lexEdges, { weights, doc, sim: S.lexVecs ? (i, j) => dot(S.lexVecs[i], S.lexVecs[j]) : null, linkThreshold: thLex });
  const flagged = new Set(signals.filter((s) => s.state === "scored" && s.score >= weights.thresholds.flag).flatMap((s) => s.indices));
  const feats = authorFeatures(comments, lex.ids, lex.groups);
  const aSignals = authorSignals(feats, { weights });
  const aMap = authorMap(feats);
  const paraOf = new Map();
  S.para.groups.forEach((g, gi) => g.indices.forEach((i) => paraOf.set(i, gi)));
  const piles = pileOns(comments, (i) => (lex.ids[i] >= 0 ? lex.ids[i] : paraOf.has(i) ? 1e6 + paraOf.get(i) : -1));
  return { lexKey: key, signals, flagged, aSignals, aMap, piles };
}

/**
 * 주제 쪽 계산: 이웃 그래프의 커뮤니티(Louvain). 세밀도가 바뀔 때만 다시 한다. 점의 위치는 바뀌지 않는다.
 * 키워드가 같은 묶음은 하나로 합친다 (같은 이야기인데 둘로 갈린 경우, lib/community.js mergeSameKeywordTopics).
 * 겹침(보조 주제)은 합친 뒤의 주제로 계산한다.
 */
function computeTopics() {
  const { comments, short, graphEdges } = S;
  const n = comments.length;
  const v = Number($("res-range").value) || 0;
  if (V?.topicKey === v) return V.topicPart;
  if (!topicCache.has(v)) topicCache.set(v, topicsAt({ n, graphEdges, short, texts: comments.map((c) => c.text) }, v));
  if (topicCache.size > 12) topicCache.delete(topicCache.keys().next().value);
  const part = topicCache.get(v);
  const { groups, keywords: kws, ov } = part;
  const ids = Int32Array.from(part.ids); // 아래에서 짧은 반응 번호를 채우므로 캐시는 그대로 둔다
  const K = groups.length;
  const extraOf = Array.from({ length: n }, (_, i) => ov.extra[i + 1]);
  const extraIn = (c) => (ov.members.get(c) || []).map((k) => k - 1).filter((i) => ids[i] !== c);
  // 대표 댓글: 같은 주제의 이웃과 가장 강하게 이어진 댓글
  const strength = new Float32Array(n);
  for (const { a, b, w } of graphEdges) { if (a && b && ids[a - 1] >= 0 && ids[a - 1] === ids[b - 1]) { strength[a - 1] += w; strength[b - 1] += w; } }
  const summarize = (indices, cluster, keywords, isShort = false) => {
    const items = indices.map((i) => comments[i]);
    const rep = indices.reduce((best, i) => (strength[i] > strength[best] ? i : best), indices[0]);
    return {
      cluster, keywords, indices, short: isShort, size: indices.length,
      sample: isShort ? "" : comments[rep].text,
      authors: new Set(items.map(keyOf)).size,
      likes: items.reduce((s2, c) => s2 + (c.likes || 0), 0),
      replies: items.filter((c) => c.parentId).length,
    };
  };
  const topics = groups.map((g, c) => { const t = summarize(g, c, kws[c]); const ex = extraIn(c); t.extra = ex.length; t.members = [...g, ...ex]; return t; });
  const sIdx = [];
  short.forEach((sh, i) => { if (sh) { sIdx.push(i); ids[i] = K; } });
  if (sIdx.length) { const t = summarize(sIdx, K, ["짧은 반응"], true); t.extra = 0; t.members = sIdx; topics.push(t); }
  return { topicKey: v, topic: { ids }, merges: part.merges, extraOf, topics, kwByCluster: new Map(topics.map((t) => [t.cluster, t.keywords])), K };
}

/** 기준이 바뀌면 필요한 쪽만 다시 계산. 손으로 옮긴 점과 내 분류는 유지한다. */
function rebuild({ fresh = false, restore = null } = {}) {
  if (!S) return;
  const { comments } = S;
  const prev = fresh ? null : V;
  if (fresh) { V = null; listSrc = null; listSel = []; listActive = -1; listRows = []; } // 새 분석·크게 보기 넘겨받기: 이전 영상의 목록 번호를 쓰지 않게
  const lexPart = computeLex();
  const topicPart = computeTopics();
  const indexById = new Map(comments.map((c, i) => [c.id, i]));
  const byAuthor = new Map();
  comments.forEach((c, i) => { const k2 = keyOf(c); if (!byAuthor.has(k2)) byAuthor.set(k2, []); byAuthor.get(k2).push(i); });
  V = {
    ...lexPart, lexPart, ...topicPart, topicPart, indexById, byAuthor,
    commentLayout: prev?.commentLayout || null, // 점의 위치는 세밀도·문구 기준을 바꿔도 그대로 (손으로 옮긴 것 포함)
    authorLayout: prev?.authorLayout || null,
    restorePos: restore?.pos || null,
  };
  if (restore?.tags) savedTags = restore.tags;
  drawMap({ fresh });
  renderSummary();
  renderTopics();
  renderListOptions();
  setList(listSrc, { keepScroll: !fresh });
  renderSignals();
  renderPatterns();
  renderAuthors();
  renderTone();
  renderCross();
  renderHistogram();
  syncGrain();
  if (shown === "comments") showDetail(picked < comments.length ? picked : -1, { quiet: true });
}

// ---------- 지도 ----------
function drawMap({ fresh = false } = {}) {
  if (!S || !V) return;
  if (shown === "comments" && !fresh) savedTags = Array.from(graph.tagsArray());
  const authors = mapMode === "authors";
  for (const id of ["grain", "cats", "color-by-wrap", "filter", "clist"]) $(id).hidden = authors;
  $("links-on").parentElement.hidden = authors;
  $("labels-on").parentElement.hidden = authors;
  document.querySelectorAll("#map-mode button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mapMode)));
  $("detail").hidden = true;
  graph.setFilter(authors ? "all" : $("filter").value);

  if (authors) {
    const { list, edges, init } = V.aMap;
    const scoreOf = new Map(V.aSignals.map((a) => [a.key, a]));
    const maxCount = Math.max(1, ...list.map((f) => f.count));
    const nodes = list.map((f) => {
      const a = scoreOf.get(f.key);
      return {
        kind: "author",
        label: nameOf(f.key, f.author),
        sub: `댓글 ${f.count}개  평균 좋아요 ${f.avgLikes.toFixed(1)}${a?.state === "scored" ? `  의심 점수 ${a.score}` : "  판단 보류"}`,
        cluster: a?.state === "scored" ? 0 : -1,
        weight: Math.log1p(f.count) / Math.log1p(maxCount),
        flag: a?.state === "scored" && a.score >= weights.thresholds.flag,
      };
    });
    const keep = V.authorLayout && V.authorLayout.x.length === nodes.length ? V.authorLayout : null;
    const layout = createLayout(init, edges, { keep });
    V.authorLayout = layout;
    graph.setTagCount(0);
    graph.set({ layout, edges, nodes, focus: null, labels: [], alwaysEdges: true, noGlow: true }, { keepView: false });
    shown = "authors";
  } else {
    const { comments, doc } = S;
    const ids = V.topic.ids;
    // 선: 점마다 가장 강하게 이어진 이웃 3개 (옵시디언처럼 이어진 그래프, 너무 빽빽하지 않게). 줄이다 끊긴 곳은 다시 잇는다.
    const gEdges = thinEdges(S.graphEdges.filter((e) => e.a !== 0 && e.b !== 0), 3).map((e) => ({ a: e.a, b: e.b, sim: 0.45 + 0.55 * e.w }));
    const maxLikes = Math.max(1, ...comments.map((c) => c.likes || 0));
    const byTone = $("color-by").value === "tone";
    const nodes = [
      { kind: "doc", label: doc.title, sub: "영상 제목과 설명", cluster: -1 },
      ...comments.map((c, i) => ({
        kind: "comment",
        label: c.text.slice(0, 160),
        sub: `${c.parentId ? "답글  " : ""}${nameOf(keyOf(c), c.author)}  ${c.createdAtRaw}  ♥ ${num(c.likes)}`,
        reply: !!c.parentId,
        cluster: ids[i],
        also: V.extraOf[i].length ? V.extraOf[i] : null,
        weight: Math.log1p(c.likes || 0) / Math.log1p(maxLikes),
        flag: V.flagged.has(i),
        tint: byTone ? TONE_TINT[S.tone.tones[i].label] : S.short[i] ? TONE_TINT.none : null,
      })),
    ];
    const replyEdges = [];
    comments.forEach((c, i) => { const p = c.parentId ? V.indexById.get(c.parentId) : undefined; if (p !== undefined) replyEdges.push({ a: p + 1, b: i + 1 }); });
    const prevLayout = V.commentLayout;
    const hadLayout = !!prevLayout;
    const groups = [-1, ...ids];
    // 첫 배치는 UMAP 좌표에서 시작해 힘 배치로 다듬는다. 다시 그릴 때는 지금 위치(손으로 옮긴 것 포함)를 이어받는다.
    const layout = createLayout(S.x.map((xx, i) => [xx, S.y[i]]), gEdges, {
      pinned: [0], groups, cohesion: 0.05,
      keep: prevLayout || V.restorePos || null,
      alpha: prevLayout ? 0.25 : 0.6,
    });
    V.restorePos = null;
    V.commentLayout = layout;
    const labels = [...V.topics.filter((t) => !t.short && t.size >= 3).slice(0, 15), ...V.topics.filter((t) => t.short)].map((t) => ({
      cluster: t.cluster,
      text: t.short ? `짧은 반응 ${num(t.size)}` : t.keywords.slice(0, 2).join(" ") || `주제 ${t.cluster + 1}`,
      color: t.short ? "#8D98AB" : null,
    }));
    graph.setTagCount(tagDefs.length);
    graph.set({ layout, edges: gEdges, nodes, focus: null, labels, replyEdges, alwaysEdges: true, noGlow: true }, { keepView: !fresh && shown === "comments" && hadLayout, tags: savedTags });
    shown = "comments";
    renderRows(); // 작성자 지도에 갔다 오면(목록이 숨어 있던 동안) 빈 칸으로 남지 않게
  }
  focusKey = null;
  renderLegend();
}

function renderLegend() {
  const dot2 = (cls, text, c) => { const s = el("span"); const i = el("i", "dot " + cls); if (c) i.style.setProperty("--c", c); s.append(i, document.createTextNode(text)); return s; };
  const dark = $("map").dataset.theme === "dark" ? 1 : 0;
  let items;
  if (shown === "authors") {
    items = [dot2("", "작성자"), dot2("ring", "의심 신호"), dot2("small", "댓글 적음"), dot2("big", "댓글 많음")];
  } else if ($("color-by").value === "tone") {
    items = ["condemn", "praise", "mixed", "none"].map((k) => dot2("", TONE_LABEL[k], TONE_TINT[k][dark]));
  } else {
    items = [dot2("", "댓글"), dot2("hollow", "답글"), dot2("ring", "복붙 의심"), dot2("multi", "여러 주제"), dot2("doc", "본문"), dot2("small", "좋아요 적음"), dot2("big", "좋아요 많음")];
  }
  $("map-legend").replaceChildren(...items);
}

function setMapMode(m) {
  if (m === mapMode && shown === m) return;
  mapMode = m;
  drawMap();
}

// ---------- 요약 ----------
function renderSummary() {
  const { doc, comments } = S;
  $("doc-title").textContent = doc.title;
  const total = doc.meta.totalComments;
  $("doc-meta").textContent = `${doc.author} — 댓글 ${num(comments.length)}개 수집${total ? ` (전체 약 ${num(total)}개)` : ""}, ${S.semantic ? `${S.modelName} 모델로 주제 분석` : "문구 기준으로 주제 분석"}`;
  const cov = total ? comments.length / total : null;
  $("coverage").hidden = !(cov !== null && cov < 0.9);
  if (cov !== null && cov < 0.9) {
    const col = doc.meta.collection || {};
    const how = { top: "인기순", new: "최신순", mix: "인기순과 최신순 반반" }[col.sort] || "화면에 보이는 순서";
    $("coverage").textContent = col.sort === "random" && col.pool
      ? (col.pool.complete
        ? `원댓글 ${num(col.pool.size)}개 전체에서 무작위로 고르게 뽑았어요. 비율은 표본 기준입니다.`
        : `댓글이 아주 많아서, 가장 최근 원댓글 ${num(col.pool.size)}개 안에서 무작위로 고르게 뽑았어요. 그보다 오래된 댓글은 들어 있지 않습니다.`)
      : `전체의 약 ${Math.max(1, Math.round(cov * 100))}%만 모았어요 (${how}). 비율과 순위는 모은 범위 안에서만 맞습니다.`;
  }
  const authors = new Set(comments.map(keyOf)).size;
  const replies = comments.filter((c) => c.parentId).length;
  const pct = Math.round((V.flagged.size / comments.length) * 100);
  const stats = [["댓글", num(comments.length - replies)], ["답글", num(replies)], ["작성자", num(authors)], ["주제", V.K], ["복붙 의심", `${pct}%`, pct >= 10]];
  $("stats").replaceChildren(...stats.map(([k, v, warn]) => {
    const d = el("div", warn ? "warn" : "");
    d.append(el("dt", "", k), el("dd", "", v));
    return d;
  }));
  $("n-topics").textContent = V.K;
  $("n-signals").textContent = V.signals.filter((s) => s.state === "scored" && s.score >= weights.thresholds.flag).length;
  $("n-authors").textContent = V.aSignals.filter((a) => a.state === "scored" && a.score >= weights.thresholds.flag).length;
  $("n-patterns").textContent = S.para.groups.length + V.piles.length + S.co.groups.length;
  $("weights-note").textContent = `점수 기준: ${weights.source} (${weights.version}).`;
}

// ---------- 주제 세밀도 ----------
function renderPresets() {
  S.presets ||= presetCounts(S.comments.length, S.graphEdges);
  $("presets").replaceChildren(...S.presets.map(([label, v, cnt]) => {
    const b = el("button");
    b.type = "button";
    b.dataset.value = v;
    b.append(el("span", "", label), el("small", "", `약 ${cnt}개`));
    b.onclick = () => { setRes(v); rebuild(); };
    return b;
  }));
}
function syncGrain() {
  const v = String(Number($("res-range").value));
  $("presets").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === v)));
  $("k-val").textContent = `주제 ${V.K}개`;
}
function stepTopics(delta) {
  if (!S) return;
  setRes((Number($("res-range").value) || 0) + delta * 5);
  rebuild();
}

// ---------- 목록 ----------
function item({ key, color, title, meta, score, state, sample, samples, parts, why, indices, tagIndices, list }) {
  const li = el("li", "item");
  if (color) li.style.setProperty("--c", color);
  const row = el("div", "row");
  row.append(el("span", title ? "kw" : "meta", title || meta));
  if (state) row.append(el("span", "state", state));
  else if (score !== undefined && score !== null) row.append(el("span", "score" + (score >= weights.thresholds.flag ? " hi" : ""), `의심 점수 ${score}`));
  li.append(row);
  if (title && meta) li.append(el("div", "meta", meta));
  for (const s of samples || (sample ? [sample] : [])) li.append(el("div", "sample", s));
  if (parts?.length) {
    const box = el("div", "parts");
    for (const p of parts) { const r = el("div"); r.append(el("span", "", p.label), el("b", "", (p.points > 0 ? "+" : "") + p.points)); box.append(r); }
    li.append(box);
  }
  if (why?.length) { const ul = el("ul", "why"); why.forEach((r) => ul.append(el("li", "", r))); li.append(ul); }
  li.tabIndex = 0;
  const toggle = () => {
    if (!indices?.length) return;
    if (mapMode !== "comments") setMapMode("comments"); // 목록의 묶음은 댓글 지도에서 보여준다
    const on = focusKey !== key;
    focusKey = on ? key : null;
    const nodeIdx = indices.map((i) => i + 1);
    graph.focus(on ? new Set([0, ...nodeIdx]) : null);
    // 고른 묶음을 바로 '내 분류'에 담을 수 있게 (주제는 주 주제 댓글만 담김).
    // 주제를 누른 경우엔 목록이 그 주제가 되므로, 같은 내용의 '지도에서 고른 댓글' 항목을 만들지 않는다.
    selFromTopic = on && !!list;
    try { if (on) graph.select(nodeIdx, { tagOnly: tagIndices?.map((i) => i + 1) }); else graph.clearSelection(); }
    finally { selFromTopic = false; }
    if (on && list) setList(list); // 주제를 누르면 댓글 목록도 그 주제로
    document.querySelectorAll(".item").forEach((x) => x.classList.remove("active"));
    if (on) li.classList.add("active");
  };
  li.onclick = toggle;
  li.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } };
  return li;
}
const none = (text) => el("li", "none", text);
const fill = (id, list, emptyText) => $(id).replaceChildren(...(list.length ? list : [none(emptyText)]));

function renderTopics() {
  fill("topics", V.topics.map((t) => item({
    key: "t" + t.cluster,
    color: t.short ? "#8D98AB" : TOPIC_COLORS[t.cluster % TOPIC_COLORS.length],
    title: topicTitle(t),
    meta: `댓글 ${num(t.size - t.replies)}개, 답글 ${num(t.replies)}개, 작성자 ${num(t.authors)}명, 좋아요 ${num(t.likes)}${t.extra ? ` · 다른 주제와 겹치는 댓글 +${num(t.extra)}개` : ""}`,
    sample: t.short ? "뜻으로 묶기 어려운 짧은 댓글을 따로 모았어요." : t.sample,
    indices: t.members,
    tagIndices: t.indices,
    list: "t" + t.cluster,
  })), "묶을 댓글이 없어요.");
}
const topicTitle = (t) => (t.short ? "짧은 반응 (ㅋㅋ, lol, 이모지 등)" : t.keywords.length ? t.keywords.join(", ") : `주제 ${t.cluster + 1}`);
const topicColor = (cluster) => { const t = V.topics.find((x) => x.cluster === cluster); return !t ? "transparent" : t.short ? "#8D98AB" : TOPIC_COLORS[cluster % TOPIC_COLORS.length]; };

// ---------- 댓글 목록 (주제별) ----------
// 줄 높이를 고정하고 보이는 줄(+앞뒤 몇 줄)만 그린다 → 댓글 1,000개 이상이어도 가볍다.
const ROW = 68;
/** 그 주제에 속한 댓글 인덱스 */
function topicMembers(cluster) {
  const t = V.topics.find((x) => x.cluster === cluster);
  return t ? t.members : [];
}
const topicShort = (c) => { const t = V.topics.find((x) => x.cluster === c); return !t ? "" : t.short ? "짧은 반응" : t.keywords[0] || `주제 ${c + 1}`; };
function renderListOptions() {
  const opts = V.topics.map((t) => {
    const o = el("option", "", `${t.short ? "짧은 반응" : topicTitle(t)} (${num(t.size)}${t.extra ? ` +겹침 ${num(t.extra)}` : ""})`);
    o.value = "t" + t.cluster;
    return o;
  });
  if (listSel.length > 1) {
    const o = el("option", "", `지도에서 고른 댓글 (${num(listSel.length)})`);
    o.value = "sel";
    opts.unshift(o);
  }
  $("clist-topic").replaceChildren(...opts);
}
function listValid(src) {
  if (src === "sel") return listSel.length > 1;
  return typeof src === "string" && src[0] === "t" && V.topics.some((t) => "t" + t.cluster === src);
}
function setList(src, { keepScroll = false } = {}) {
  if (!S || !V) return;
  if (!listValid(src)) src = V.topics.length ? "t" + V.topics[0].cluster : null;
  listSrc = src;
  $("clist-topic").value = src || "";
  const { comments } = S;
  const base = src === "sel" ? listSel : src ? topicMembers(Number(src.slice(1))) : [];
  const f = $("filter").value; // 지도에서 숨긴 점은 목록에도 넣지 않는다
  const rows = f === "top" ? base.filter((i) => !S.comments[i].parentId) : f === "reply" ? base.filter((i) => S.comments[i].parentId) : [...base];
  if ($("clist-sort").value === "new") rows.sort((a, b) => String(comments[b].createdAtApprox || "").localeCompare(String(comments[a].createdAtApprox || "")) || a - b);
  else rows.sort((a, b) => (comments[b].likes || 0) - (comments[a].likes || 0) || a - b);
  listRows = rows;
  $("clist-count").textContent = `${num(rows.length)}개`;
  $("clist-pad").style.height = `${rows.length * ROW}px`;
  if (!keepScroll) $("clist-scroll").scrollTop = 0;
  renderRows();
}
function renderRows() {
  if (!S || !V) return;
  const box = $("clist-pad");
  if (!listRows.length) { box.replaceChildren(el("div", "clist-empty", "이 목록에 댓글이 없어요.")); return; }
  const sc = $("clist-scroll");
  const top = Number(sc.scrollTop) || 0, h = Number(sc.clientHeight) || 360;
  const first = Math.max(0, Math.floor(top / ROW) - 4), last = Math.min(listRows.length, Math.ceil((top + h) / ROW) + 4);
  const cur = typeof listSrc === "string" && listSrc[0] === "t" ? Number(listSrc.slice(1)) : null;
  const out = [];
  for (let r = first; r < last; r++) {
    const i = listRows[r], c = S.comments[i];
    if (!c) continue;
    const row = el("div", "crow" + (i === listActive ? " active" : ""));
    row.style.top = `${r * ROW}px`;
    row.style.setProperty("--c", topicColor(V.topic.ids[i]));
    row.dataset.i = String(i);
    row.title = c.text.slice(0, 300);
    const m = el("div", "m", `${c.parentId ? "답글 · " : ""}${nameOf(keyOf(c), c.author)} · ${c.createdAtRaw || ""} · ♥ ${num(c.likes || 0)}`);
    // 여러 주제에 속한 댓글: 이 목록 말고 다른 주제 이름을 칩으로
    const own = V.topic.ids[i];
    const ex = V.extraOf[i] || [];
    for (const oc of ex.length ? [own, ...ex] : []) {
      if (oc === cur) continue;
      const chip = el("span", "also", `${oc === own ? "주 주제" : "다른 주제에도"}: ${topicShort(oc)}`);
      chip.style.setProperty("--c2", topicColor(oc));
      m.append(chip);
    }
    row.append(el("div", "t", c.text), m);
    row.onclick = () => pickFromList(i);
    out.push(row);
  }
  box.replaceChildren(...out);
}
let rowsRaf = 0;
$("clist-scroll").onscroll = () => { if (!rowsRaf) rowsRaf = requestAnimationFrame(() => { rowsRaf = 0; renderRows(); }); };
$("clist-topic").onchange = () => { listActive = -1; setList($("clist-topic").value); };
$("clist-sort").onchange = () => setList(listSrc);

/** 지도에서 점을 누름 → 목록에서 그 댓글을 찾아 가운데로 스크롤하고 강조. 목록에 없으면 그 댓글의 주제로 바꾼다. */
function revealInList(i) {
  if (!S || !V) return;
  listActive = i;
  if (i < 0) { renderRows(); return; }
  if (!listRows.includes(i)) setList("t" + V.topic.ids[i]);
  const pos = listRows.indexOf(i);
  if (pos >= 0) {
    const sc = $("clist-scroll");
    const h = Number(sc.clientHeight) || 360;
    sc.scrollTop = Math.max(0, pos * ROW - (h - ROW) / 2);
  }
  renderRows();
}
/** 목록에서 댓글을 누름 → 지도에서 그 점을 가운데로 옮기고 고른 상태로 */
function pickFromList(i) {
  listActive = i;
  if (mapMode !== "comments") setMapMode("comments");
  graph.centerOn(i + 1);
  // '지도에서 고른 댓글' 목록에서는 지도 선택을 그대로 둔다 (선택 = 목록). 주제 목록에서는 그 점 하나만 고른다.
  if (listSrc !== "sel") graph.select([i + 1]);
  showDetail(i);
  renderRows();
}
/** 지도에서 여러 개를 고르면(Shift+드래그, 키워드 누르기 등) 목록에 '지도에서 고른 댓글'이 생긴다 */
let selFromTopic = false; // 주제 목록에서 주제를 눌러 고른 중 (목록은 그 주제로 바뀜)
function listFromSelection(sel) {
  if (!S || !V || shown !== "comments") return;
  if (sel.length > 1 && selFromTopic) { // 주제와 같은 내용이므로 '고른 댓글' 항목을 거둔다
    if (listSel.length) { listSel = []; renderListOptions(); }
  } else if (sel.length > 1) {
    listSel = sel.filter((n) => n > 0).map((n) => n - 1);
    renderListOptions();
    setList("sel");
  } else if (listSel.length) { // 선택이 1개 이하로 줄면 '고른 댓글' 목록을 거두고 주제 목록으로
    listSel = [];
    renderListOptions();
    if (listSrc === "sel") setList(sel.length === 1 && sel[0] > 0 ? "t" + V.topic.ids[sel[0] - 1] : null);
  }
}


function renderSignals() {
  const stateText = { natural: "자연스러운 반복", hold: "판단 보류" };
  fill("signals", V.signals.slice(0, 40).map((s) => item({
    key: "s" + s.cluster,
    color: s.state === "scored" && s.score >= weights.thresholds.flag ? "var(--signal)" : null,
    meta: `${num(s.size)}개 (답글 ${num(s.indices.filter((i) => S.comments[i].parentId).length)}개 포함), 작성자 ${num(s.authors)}명`,
    score: s.state === "scored" ? s.score : undefined,
    state: stateText[s.state],
    sample: s.sample,
    parts: s.parts,
    why: s.notes,
    indices: s.indices,
  })), "문구가 겹치는 댓글 묶음이 없어요.");
}

function renderPatterns() {
  fill("p-para", S.para.groups.slice(0, 15).map((g) => item({
    key: "pp" + g.id, meta: `댓글 ${g.size}개, 작성자 ${g.authors}명`, samples: g.samples, why: g.reasons, indices: g.indices,
  })), S.para.note || "뜻은 같은데 표현만 다른 묶음은 찾지 못했어요.");
  fill("p-pile", V.piles.slice(0, 15).map((p, i) => item({
    key: "pl" + i, meta: `원댓글: ${S.comments[p.parent].text.slice(0, 50)}`, sample: p.sample, why: p.reasons, indices: p.indices,
  })), "비슷한 답글이 한 댓글에 몰린 경우는 찾지 못했어요. (답글 5개 이상·작성자 4명 이상인 스레드만 봅니다)");
  fill("p-co", S.co.groups.slice(0, 15).map((g) => item({
    key: "pc" + g.id, meta: `작성자 ${g.authors}명`, why: g.reasons, indices: g.indices,
  })), S.co.note || "같은 시간대에 반복해서 함께 쓴 작성자는 찾지 못했어요.");
}

function renderAuthors() {
  const list = V.aSignals.filter((a) => a.state === "scored" && (a.score > 0 || a.count >= 5)).slice(0, 40);
  fill("authors", list.map((a) => item({
    key: "a" + a.key,
    color: a.score >= weights.thresholds.flag ? "var(--signal)" : null,
    title: nameOf(a.key, a.author),
    meta: `댓글 ${a.count}개 (그중 답글 ${Math.round(a.replyShare * a.count)}개), 평균 좋아요 ${a.avgLikes.toFixed(1)}`,
    score: a.score,
    parts: a.parts,
    why: a.notes,
    indices: a.indices,
  })), "살펴볼 만한 작성자가 없어요. (댓글 3개 이상 쓴 사람만 평가합니다)");
}

function renderTone() {
  const rows = S.tone.rows;
  const dark = 0;
  const head = el("tr");
  ["", "댓글 수", "좋아요 중앙값", "좋아요 상위 10% 안 비율"].forEach((h) => head.append(el("th", "", h)));
  const body = rows.map((r) => {
    const tr = el("tr", "rowlink");
    const td0 = el("td"); const i = el("i"); i.style.setProperty("--c", TONE_TINT[r.label][dark]); td0.append(i, document.createTextNode(TONE_LABEL[r.label]));
    tr.append(td0, el("td", "", `${num(r.count)} (${Math.round(r.share * 100)}%)`), el("td", "", num(r.medianLikes)), el("td", "", `${Math.round(r.topShare * 100)}%`));
    tr.onclick = () => { if (mapMode !== "comments") setMapMode("comments"); graph.select(r.indices.map((x) => x + 1)); };
    return tr;
  });
  $("tone-table").replaceChildren(head, ...body);
  S.tone.words ||= toneWords(rows, S.comments.map((c) => c.text));
  $("tone-words-c").textContent = S.tone.words.condemn;
  $("tone-words-p").textContent = S.tone.words.praise;
}

function renderCross() {
  const cv = memory.crossVideo();
  $("n-cross").textContent = cv.authors.length || "";
  if (cv.videoCount < 2) { fill("cross", [], `영상을 2개 이상 분석하면 보여요. (지금 ${cv.videoCount}개)`); return; }
  fill("cross", cv.authors.slice(0, 40).map((a) => item({
    key: "x" + a.key,
    title: $("mask").checked ? (S.names?.get(a.key) || nameOf(a.key, a.name)) : a.name,
    meta: `영상 ${a.videos.length}개에 등장, 댓글 합계 ${a.total}개`,
    why: [...a.videos.map((v) => `${v.title.slice(0, 40)} (${v.count}개)`), a.sameChannel ? "모두 같은 채널의 영상이라 단골 시청자일 수 있음" : null].filter(Boolean),
    indices: V.byAuthor.get(a.key) || [],
  })), `분석한 영상 ${cv.videoCount}개에 함께 나타난 작성자는 없어요.`);
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
/** 평가 표현 근거 구절에 밑줄 */
function textWithSpans(text, spans) {
  const frag = document.createDocumentFragment();
  let at = 0;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    if (s.start < at) continue;
    frag.append(text.slice(at, s.start));
    const m = el("mark", s.type === "condemn" ? "hl-c" : "hl-p", text.slice(s.start, s.end));
    m.title = s.type === "condemn" ? "비난 표현 (추정)" : "칭찬 표현 (추정)";
    frag.append(m);
    at = s.end;
  }
  frag.append(text.slice(at));
  return frag;
}
function showDetail(i, { quiet = false } = {}) {
  picked = i;
  const box = $("detail");
  if (i < 0 || !S || shown !== "comments") { box.hidden = true; return; }
  const c = S.comments[i];
  box.hidden = false;
  $("d-list").hidden = true;
  $("d-actions").hidden = false;
  $("d-text").hidden = false;
  $("d-status").textContent = "";
  $("d-author").textContent = nameOf(keyOf(c), c.author);
  $("d-meta").textContent = `${c.createdAtRaw}  ♥ ${num(c.likes)}`;
  $("d-text").replaceChildren(textWithSpans(c.text, S.tone.tones[i].spans));
  const pBtn = $("d-parent");
  const pi = c.parentId ? V.indexById.get(c.parentId) : undefined;
  pBtn.hidden = !c.parentId;
  if (c.parentId) {
    const p = pi !== undefined ? S.comments[pi] : null;
    pBtn.textContent = p ? `↳ ${nameOf(keyOf(p), p.author)}의 댓글에 단 답글: ${p.text.slice(0, 80)}` : "↳ 답글 (원댓글은 수집 범위 밖)";
    pBtn.disabled = !p;
    pBtn.onclick = p ? () => { graph.select([pi + 1]); showDetail(pi); } : null;
  }
  const badges = [];
  badges.push(el("span", "badge", c.parentId ? "답글" : c.meta?.replyCount ? `댓글 (답글 ${num(c.meta.replyCount)}개)` : "댓글"));
  const cl = V.topic.ids[i];
  if (cl >= 0 && V.kwByCluster.has(cl)) {
    const b = el("span", "badge"); b.style.setProperty("--c", S.short[i] ? "#8D98AB" : TOPIC_COLORS[cl % TOPIC_COLORS.length]);
    b.append(el("i"), document.createTextNode(V.kwByCluster.get(cl).slice(0, 3).join(", ") || "주제"));
    badges.push(b);
  }
  if (V.flagged.has(i)) badges.push(el("span", "badge warn", "복붙 의심 묶음에 포함"));
  if (c.meta?.hearted) badges.push(el("span", "badge", "채널 주인이 하트"));
  const tag = graph.tagsArray()[i + 1];
  if (tag >= 0 && tagDefs[tag]) { const b = el("span", "badge"); b.style.setProperty("--c", TAG_COLORS[tag % TAG_COLORS.length]); b.append(el("i"), document.createTextNode(tagDefs[tag])); badges.push(b); }
  $("d-badges").replaceChildren(...badges);
  $("d-link").href = commentUrl(c);
  if (!quiet && !fixedTab && window.innerWidth < 820) box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/** 작성자 지도에서 점을 눌렀을 때 */
function showAuthor(ai) {
  const box = $("detail");
  const f = ai >= 0 ? V.aMap.list[ai] : null;
  if (!f) { box.hidden = true; return; }
  const a = V.aSignals.find((x) => x.key === f.key);
  box.hidden = false;
  $("d-parent").hidden = true;
  $("d-text").hidden = true;
  $("d-actions").hidden = true;
  $("d-status").textContent = "";
  $("d-author").textContent = nameOf(f.key, f.author);
  $("d-meta").textContent = `댓글 ${f.count}개  평균 좋아요 ${f.avgLikes.toFixed(1)}`;
  const badges = [el("span", a.state === "scored" && a.score >= weights.thresholds.flag ? "badge warn" : "badge", a.state === "scored" ? `의심 점수 ${a.score}` : "판단 보류")];
  for (const p of a.parts) badges.push(el("span", "badge", `${p.label} ${p.points > 0 ? "+" : ""}${p.points}`));
  for (const t of a.notes) badges.push(el("span", "badge", t));
  $("d-badges").replaceChildren(...badges);
  const list = $("d-list");
  list.hidden = false;
  list.replaceChildren(...f.indices.slice(0, 30).map((i) => {
    const li = el("li", "", S.comments[i].text.slice(0, 160));
    li.title = "댓글 지도에서 이 댓글 보기";
    li.onclick = () => { setMapMode("comments"); graph.select([i + 1]); showDetail(i); };
    return li;
  }));
}

/** 영상 페이지 안에서 실행: YouTube 자체의 내부 이동으로 '하이라이트 댓글'을 불러온다 (새로고침 없음). 실제 페이지에서 검증한 방식. */
function ytNavigateToComment(videoId, commentId) {
  const app = document.querySelector("ytd-app");
  if (!app || typeof app.fire !== "function") return false;
  const bytes = [122, commentId.length, ...[...commentId].map((c) => c.charCodeAt(0)), 162, 2, 3, 192, 1, 0];
  const params = encodeURIComponent(btoa(String.fromCharCode(...bytes)));
  app.fire("yt-navigate", {
    endpoint: {
      commandMetadata: { webCommandMetadata: { url: `/watch?v=${videoId}&lc=${commentId}`, webPageType: "WEB_PAGE_TYPE_WATCH", rootVe: 3832 } },
      watchEndpoint: { videoId, params },
    },
  });
  return true;
}

async function gotoComment() {
  if (picked < 0 || !S) return;
  if (finding) { send("WV_FIND_CANCEL").catch(() => {}); return; }
  const c = S.comments[picked];
  try {
    const tab = await targetTab();
    if (videoIdOf(tab) !== S.doc.meta.videoId) throw new Error("지금 열린 영상이 이 결과의 영상과 달라요. \"새 탭으로 열기\"를 쓰거나, 해당 영상으로 돌아가세요.");
    if (fixedTab) { // 크게 보기에서는 영상 탭을 앞으로
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    }
    finding = true;
    $("d-goto").textContent = "찾기 중지";
    // 확장을 설치·업데이트하기 전에 열린 탭에는 페이지 쪽 다리가 없다 → 매번 넣어 준다 (이미 있으면 아무 일도 안 함)
    try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", files: ["content/parse.js", "content/page-bridge.js"] }); } catch (e) { console.warn("[WV] bridge inject failed", e); }
    $("d-status").textContent = "페이지에서 댓글을 여는 중";
    // content script가 차례로 시도한다: 화면에 있음 → 댓글 영역만 다시 불러오기 → YouTube 내부 이동
    let r = await send("WV_FOCUS", { id: c.id, parentId: c.parentId });
    if (!r?.ok && r?.need === "navigate") {
      // 페이지 쪽 다리가 없을 때(아주 오래 열어 둔 탭 등): 패널에서 직접 내부 이동을 시도하고, 그래도 안 되면 스크롤 탐색
      let fired = false;
      try {
        const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: ytNavigateToComment, args: [S.doc.meta.videoId, c.id] });
        fired = !!res?.result;
      } catch (e) { console.warn("[WV] yt-navigate failed", e); }
      r = fired
        ? { ...(await send("WV_FOCUS_WAIT", { id: c.id, t: r.t, paused: r.paused })), via: "YouTube 내부 이동" }
        : { ...(await send("WV_FOCUS_SCAN", { id: c.id, parentId: c.parentId })), via: "스크롤 탐색" };
    }
    $("d-status").textContent = r?.ok
      ? `페이지에서 그 댓글을 열었어요. 댓글 맨 위에 강조돼 있습니다. (${r.via})`
      : `${r?.reason || "찾지 못했어요."} "새 탭으로 열기"로 바로 볼 수 있어요.${r?.detail ? ` [${r.detail}]` : ""}`;
  } catch (e) {
    $("d-status").textContent = e.message;
  } finally {
    finding = false;
    $("d-goto").textContent = "페이지에서 이 댓글 보기";
  }
}

// ---------- 내 분류 (개수 조절 가능) ----------
function renderTags(counts = []) {
  const box = $("tags");
  if (shown === "authors") return;
  // 이름을 입력하는 중이면 다시 그리지 않고 개수만 갱신
  if (box.contains(document.activeElement) && document.activeElement.tagName === "INPUT" && box.querySelectorAll(".tag").length === tagDefs.length) {
    box.querySelectorAll(".tag .n").forEach((b, t) => (b.textContent = `${num(counts[t] || 0)}개`));
    return;
  }
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
  box.replaceChildren(...chips);
  if (picked >= 0 && V && shown === "comments") showDetail(picked, { quiet: true });
}

// ---------- 크게 보기로 넘겨주기 ----------
function snapshot() {
  if (shown === "comments") savedTags = Array.from(graph.tagsArray());
  const L = V?.commentLayout;
  const { names, lexVecs, ...plain } = S; // Map은 넘기지 않는다. 벡터는 문자열 하나로 묶어 넘긴다
  return {
    S: plain, lexVecs: lexVecs ? packVectors(lexVecs) : null, tagDefs,
    res: $("res-range").value, thLex: $("th-lex").value,
    tags: savedTags,
    pos: L ? { x: Array.from(L.x), y: Array.from(L.y), pin: Array.from(L.pin) } : null,
  };
}
async function restoreFromPanel() {
  try {
    const snap = await chrome.runtime.sendMessage({ type: "WV_STATE_REQUEST", tabId: fixedTab });
    if (!snap?.S) return;
    S = snap.S;
    S.lexVecs = snap.lexVecs ? unpackVectors(snap.lexVecs) : null;
    tagDefs = snap.tagDefs;
    picked = -1; V = null; shown = null; mapMode = "comments"; topicCache = new Map();
    memory.add(S.doc, S.comments);
    showResult();
    setRes(Number(snap.res));
    renderPresets();
    setSlider("th-lex", snap.thLex);
    rebuild({ fresh: true, restore: { tags: snap.tags, pos: snap.pos } });
    setStatus("패널의 분석 결과를 그대로 가져왔어요.");
  } catch { /* 패널이 닫혀 있으면 여기서 새로 분석하면 된다 */ }
}

// ---------- 점수 기준 (기본 규칙 / 공개 데이터 보정) ----------
function refreshWeightsOption() {
  const opt = $("weights").querySelector('option[value="calibrated"]');
  opt.disabled = !calibrated;
  opt.textContent = calibrated ? `공개 데이터 보정 (${calibrated.version})` : "공개 데이터 보정 (미설치)";
}
async function initWeights() {
  calibrated = await loadCalibrated();
  refreshWeightsOption();
  $("weights").onchange = () => {
    weights = $("weights").value === "calibrated" && calibrated ? calibrated : DEFAULT_WEIGHTS;
    if (S) rebuild();
  };
}

// ---------- 이벤트 ----------
const collect = () => run("WV_COLLECT_ALL", {
  options: { max: Number($("max").value), sort: $("sort").value, includeReplies: $("replies").checked },
});
$("btn-all").onclick = collect;
$("btn-reanalyze").onclick = collect;
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
$("th-lex").oninput = () => { $("th-lex-val").textContent = Number($("th-lex").value).toFixed(2); };
$("th-lex").onchange = () => rebuild();
$("res-range").onchange = () => rebuild();
setSlider("th-lex", 0.6);
$("k-minus").onclick = () => stepTopics(-1);
$("k-plus").onclick = () => stepTopics(+1);
$("filter").onchange = () => { graph.setFilter($("filter").value); if (S && V && shown === "comments") setList(listSrc); };
$("links-on").onchange = () => graph.toggleReplyLinks($("links-on").checked);
$("labels-on").onchange = () => graph.toggleLabels($("labels-on").checked);
$("btn-fit").onclick = () => graph.fit();
$("btn-unpin").onclick = () => graph.unpinAll();
$("btn-theme").onclick = () => {
  const next = $("map").dataset.theme === "dark" ? "light" : "dark";
  $("map").dataset.theme = next;
  $("btn-theme").textContent = next === "dark" ? "밝게" : "어둡게";
  graph.setTheme(next);
  renderLegend();
};
$("color-by").onchange = () => drawMap();
$("mask").onchange = () => { if (S) { drawMap(); renderAuthors(); renderCross(); renderPatterns(); } };
document.querySelectorAll("#map-mode button").forEach((b) => (b.onclick = () => { if (S) setMapMode(b.dataset.mode); }));
$("d-goto").onclick = gotoComment;
document.querySelectorAll(".tabs button").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    document.querySelectorAll(".pane").forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.tab));
  };
});
$("btn-export").onclick = () => {
  if (!S) return;
  const tags = shown === "comments" ? graph.tagsArray() : savedTags || [];
  const mask = $("mask").checked;
  const comments = S.comments.map((c, i) => ({
    ...c,
    author: mask ? nameOf(keyOf(c), c.author) : c.author,
    authorId: mask ? null : c.authorId,
    topic: V.kwByCluster.get(V.topic.ids[i])?.join(", ") || null,
    copySuspect: V.flagged.has(i),
    myCategory: tags[i + 1] >= 0 ? tagDefs[tags[i + 1]] : null,
  }));
  const blob = new Blob([JSON.stringify({ doc: S.doc, scoring: { source: weights.source, version: weights.version }, comments }, null, 2)], { type: "application/json" });
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
initWeights();
if (fixedTab) restoreFromPanel();

// 자동 점검용 연결 고리 (tests/panel-smoke.mjs). 확장 프로그램에서는 정의돼 있지 않아 아무 일도 하지 않는다.
globalThis.__WV_TEST__?.({ graph, rebuild, drawMap, setMapMode, showDetail, showAuthor, snapshot, gotoComment, checkVideo, revealInList, pickFromList, listFromSelection, setList, state: () => ({ S, V, shown, mapMode, listSrc, listRows, listActive }) });
