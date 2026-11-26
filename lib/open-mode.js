// 툴바 아이콘을 누르면 무엇을 여는지: "panel"(옆 사이드 패널) / "popup"(아이콘 아래로 내려오는 창).
//
// 따로 저장하지 않는다(storage 권한·IndexedDB 없음). 브라우저는 sidePanel 동작 설정(openPanelOnActionClick)을
// 프로필 설정에 스스로 기억하므로 그 값을 기준으로 삼는다: true = 패널, false = 팝업.
// action 팝업 설정은 브라우저가 기억하지 않으므로(확장을 다시 불러오면 비워짐) 서비스 워커가 깰 때마다 다시 맞춘다.
// 확인: qa/2026-12-02/POPUP-PLAN.md 1절.

export const POPUP_PATH = "sidepanel/sidepanel.html?mode=popup";

/** 지금 모드. 처음 설치한 직후(값 false)는 onInstalled에서 panel로 바꿔 둔다. */
export async function getOpenMode(api = globalThis.chrome) {
  const b = await api.sidePanel.getPanelBehavior();
  return b?.openPanelOnActionClick === false ? "popup" : "panel";
}

/** 모드 바꾸기. 두 설정을 늘 함께 바꾼다(팝업이 있으면 패널 동작보다 팝업이 먼저 뜨는 브라우저가 있음). */
export async function setOpenMode(mode, api = globalThis.chrome) {
  const popup = mode === "popup";
  await api.action.setPopup({ popup: popup ? POPUP_PATH : "" });
  await api.sidePanel.setPanelBehavior({ openPanelOnActionClick: !popup });
  return popup ? "popup" : "panel";
}

/**
 * 서비스 워커용: 깨어날 때마다 팝업 설정을 기억된 모드에 맞추고, 처음 설치면 패널로 둔다.
 * 읽기와 쓰기가 섞이지 않게 한 줄로 세운다(설치 직후 '읽기 false → 설치 처리 panel → 늦은 쓰기 popup'을 막음).
 */
export function installOpenMode(api = globalThis.chrome) {
  let q = Promise.resolve();
  const queue = (f) => (q = q.then(f, f).catch((e) => console.error("[WV] open mode", e)));
  queue(async () => setOpenMode(await getOpenMode(api), api));
  api.runtime.onInstalled.addListener(({ reason }) => { if (reason === "install") queue(() => setOpenMode("panel", api)); });
  return () => q;
}
