// 화면 없는 분석 문서(chrome.offscreen, 이유 WORKERS). 팝업·사이드 패널이 닫혀도 분석을 끝까지 하고 결과를 탭별로 메모리에 둔다.
// 이 문서에서는 chrome.runtime만 쓸 수 있다. 처리는 lib/offscreen-core.js, 계산은 lib/worker-core.js → lib/pipeline.js.
// 화면이 없으므로 계산을 Worker로 다시 넘기지 않고 여기서 바로 한다(crossOriginIsolated·WebGPU 됨: qa/2026-12-02).
import { createOffscreenCore } from "../lib/offscreen-core.js";
import { createHandler } from "../lib/worker-core.js";

const IDLE_CLOSE_MS = 60e3; // 맡은 결과가 하나도 없으면 1분 뒤 닫아 모델 메모리를 돌려준다
let idleTimer = 0;
const core = createOffscreenCore({
  handler: createHandler(),
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
