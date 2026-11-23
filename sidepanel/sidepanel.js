// 역할 분리
// - 문구 임베딩(n-gram 해싱, 항상 계산, 즉시): 복붙·템플릿 의심 신호
// - 의미 임베딩(EmbeddingGemma, 선택): 그래프 배치, 주제 묶음(색), 본문 관련도
//   의미 모델을 못 쓰면 문구 임베딩으로 대체한다.
import { hashEmbed } from "../lib/embed/hash.js";
import { dot, topKNeighbors, edgesFromNeighbors, clustersFromEdges, pca2, adaptiveThreshold } from "../lib/vec.js";
import { createLayout } from "../lib/layout.js";
import { timeHistogram, clusterSignals, topicSummaries } from "../lib/analyze.js";
import { createGraph } from "./graph.js";

const $ = (id) => document.getElementById(id);
const FLAG_SCORE = 50;

// 모든 상태는 메모리에만. 패널을 닫으면 사라진다.
let S = null;
let focusKey = null;

$("ver").textContent = "v" + chrome.runtime.getManifest().version;

const graph = createGraph($("graph"), $("tooltip"), {
  onClick: (i) => {
    if (i === 0 || !S) return; // 0 = 본문 노드
    send("WV_FOCUS", { id: S.comments[i - 1].id }).catch(() => {});
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

async function run(type, extra) {
  const buttons = document.querySelectorAll("button, select");
  buttons.forEach((b) => (b.disabled = true));
  try {
    setStatus(type === "WV_LOAD_MORE" ? "스크롤하며 댓글 불러오는 중… (탭을 그대로 두세요)" : "댓글 읽는 중…");
    const res = await send(type, extra);
    if (!res?.ok) throw new Error(res?.error || "응답 없음");
    const { doc, comments } = res.data;
    if (!comments.length) throw new Error("댓글을 찾지 못했어요. 댓글 영역까지 스크롤한 뒤 다시 시도하세요.");

    const texts = [`${doc.title}\n${doc.text}`.slice(0, 1500), ...comments.map((c) => c.text)];
    const t0 = performance.now();

    // 1) 문구 임베딩 — 항상
    const lexVecs = hashEmbed(texts).slice(1);
    const lexNbrs = topKNeighbors(lexVecs, 8);
    const t1 = performance.now();

    // 2) 의미 임베딩 — 선택, 실패 시 문구 임베딩으로 대체
    let semAll = null, device = null, warn = "";
    if ($("mode").value === "auto") {
      try {
        setStatus(`의미 임베딩 준비 중… (${comments.length}개)`);
        const { semanticEmbed } = await import("../lib/embed/semantic.js");
        ({ vecs: semAll, device } = await semanticEmbed(texts, { onStatus: setStatus }));
      } catch (e) {
        console.warn("[WV] semantic failed", e);
        warn = ` · 의미 모델 사용 불가(${e.message}) → 문구 임베딩으로 대체`;
      }
    }
    const t2 = performance.now();

    const layoutAll = semAll || hashEmbed(texts);
    const semVecs = layoutAll.slice(1);
    const semNbrs = semAll ? topKNeighbors(semVecs, 8) : lexNbrs;
    const docSims = semVecs.map((v) => dot(layoutAll[0], v));
    const init = pca2(layoutAll);
    const t3 = performance.now();

    S = { doc, comments, lexNbrs, semNbrs, docSims, init, semantic: !!semAll, device };
    setSlider("th-sem", adaptiveThreshold(semNbrs, 2));
    focusKey = null;
    rebuild();

    const ms = (a, b) => `${Math.round(b - a)}ms`;
    setStatus(
      `댓글 ${comments.length}개 · 문구 ${ms(t0, t1)}` +
      (semAll ? ` · 의미(${device === "webgpu" ? "GPU" : "CPU"}) ${ms(t1, t2)}` : "") +
      ` · 그래프 ${ms(t2, t3)}${warn}`,
      !!warn
    );
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
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

  // 그래프: 0 = 본문, 1..n = 댓글
  const gEdges = semEdges.map((e) => ({ a: e.a + 1, b: e.b + 1, sim: e.sim }));
  docSims.forEach((s, i) => { if (s >= thSem) gEdges.push({ a: 0, b: i + 1, sim: s }); });
  const nodes = [
    { kind: "doc", label: doc.title, sub: "본문(제목+설명)", cluster: -1 },
    ...comments.map((c, i) => ({
      kind: "comment",
      label: c.text.slice(0, 140),
      sub: `${c.author} · ${c.createdAtRaw} · ♥ ${c.likes} · 본문 관련도 ${docSims[i].toFixed(2)}${flagged.has(i) ? " · 복붙 의심 신호" : ""}`,
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
  renderHistogram();
}

function renderSummary(topicGroups, flagged) {
  const { doc, comments } = S;
  $("result").hidden = false;
  $("doc-title").textContent = doc.title;
  $("doc-meta").textContent = `${doc.author} · ${doc.site} · ${S.semantic ? "의미(EmbeddingGemma) + 문구 임베딩" : "문구 임베딩만"}`;
  const authors = new Set(comments.map((c) => c.authorId || c.author)).size;
  $("stats").innerHTML = [
    [comments.length, "댓글"],
    [authors, "작성자"],
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
  const s = document.createElement("div");
  s.className = "sample";
  s.textContent = `“${sample.slice(0, 100)}”`;
  li.append(h, s);
  if (reasons?.length) {
    const ul = document.createElement("ul");
    for (const r of reasons) { const x = document.createElement("li"); x.textContent = r; ul.append(x); }
    li.append(ul);
  }
  li.onclick = () => {
    const on = focusKey !== key;
    focusKey = on ? key : null;
    graph.focus(on ? new Set([0, ...indices.map((i) => i + 1)]) : null);
    document.querySelectorAll(".clusters > li").forEach((x) => x.classList.remove("active"));
    if (on) li.classList.add("active");
  };
  return li;
}

function renderTopics(topics) {
  const ol = $("topics");
  ol.innerHTML = "";
  const list = topics.filter((t) => t.size >= 3).slice(0, 12);
  if (!list.length) { ol.innerHTML = `<li class="muted">3개 이상인 묶음이 없어요. 기준을 낮춰 보세요.</li>`; return; }
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
  ol.innerHTML = "";
  if (!signals.length) { ol.innerHTML = `<li class="muted">문구가 겹치는 묶음이 없어요.</li>`; return; }
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
for (const id of ["th-sem", "th-lex"]) {
  $(id).oninput = () => { $(id + "-val").textContent = Number($(id).value).toFixed(2); };
  $(id).onchange = rebuild;
}
setSlider("th-lex", 0.6);
$("mode").onchange = () => { if (S) setStatus("분석 방식이 바뀌었어요. 다시 분석하세요."); };
$("btn-export").onclick = () => {
  if (!S) return;
  const blob = new Blob([JSON.stringify({ doc: S.doc, comments: S.comments }, null, 2)], { type: "application/json" });
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
    $("mode").querySelector('option[value="auto"]').textContent += " — 미설치";
  }
});
