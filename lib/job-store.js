// 탭별 분석 작업과 결과 (offscreen 문서의 메모리에만 둔다. 저장소·IndexedDB 안 씀).
// 툴바 팝업은 페이지를 누르면 닫히므로, 계산과 결과를 팝업 밖(offscreen 문서)에 두고 팝업·사이드 패널은 열릴 때 받아 간다.
// 탭이 닫히거나 그 탭이 다른 영상으로 가면 지운다. 탭이 많으면 오래 안 본 끝난 결과부터 지운다(메모리 상한).
//
// 항목: { tabId, videoId, job, phase: "collecting"|"analyzing"|"done"|"error", status, error, result, ui, at }
//   result = 분석 결과(lib/wire.js로 감싼 것), ui = 패널이 마지막으로 넘긴 화면 상태(snapshot)

export const MAX_TABS = 4;
const RUNNING = new Set(["collecting", "analyzing"]);

export function createJobStore({ max = MAX_TABS, now = Date.now } = {}) {
  const map = new Map();
  const touch = (e) => { e.at = now(); return e; };
  const evict = () => {
    // 상한을 넘으면 끝난 결과 중 가장 오래 안 본 것부터. 계산 중인 작업은 지우지 않는다.
    while (map.size > max) {
      let old = null;
      for (const e of map.values()) if (!RUNNING.has(e.phase) && (!old || e.at < old.at)) old = e;
      if (!old) break;
      map.delete(old.tabId);
    }
  };
  const mine = (tabId, job) => { const e = map.get(tabId); return e && e.job === job ? e : null; };
  return {
    start(tabId, { videoId, job }) {
      map.set(tabId, touch({ tabId, videoId, job, phase: "collecting", status: "댓글 모으기 시작", error: null, result: null, ui: null }));
      evict();
      return map.get(tabId);
    },
    progress(tabId, status, job = null) { const e = map.get(tabId); if (e && RUNNING.has(e.phase) && (job === null || e.job === job)) e.status = status; return e || null; },
    collected(tabId, job) { const e = mine(tabId, job); if (e && e.phase === "collecting") { e.phase = "analyzing"; e.status = "분석 준비 중"; } return e; },
    done(tabId, job, result) { const e = mine(tabId, job); if (e) { e.phase = "done"; e.result = result; e.status = ""; touch(e); evict(); } return e; },
    fail(tabId, job, error) { const e = mine(tabId, job); if (e) { e.phase = "error"; e.error = String(error); e.status = ""; } return e; },
    setUi(tabId, job, ui) { const e = mine(tabId, job); if (e && e.phase === "done") { e.ui = ui; touch(e); } return !!e; },
    get(tabId) { const e = map.get(tabId); return e ? touch(e) : null; },
    drop(tabId) { return map.delete(tabId); },
    /** 탭 주소가 바뀜: 다른 영상(또는 영상이 아닌 페이지)이면 그 탭의 결과를 지운다 */
    urlChanged(tabId, videoId) { const e = map.get(tabId); if (e && e.videoId !== videoId) { map.delete(tabId); return true; } return false; },
    get size() { return map.size; },
    tabs: () => [...map.keys()],
  };
}

/** content script의 수집 진행(WV_PROGRESS) → 보여 줄 문구. 패널과 offscreen이 같은 문구를 쓴다 */
export function progressText({ phase, count, total }) {
  const what = phase === "후보 확인" ? "무작위로 뽑을 후보 댓글 확인 중" : phase === "답글 받는 중" ? "뽑힌 댓글의 답글 받는 중" : "댓글 모으는 중";
  return `${what} ${Number(count).toLocaleString()}개${total ? ` (전체 약 ${Number(total).toLocaleString()}개)` : ""}`;
}
