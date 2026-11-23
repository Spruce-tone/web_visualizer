import { hashEmbed } from "../lib/embed/hash.js";
import { dot, topKNeighbors, edgesFromNeighbors, clustersFromEdges, pca2 } from "../lib/vec.js";
import { createLayout } from "../lib/layout.js";
import { timeHistogram, clusterSignals } from "../lib/analyze.js";
import { createGraph } from "./graph.js";

const $ = (id) => document.getElementById(id);
const DEFAULT_TH = { hash: 0.6, semantic: 0.9 };

// 모든 상태는 메모리에만. 패널을 닫으면 사라진다.
let S = null; // { doc, comments, vecs, docSims, nbrs, embedder }
let activeCluster = null;

const graph = createGraph($("graph"), $("tooltip"), {
  onClick: (i) => {
    if (i === 0) return; // 본문 노드
    const c = S.comments[i - 1];
    send("WV_FOCUS", { id: c.id }).catch(() => {});
  },
});

function setStatus(msg, isError = false) {
  $("status").textContent = msg;
  $("status").classList.toggle("error", isError);
}

async function send(type, extra = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes("youtube.com/watch")) throw new Error("YouTube 영상 페이지에서 사용하세요. (현재 YouTube만 지원)");
  try {
    return await chrome.tabs.sendMessage(tab.id, { type, ...extra });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/parse.js", "content/youtube.js"] });
    return await chrome.tabs.sendMessage(tab.id, { type, ...extra });
  }
}

async function embed(texts, kind) {
  if (kind === "semantic") {
    const { semanticEmbed } = await import("../lib/embed/semantic.js");
    return semanticEmbed(texts, { onStatus: setStatus });
  }
  return hashEmbed(texts);
}

async function run(type, extra) {
  const buttons = document.querySelectorAll("button");
  buttons.forEach((b) => (b.disabled = true));
  try {
    setStatus(type === "WV_LOAD_MORE" ? "스크롤하며 댓글 불러오는 중… (탭을 그대로 두세요)" : "댓글 읽는 중…");
    const res = await send(type, extra);
    if (!res?.ok) throw new Error(res?.error || "응답 없음");
    const { doc, comments } = res.data;
    if (!comments.length) throw new Error("댓글을 찾지 못했어요. 댓글 영역까지 스크롤한 뒤 다시 시도하세요.");

    const kind = $("embedder").value;
    const t0 = performance.now();
    setStatus(`임베딩 중… (${comments.length}개)`);
    const all = await embed([`${doc.title}\n${doc.text}`.slice(0, 1500), ...comments.map((c) => c.text)], kind);
    const t1 = performance.now();
    const vecs = all.slice(1);
    const docSims = vecs.map((v) => dot(all[0], v));
    const nbrs = topKNeighbors(vecs, 8);
    const init = pca2(all);
    const t2 = performance.now();

    S = { doc, comments, vecs, docSims, nbrs, init, embedder: kind };
    activeCluster = null;
    rebuild();
    setStatus(`댓글 ${comments.length}개 · 임베딩 ${Math.round(t1 - t0)}ms · 유사도 계산 ${Math.round(t2 - t1)}ms`);
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

/** 임계값이 바뀌면 이웃 캐시로 간선/클러스터만 다시 계산 (임베딩 재계산 없음) */
function rebuild() {
  if (!S) return;
  const th = Number($("th").value);
  const { doc, comments, docSims, nbrs, init } = S;
  const edges = edgesFromNeighbors(nbrs, th);
  const { ids, groups } = clustersFromEdges(comments.length, edges);
  const signals = clusterSignals(groups, comments, edges);

  // 그래프: 0번 = 본문, 1..n = 댓글
  const gEdges = edges.map((e) => ({ a: e.a + 1, b: e.b + 1, sim: e.sim }));
  docSims.forEach((s, i) => { if (s >= th) gEdges.push({ a: 0, b: i + 1, sim: s }); });
  const nodes = [
    { kind: "doc", label: doc.title, sub: "본문(제목+설명)", cluster: -1 },
    ...comments.map((c, i) => ({
      kind: "comment",
      label: c.text.slice(0, 140),
      sub: `${c.author} · ${c.createdAtRaw} · ♥ ${c.likes} · 본문 유사도 ${docSims[i].toFixed(2)}`,
      cluster: ids[i],
      likes: c.likes,
    })),
  ];
  graph.set({ layout: createLayout(init, gEdges, { pinned: [0] }), edges: gEdges, nodes, focusCluster: activeCluster });

  renderSummary(groups, edges);
  renderClusters(signals);
  renderHistogram();
}

function renderSummary(groups) {
  const { doc, comments, docSims } = S;
  $("result").hidden = false;
  $("doc-title").textContent = doc.title;
  $("doc-meta").textContent = `${doc.author} · ${doc.site} · ${S.embedder === "hash" ? "문자 n-gram 임베딩" : "의미 임베딩"}`;
  const authors = new Set(comments.map((c) => c.authorId || c.author)).size;
  const inCluster = groups.reduce((s, g) => s + g.length, 0);
  const meanDoc = docSims.reduce((s, x) => s + x, 0) / docSims.length;
  $("stats").innerHTML = [
    [comments.length, "댓글"],
    [authors, "작성자"],
    [`${Math.round((inCluster / comments.length) * 100)}%`, "유사 묶음 비율"],
    [meanDoc.toFixed(2), "본문 유사도 평균"],
  ].map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join("");
}

function renderClusters(signals) {
  const ol = $("clusters");
  ol.innerHTML = "";
  if (!signals.length) {
    ol.innerHTML = `<li class="muted">이 임계값에서는 유사 묶음이 없어요. 슬라이더를 낮춰 보세요.</li>`;
    return;
  }
  for (const s of signals.slice(0, 15)) {
    const li = document.createElement("li");
    li.style.setProperty("--c", graph.palette[s.cluster % graph.palette.length]);
    li.classList.toggle("active", activeCluster === s.cluster);
    const head = document.createElement("div");
    head.className = "head";
    head.innerHTML = `<span>${s.size}개 · 작성자 ${s.authors}명 · ♥ ${s.likes}</span><span class="score ${s.score >= 50 ? "hi" : ""}">신호 ${s.score}</span>`;
    const sample = document.createElement("div");
    sample.className = "sample";
    sample.textContent = `“${s.sample.slice(0, 100)}”`;
    const ul = document.createElement("ul");
    for (const r of s.reasons) { const x = document.createElement("li"); x.textContent = r; ul.append(x); }
    li.append(head, sample, ul);
    li.onclick = () => {
      activeCluster = activeCluster === s.cluster ? null : s.cluster;
      graph.focus(activeCluster);
      ol.querySelectorAll("li").forEach((x) => x.classList.remove("active"));
      if (activeCluster !== null) li.classList.add("active");
    };
    ol.append(li);
  }
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
$("btn-extract").onclick = () => run("WV_EXTRACT");
$("btn-more").onclick = () => run("WV_LOAD_MORE", { options: { max: Number($("max").value) || 300 } });
$("th").oninput = () => { $("th-val").textContent = Number($("th").value).toFixed(2); };
$("th").onchange = rebuild;
$("embedder").onchange = () => {
  const v = DEFAULT_TH[$("embedder").value];
  $("th").value = v;
  $("th-val").textContent = v.toFixed(2);
  if (S) setStatus("임베딩 방식이 바뀌었어요. 다시 분석하세요.");
};
$("btn-export").onclick = () => {
  if (!S) return;
  const blob = new Blob([JSON.stringify({ doc: S.doc, comments: S.comments }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${S.doc.id.replace(":", "_")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};
