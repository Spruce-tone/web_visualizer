// 화면 없는 분석 문서(chrome.offscreen, 이유 WORKERS). 팝업·사이드 패널이 닫혀도 분석을 끝까지 하고 결과를 탭별로 메모리에 둔다.
// 이 문서에서는 chrome.runtime만 쓸 수 있다. 처리는 lib/offscreen-core.js.
// 계산(임베딩·이웃·지도)은 이 문서가 만든 Web Worker(lib/analysis-worker.js → worker-core → pipeline)에서 한다.
// 그래서 계산 중에도 이 문서는 패널의 결과 요청에 바로 답한다. Worker를 못 쓰면 같은 처리를 이 문서에서 한다.
// 안에서 crossOriginIsolated·WebGPU·Worker 모두 됨: qa/2026-12-02.
import { createOffscreenCore } from "../lib/offscreen-core.js";
import { createHandler } from "../lib/worker-core.js";

/** worker-core와 같은 모양의 처리 함수 (msg, post). 메시지는 run 번호로 돌려준다 */
function workerHandler() {
  let direct = null;
  const here = () => (direct ??= createHandler());
  let w = null, alive = false, broken = false;
  const pending = new Map(); // run → {msg, post}
  try { w = new Worker(new URL("../lib/analysis-worker.js", import.meta.url), { type: "module" }); } catch { broken = true; }
  const giveUp = () => { // 불러오기 실패: 기다리던 일까지 이 문서에서 한다
    broken = true;
    w?.terminate();
    for (const { msg, post } of pending.values()) here()(msg, post);
    pending.clear();
  };
  if (w) {
    w.onmessage = ({ data: m }) => {
      alive = true;
      const p = pending.get(m.run);
      if (!p) return;
      if (m.type !== "status") pending.delete(m.run);
      p.post(m);
    };
    w.onerror = (e) => { e.preventDefault?.(); if (!alive) giveUp(); else console.warn("[WV] offscreen worker 오류", e.message || e); };
  }
  return (msg, post) => {
    if (broken) return here()(msg, post);
    pending.set(msg.run, { msg, post });
    w.postMessage(msg);
  };
}

const IDLE_CLOSE_MS = 60e3; // 맡은 결과가 하나도 없으면 1분 뒤 닫아 모델 메모리를 돌려준다
let idleTimer = 0;
const core = createOffscreenCore({
  handler: workerHandler(),
  broadcast: (m) => chrome.runtime.sendMessage(m).catch(() => {}),
  onEmpty: () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!core.store.size) chrome.runtime.sendMessage({ type: "WV_OFFSCREEN_IDLE" }).catch(() => {}); }, IDLE_CLOSE_MS);
  },
});
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "WV_JOB_START") clearTimeout(idleTimer);
  const out = core.onMessage(msg, sender);
  if (out !== undefined) sendResponse(out);
  return false;
});
