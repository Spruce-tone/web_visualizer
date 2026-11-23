import { timeHistogram, topByLikes, exactDuplicates } from "../lib/analyze.js";

const $ = (id) => document.getElementById(id);
let current = null; // { doc, comments }

function setStatus(msg, isError = false) {
  $("status").textContent = msg;
  $("status").classList.toggle("error", isError);
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function send(type, extra = {}) {
  const tab = await activeTab();
  if (!tab?.url?.includes("youtube.com/watch")) {
    throw new Error("YouTube 영상 페이지에서 사용하세요. (M0는 YouTube만 지원)");
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, { type, ...extra });
  } catch {
    // 확장 설치 전에 열린 탭이면 content script가 없음 → 주입 후 재시도
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/parse.js", "content/youtube.js"] });
    return await chrome.tabs.sendMessage(tab.id, { type, ...extra });
  }
}

async function run(type, extra) {
  setStatus(type === "WV_LOAD_MORE" ? "스크롤하며 댓글 불러오는 중… (탭을 그대로 두세요)" : "추출 중…");
  document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    const res = await send(type, extra);
    if (!res?.ok) throw new Error(res?.error || "응답 없음");
    current = res.data;
    render(current);
    setStatus(`댓글 ${current.comments.length}개 추출 완료`);
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    document.querySelectorAll("button").forEach((b) => (b.disabled = false));
    $("btn-export").disabled = !current;
  }
}

function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function render({ doc, comments }) {
  $("doc").hidden = false;
  $("doc-title").textContent = doc.title;
  $("doc-meta").textContent = `${doc.author} · ${doc.site}`;

  const tops = comments.filter((c) => !c.parentId);
  const authors = new Set(comments.map((c) => c.authorId || c.author));
  $("stats").innerHTML = [
    [comments.length, "댓글(답글 포함)"],
    [tops.length, "최상위 댓글"],
    [authors.size, "고유 작성자"],
  ].map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join("");

  // 시간 분포
  const bins = timeHistogram(comments);
  $("hist-wrap").hidden = !bins.length;
  if (bins.length) {
    const W = 300, H = 90, pad = 14, max = Math.max(...bins.map((b) => b.count));
    const bw = (W - 4) / bins.length;
    $("hist").innerHTML = `<svg viewBox="0 0 ${W} ${H + pad}">` +
      bins.map((b, i) => {
        const h = max ? (b.count / max) * H : 0;
        return `<rect x="${2 + i * bw}" y="${H - h}" width="${Math.max(bw - 2, 1)}" height="${h}"><title>${b.label}: ${b.count}개</title></rect>`;
      }).join("") +
      `<text x="2" y="${H + 11}">${esc(bins[0].label)}</text>` +
      `<text x="${W - 2}" y="${H + 11}" text-anchor="end">${esc(bins.at(-1).label)}</text></svg>`;
  }

  // 좋아요 상위
  const top = topByLikes(comments, 5);
  $("top-wrap").hidden = !top.length;
  $("top").innerHTML = top.map((c) =>
    `<li>${esc(c.text.slice(0, 120))}<br><span class="who">${esc(c.author)} · ${esc(c.createdAtRaw)}</span> <span class="likes">♥ ${c.likes}</span></li>`
  ).join("");

  // 동일 문구
  const dups = exactDuplicates(comments);
  $("dup-wrap").hidden = false;
  $("dups").innerHTML = dups.length
    ? dups.slice(0, 10).map((g) => `<li>“${esc(g.text.slice(0, 80))}” × ${g.count} <span class="who">(${g.authors} 명)</span></li>`).join("")
    : `<li class="muted">발견되지 않음</li>`;
}

$("btn-extract").onclick = () => run("WV_EXTRACT");
$("btn-more").onclick = () => run("WV_LOAD_MORE", { options: { max: Number($("max").value) || 300 } });
$("btn-export").onclick = () => {
  if (!current) return;
  const blob = new Blob([JSON.stringify(current, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${current.doc.id.replace(":", "_")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};
