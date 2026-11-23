// 역할 분리
// - 문구 임베딩(n-gram 해싱, 항상 계산, 즉시): 복붙·템플릿 의심 신호
// - 의미 임베딩(Qwen3-Embedding / EmbeddingGemma, 선택): 그래프 배치, 주제 묶음(색), 본문 관련도
//   의미 모델을 못 쓰면 문구 임베딩으로 대체한다.
import { hashEmbed } from "../lib/embed/hash.js";
import { dot, topKNeighbors, edgesFromNeighbors, clustersFromEdges, pca2, adaptiveThreshold } from "../lib/vec.js";
import { createLayout } from "../lib/layout.js";
import { timeHistogram, clusterSignals, topicSummaries, authorActivity } from "../lib/analyze.js";
import { createGraph, TAG_COLORS } from "./graph.js";

const $ = (id) => document.getElementById(id);
const FLAG_SCORE = 50;

// 모든 상태는 메모리에만. 패널을 닫으면 사라진다.
let S = null;
let focusKey = null;
const tagNames = ["분류 1", "분류 2", "분류 3", "분류 4"];

$("ver").textContent = "v" + chrome.runtime.getManifest().version;

const graph = createGraph($("graph"), $("tooltip"), {
  onClick: async (i) => {
    if (i === 0 || !S) return; // 0 = 본문 노드
    try {
      const r = await send("WV_FOCUS", { id: S.comments[i - 1].id });
      if (r?.navigated) setStatus("페이지에 아직 없는 댓글이라, 해당 댓글이 맨 위에 보이도록 영상을 다시 열었어요.");
    } catch { /* 무시 */ }
  },
  onTagsChange: (counts) => renderTags(counts),
  onSelectionChange: (n) => ($("sel-count").textContent = `선택 ${n}개`),
});

function setStatus(msg, isError = false) {
  $("status").textContent = msg;
  $("status").classList.toggle("error", isError);
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes("youtube.com/watch")) throw new Error("YouTube 영상 페이지에서 사용하세요. (현재 YouTube만 지원)");
  return tab;
}

async function send(type, extra = {}) {
  const tab = await activeTab();
  try {
    return await chrome.tabs.sendMessage(tab.id, { type, ...extra });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/parse.js", "content/youtube.js"] });
    return await chrome.tabs.sendMessage(tab.id, { type, ...extra });
  }
}

// 수집 진행률 (content script → 패널)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "WV_PROGRESS") {
    setStatus(`댓글 수집 중… ${msg.count.toLocaleString()}개${msg.total ? ` / 전체 약 ${msg.total.toLocaleString()}개` : ""}`);
  }
});

function setBusy(busy) {
  document.querySelectorAll(".controls button, .controls select, .controls input").forEach((b) => (b.disabled = busy));
  $("btn-cancel").hidden = !busy;
  $("btn-cancel").disabled = false;
}

const yieldUI = () => new Promise((r) => setTimeout(r, 0));

async function run(type, extra) {
  setBusy(true);
  try {
    setStatus(type === "WV_COLLECT_ALL" ? "댓글 수집 시작…" : "보이는 댓글 읽는 중…");
    const res = await send(type, extra);
    if (!res?.ok) throw new Error(res?.error || "응답 없음");
    const { doc, comments } = res.data;
    if (!comments.length) throw new Error("댓글을 찾지 못했어요. 댓글이 꺼져 있는지 확인하세요.");
    const notes = [];
    if (res.fallback) notes.push(`전체 수집 실패(${res.fallback}) → 보이는 댓글만 분석`);
    if (doc.meta.collection?.cancelled) notes.push("중지됨 — 수집한 만큼 분석");

    const texts = [`${doc.title}\n${doc.text}`.slice(0, 1500), ...comments.map((c) => c.text)];
    const t0 = performance.now();

    // 1) 문구 임베딩 — 항상
    setStatus(`문구 분석 중… (${comments.length.toLocaleString()}개)`);
    await yieldUI();
    const lexVecs = hashEmbed(texts).slice(1);
    const lexNbrs = topKNeighbors(lexVecs, 8);
    const t1 = performance.now();

    // 2) 의미 임베딩 — 선택, 실패 시 문구 임베딩으로 대체
    let semAll = null, device = null, modelLabel = null;
    const mode = $("mode").value;
    if (mode !== "fast") {
      try {
        const { semanticEmbed } = await import("../lib/embed/semantic.js");
        ({ vecs: semAll, device, label: modelLabel } = await semanticEmbed(texts, { model: mode, onStatus: setStatus }));
      } catch (e) {
        console.warn("[WV] semantic failed", e);
        notes.push(`의미 모델 사용 불가(${e.message}) → 문구 임베딩으로 대체`);
      }
    }
    const t2 = performance.now();

    setStatus("그래프 계산 중…");
    await yieldUI();
    const layoutAll = semAll || hashEmbed(texts);
    const semVecs = layoutAll.slice(1);
    const semNbrs = semAll ? topKNeighbors(semVecs, 8) : lexNbrs;
    const docSims = semVecs.map((v) => dot(layoutAll[0], v));
    const init = pca2(layoutAll);
    const t3 = performance.now();

    S = { doc, comments, lexNbrs, semNbrs, docSims, init, semantic: !!semAll, device, modelLabel };
    setSlider("th-sem", adaptiveThreshold(semNbrs, 2));
    rebuild();

    const sec = (a, b) => `${((b - a) / 1000).toFixed(1)}초`;
    setStatus(
      [`댓글 ${comments.length.toLocaleString()}개`, `문구 ${sec(t0, t1)}`,
        semAll ? `의미(${device === "webgpu" ? "GPU" : "CPU"}) ${sec(t1, t2)}` : null,
        `그래프 ${sec(t2, t3)}`, ...notes].filter(Boolean).join(" · "),
      notes.some((n) => n.includes("실패") || n.includes("불가"))
    );
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    setBusy(false);
  }
}

function setSlider(id, v) {
  $(id).value = v;
  $(id + "-val").textContent = Number(v).toFixed(2);
}

/** 슬라이더 변경 시: 캐시된 이웃으로 간선/묶음만 다시 계산 (임베딩 재계산 없음) */
function rebuild() {
  if (!S) return;
  const { doc, comments, lexNbrs, semNbrs, docSims, init } = S;
  const thSem = Number($("th-sem").value), thLex = Number($("th-lex").value);

  // 문구 → 의심 신호
  const lexEdges = edgesFromNeighbors(lexNbrs, thLex);
  const lex = clustersFromEdges(comments.length, lexEdges);
  const signals = clusterSignals(lex.groups, comments, lexEdges);
  const flagged = new Set(signals.filter((s) => s.score >= FLAG_SCORE).flatMap((s) => s.indices));

  // 의미 → 배치·주제
  const semEdges = edgesFromNeighbors(semNbrs, thSem);
  const topic = clustersFromEdges(comments.length, semEdges);
  const topics = topicSummaries(topic.groups, comments, semEdges, docSims);
  const authors = authorActivity(comments, { minCount: 3, topicIds: topic.ids });

  // 그래프: 0 = 본문, 1..n = 댓글
  const gEdges = semEdges.map((e) => ({ a: e.a + 1, b: e.b + 1, sim: e.sim }));
  docSims.forEach((s, i) => { if (s >= thSem) gEdges.push({ a: 0, b: i + 1, sim: s }); });
  const nodes = [
    { kind: "doc", label: doc.title, sub: "본문(제목+설명)", cluster: -1 },
    ...comments.map((c, i) => ({
      kind: "comment",
      label: c.text.slice(0, 160),
      sub: `${c.parentId ? "↳ 답글 · " : ""}${c.author} · ${c.createdAtRaw} · ♥ ${c.likes} · 본문 관련도 ${docSims[i].toFixed(2)}${flagged.has(i) ? " · 복붙 의심 신호" : ""}`,
      cluster: topic.ids[i],
      likes: c.likes,
      flag: flagged.has(i),
    })),
  ];
  graph.set({ layout: createLayout(init, gEdges, { pinned: [0] }), edges: gEdges, nodes, focus: null });
  focusKey = null;

  renderSummary(topic.groups, flagged);
  renderTopics(topics);
  renderSignals(signals);
  renderAuthors(authors);
  renderHistogram();
}

function renderSummary(topicGroups, flagged) {
  const { doc, comments } = S;
  $("result").hidden = false;
  $("doc-title").textContent = doc.title;
  const total = doc.meta.totalComments ? ` / 전체 약 ${doc.meta.totalComments.toLocaleString()}` : "";
  const how = S.semantic ? `${S.modelLabel.split(" · ")[1]} + 문구 임베딩` : "문구 임베딩만";
  $("doc-meta").textContent = `${doc.author} · 수집 ${comments.length.toLocaleString()}${total} · ${how}`;
  const authors = new Set(comments.map((c) => c.authorId || c.author)).size;
  $("stats").innerHTML = [
    [comments.length.toLocaleString(), "댓글"],
    [authors.toLocaleString(), "작성자"],
    [topicGroups.filter((g) => g.length >= 3).length, "주제 묶음(3+)"],
    [`${Math.round((flagged.size / comments.length) * 100)}%`, "복붙 의심 비율"],
  ].map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join("");
  $("topics-title").firstChild.textContent = S.semantic ? "주제 묶음 " : "주제 묶음 (문구 기준) ";
}

function clusterItem({ key, color, head, score, sample, reasons, indices }) {
  const li = document.createElement("li");
  li.style.setProperty("--c", color);
  const h = document.createElement("div");
  h.className = "head";
  const left = document.createElement("span"); left.textContent = head;
  h.append(left);
  if (score !== undefined) {
    const sc = document.createElement("span");
    sc.className = "score " + (score >= FLAG_SCORE ? "hi" : score === 0 ? "none" : "");
    sc.textContent = `신호 ${score}`;
    h.append(sc);
  }
  li.append(h);
  if (sample) {
    const s = document.createElement("div");
    s.className = "sample";
    s.textContent = `“${sample.slice(0, 100)}”`;
    li.append(s);
  }
  if (reasons?.length) {
    const ul = document.createElement("ul");
    for (const r of reasons) { const x = document.createElement("li"); x.textContent = r; ul.append(x); }
    li.append(ul);
  }
  li.onclick = () => {
    const on = focusKey !== key;
    focusKey = on ? key : null;
    const nodeIdx = indices.map((i) => i + 1);
    graph.focus(on ? new Set([0, ...nodeIdx]) : null);
    if (on) graph.select(nodeIdx); else graph.clearSelection(); // 강조한 묶음을 바로 1~4 키로 분류할 수 있게 선택
    document.querySelectorAll(".clusters > li").forEach((x) => x.classList.remove("active"));
    if (on) li.classList.add("active");
  };
  return li;
}

function emptyItem(ol, text) {
  const li = document.createElement("li");
  li.className = "muted";
  li.textContent = text;
  ol.append(li);
}

function renderTopics(topics) {
  const ol = $("topics");
  ol.replaceChildren();
  const list = topics.filter((t) => t.size >= 3).slice(0, 12);
  if (!list.length) return emptyItem(ol, "3개 이상인 묶음이 없어요. 기준을 낮춰 보세요.");
  for (const t of list) {
    ol.append(clusterItem({
      key: "t" + t.cluster,
      color: graph.palette[t.cluster % graph.palette.length],
      head: `${t.size}개 · 작성자 ${t.authors}명 · ♥ ${t.likes} · 본문 관련도 ${t.docSim.toFixed(2)}`,
      sample: t.sample,
      indices: t.indices,
    }));
  }
}

function renderSignals(signals) {
  const ol = $("signals");
  ol.replaceChildren();
  if (!signals.length) return emptyItem(ol, "문구가 겹치는 묶음이 없어요.");
  for (const s of signals.slice(0, 12)) {
    ol.append(clusterItem({
      key: "s" + s.cluster,
      color: s.score >= FLAG_SCORE ? "var(--warn)" : "var(--line)",
      head: `${s.size}개 · 작성자 ${s.authors}명 · ♥ ${s.likes}`,
      score: s.score,
      sample: s.sample,
      reasons: s.reasons,
      indices: s.indices,
    }));
  }
}

function fmtSpan(ms) {
  if (ms === null) return "시간 정보 없음";
  const h = ms / 3600e3;
  return h < 1 ? "1시간 이내에 작성" : h < 48 ? `${Math.round(h)}시간에 걸쳐 작성` : `${Math.round(h / 24)}일에 걸쳐 작성`;
}

function renderAuthors(authors) {
  const ol = $("authors");
  ol.replaceChildren();
  if (!authors.length) return emptyItem(ol, "3개 이상 쓴 작성자가 없어요.");
  for (const a of authors.slice(0, 10)) {
    ol.append(clusterItem({
      key: "a" + (a.authorId || a.author),
      color: "var(--accent)",
      head: `${a.author} · ${a.count}개 (${(a.share * 100).toFixed(1)}%) · 답글 ${a.replies} · ♥ ${a.likes}`,
      reasons: [fmtSpan(a.span), a.topics !== null ? `주제 묶음 ${a.topics}곳에 등장` : null].filter(Boolean),
      indices: a.indices,
    }));
  }
}

function renderTags(counts = [0, 0, 0, 0]) {
  const box = $("tags");
  if (!box.children.length) {
    TAG_COLORS.forEach((c, t) => {
      const el = document.createElement("div");
      el.className = "tag";
      el.style.setProperty("--c", c);
      const sw = document.createElement("span"); sw.className = "sw"; sw.title = "이 분류의 댓글 선택";
      const input = document.createElement("input"); input.value = tagNames[t]; input.title = `분류 이름 (키보드 ${t + 1})`;
      input.oninput = () => (tagNames[t] = input.value);
      const n = document.createElement("span"); n.className = "n"; n.title = "이 분류의 댓글 선택";
      const pickTag = () => graph.select(graph.tagged(t));
      sw.onclick = pickTag; n.onclick = pickTag;
      el.append(sw, input, n);
      box.append(el);
    });
  }
  [...box.children].forEach((el, t) => (el.querySelector(".n").textContent = `${t + 1} · ${counts[t]}개`));
}

function renderHistogram() {
  const bins = timeHistogram(S.comments);
  const el = $("hist");
  if (!bins.length) { el.innerHTML = `<p class="muted">시간 정보 없음</p>`; return; }
  const W = 300, H = 60, pad = 14, max = Math.max(...bins.map((b) => b.count));
  const bw = (W - 4) / bins.length;
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H + pad}">` +
    bins.map((b, i) => {
      const h = max ? (b.count / max) * H : 0;
      return `<rect x="${2 + i * bw}" y="${H - h}" width="${Math.max(bw - 1.5, 1)}" height="${h}"><title>${esc(b.label)}: ${b.count}개</title></rect>`;
    }).join("") +
    `<text x="2" y="${H + 11}">${esc(bins[0].label)}</text><text x="${W - 2}" y="${H + 11}" text-anchor="end">${esc(bins.at(-1).label)}</text></svg>`;
}

// 이벤트
$("btn-all").onclick = () => run("WV_COLLECT_ALL", {
  options: { max: Number($("max").value), sort: $("sort").value, includeReplies: $("replies").checked },
});
$("btn-visible").onclick = () => run("WV_EXTRACT");
$("btn-cancel").onclick = () => {
  $("btn-cancel").disabled = true;
  setStatus("중지하는 중… 지금까지 모은 댓글로 분석해요.");
  send("WV_CANCEL").catch(() => {});
};
for (const id of ["th-sem", "th-lex"]) {
  $(id).oninput = () => { $(id + "-val").textContent = Number($(id).value).toFixed(2); };
  $(id).onchange = rebuild;
}
setSlider("th-lex", 0.6);
renderTags();
$("btn-clear-sel").onclick = () => graph.clearSelection();
$("btn-unpin").onclick = () => graph.unpinAll();
$("mode").onchange = () => { if (S) setStatus("의미 모델이 바뀌었어요. 다시 분석하면 적용돼요."); };
$("btn-export").onclick = () => {
  if (!S) return;
  const tags = graph.tagsArray();
  const comments = S.comments.map((c, i) => ({ ...c, manualTag: tags[i + 1] >= 0 ? tagNames[tags[i + 1]] : null }));
  const blob = new Blob([JSON.stringify({ doc: S.doc, comments }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${S.doc.id.replace(":", "_")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

// 의미 모델 라이브러리가 없으면 '문구만'을 기본으로
import("../lib/embed/semantic.js").then(async ({ semanticAvailable }) => {
  if (!(await semanticAvailable())) {
    $("mode").value = "fast";
    $("mode").querySelectorAll('option:not([value="fast"])').forEach((o) => (o.textContent += " — 미설치"));
  }
});
