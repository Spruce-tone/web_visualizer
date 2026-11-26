// 화면 없는 분석 문서(chrome.offscreen, 이유 WORKERS). 팝업·사이드 패널이 닫혀도 분석을 끝까지 하고 결과를 탭별로 메모리에 둔다.
// 이 문서에서는 chrome.runtime만 쓸 수 있다. 처리는 lib/offscreen-core.js.
// 계산(임베딩·이웃·지도)은 이 문서가 만든 Web Worker(lib/analysis-worker.js → worker-core → pipeline)에서 한다.
// 그래서 계산 중에도 이 문서는 패널의 결과 요청에 바로 답한다. Worker를 못 쓰거나 멈추면 같은 처리를 이 문서에서 한다(lib/offscreen-worker.js).
// 안에서 crossOriginIsolated·WebGPU·Worker 모두 됨: qa/2026-12-02.
import { createOffscreenCore } from "../lib/offscreen-core.js";
import { createHandler } from "../lib/worker-core.js";
import { createWorkerHandler } from "../lib/offscreen-worker.js";

const IDLE_CLOSE_MS = 60e3; // 맡은 결과가 하나도 없으면 1분 뒤 닫아 모델 메모리를 돌려준다
let idleTimer = 0;
const core = createOffscreenCore({
  // Worker가 못 뜨거나 멈추면(시간 제한) 이 문서에서 계산한다
  handler: createWorkerHandler({ makeWorker: () => new Worker(new URL("../lib/analysis-worker.js", import.meta.url), { type: "module" }), fallback: () => createHandler() }),
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
