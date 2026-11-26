import { installOpenMode } from "./lib/open-mode.js";

// 툴바 아이콘: 사이드 패널 또는 아이콘 아래 팝업 (고른 모드는 브라우저가 기억하는 패널 동작 설정에서 읽는다)
installOpenMode();

// ---------- 분석 문서 (offscreen) ----------
// 팝업은 페이지를 누르면 닫히므로 분석과 결과를 화면 없는 문서(offscreen/offscreen.html)에 둔다. 저장소는 쓰지 않고 그 문서의 메모리에만.
// 서비스 워커는 문서를 만들고 닫고, 탭이 닫히거나 다른 영상으로 가면 그 탭의 결과를 지우라고 알린다(offscreen 문서는 tabs API를 못 씀).
const OFFSCREEN = "offscreen/offscreen.html";
let creating = null;
// getContexts는 Chrome 116부터. 없으면 모르는 것으로 보고 만들어 본다(이미 있으면 'single offscreen' 오류 → 있는 것)
async function hasOffscreen() {
  if (!chrome.runtime.getContexts) return false;
  return (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })).length > 0;
}
async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  creating ??= chrome.offscreen.createDocument({
    url: OFFSCREEN, reasons: ["WORKERS"],
    justification: "팝업이나 패널이 닫혀도 댓글 분석(임베딩·지도 계산)을 끝까지 하고, 그 탭이 열려 있는 동안 결과를 메모리에 둡니다.",
  }).catch((e) => { if (!/single offscreen/i.test(String(e?.message))) throw e; }).finally(() => { creating = null; });
  await creating;
}
// 문서가 있는지 따지지 않고 보낸다: 없으면 받을 곳이 없다는 오류만 나고(삼킴), 있는지 물을 수 없는 브라우저에서도 정리 알림이 간다
const tellOffscreen = (m) => chrome.runtime.sendMessage(m).catch(() => {});
const videoIdOf = (url) => { try { return url?.includes("youtube.com/watch") ? new URL(url).searchParams.get("v") : null; } catch { return null; } };
chrome.tabs.onRemoved.addListener((tabId) => tellOffscreen({ type: "WV_JOB_DROP", tabId }));
// tabs 권한이 없어 YouTube 밖으로 나간 탭은 주소가 안 보인다(info.url도 tab.url도 없음) → 영상 아님(null)으로 알려 지우게 한다
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === "loading") tellOffscreen({ type: "WV_JOB_URL", tabId, videoId: videoIdOf(info.url || tab?.url) });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "WV_OFFSCREEN_ENSURE") {
    if (!chrome.offscreen) { sendResponse({ ok: false, error: "no offscreen" }); return false; }
    ensureOffscreen().then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (msg?.type === "WV_OFFSCREEN_IDLE") { chrome.offscreen?.closeDocument().catch(() => {}); return false; }
  // 개발·점검용: YouTube 영상 주소 끝에 #wv-dev-open 을 붙이면 '크게 보기' 화면을 같은 탭 묶음의 새 탭으로 연다.
  // (자동화 도구가 확장 화면을 직접 눌러 보며 점검할 수 있게 하는 용도. 평소 사용에는 영향이 없다.)
  if (msg?.type !== "WV_DEV_OPEN" || !sender.tab) return false;
  const { id, index, groupId, windowId } = sender.tab;
  chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel/sidepanel.html?tab=${id}`), index: index + 1, windowId, active: true }, (tab) => {
    if (groupId !== undefined && groupId !== -1) chrome.tabs.group({ tabIds: [tab.id], groupId }).catch(() => {});
  });
  return false;
});
