// 페이지(메인 월드)에서 도는 작은 다리.
// 확장의 content script는 YouTube 자체 코드와 데이터를 직접 쓸 수 없어서, 문서 이벤트로 부탁을 받아 대신 실행한다.
//
// wv-show-comment  (기본): 영상은 건드리지 않고 **댓글 영역만** 다시 불러와, 원하는 댓글을 맨 위 '하이라이트 댓글'로 띄운다.
//   1) /youtubei/v1/next 에 { videoId, params(댓글 id) } 를 보내 '그 댓글이 강조된 댓글 목록'의 이어보기 토큰을 받는다
//   2) 댓글 정렬 버튼(인기순/최신순)이 쓰는 것과 같은 요청(yt-service-request)에 그 토큰을 실어 보낸다
//   → 실제 페이지에서 확인: 약 1~2초, 영상 계속 재생, 광고·새로고침 없음, 답글도 '하이라이트 답글'로 뜸
// wv-navigate      (예비): YouTube 내부 이동(yt-navigate). 영상이 다시 불러와지고 광고가 나올 수 있어 기본으로 쓰지 않는다.
(() => {
  // 다리 판(版). 고칠 때마다 올린다: 업데이트 전에 열린 탭에는 옛 다리가 남아 있으므로, 이벤트 이름에 판을 붙여 옛 다리가 새 부탁에 답하지 않게 한다.
  const V = 2;
  if (window.__wvBridgeV === V) return;
  window.__wvBridgeV = V;

  const okIds = (videoId, id) => /^[\w-]{11}$/.test(videoId) && /^[\w.-]{10,120}$/.test(id);
  // YouTube가 댓글 시각 링크에 쓰는 params: protobuf { 15: 댓글 id, 36: { 24: 0 } } → base64
  const linkedParams = (id) => btoa(String.fromCharCode(122, id.length, ...[...id].map((c) => c.charCodeAt(0)), 162, 2, 3, 192, 1, 0));
  const ack = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
  const waitFor = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v || Date.now() > end) return v; await new Promise((r) => setTimeout(r, 200)); } };

  // 토큰 고르기는 content/parse.js(WV.findCommentToken, 테스트 있음). 메인 월드에도 parse.js를 먼저 넣는다(manifest·sidepanel.js).
  const findCommentToken = window.WV?.findCommentToken;

  document.addEventListener(`wv-show-comment-v${V}`, async (ev) => {
    let result = "error";
    try {
      const { videoId, id } = JSON.parse(ev.detail);
      if (!okIds(videoId, id)) throw new Error("bad id");
      const menu = await waitFor(() => { const m = document.querySelector("ytd-comments#comments yt-sort-filter-sub-menu-renderer"); return m?.data?.subMenuItems?.[0]?.serviceEndpoint?.continuationCommand ? m : null; }, 9000);
      const cfg = window.ytcfg;
      if (!menu) result = "no-menu";
      else if (!cfg?.get?.("INNERTUBE_CONTEXT")) result = "no-config";
      else {
        const key = cfg.get("INNERTUBE_API_KEY");
        const res = await fetch(`/youtubei/v1/next?prettyPrint=false${key ? `&key=${key}` : ""}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ context: cfg.get("INNERTUBE_CONTEXT"), videoId, params: linkedParams(id) }),
        });
        const token = res.ok && findCommentToken ? findCommentToken(await res.json()) : null;
        if (!token) result = "no-token";
        else {
          const endpoint = JSON.parse(JSON.stringify(menu.data.subMenuItems[0].serviceEndpoint));
          endpoint.continuationCommand.token = token;
          menu.dispatchEvent(new CustomEvent("yt-action", {
            bubbles: true, cancelable: false, composed: true,
            detail: { actionName: "yt-service-request", returnValue: [], args: [menu, endpoint], optionalAction: false },
          }));
          result = "ok";
        }
      }
    } catch (e) {
      result = "error";
    }
    ack(`wv-show-comment-v${V}-ack`, result);
  });

  document.addEventListener(`wv-navigate-v${V}`, (ev) => {
    let result = "no-app";
    try {
      const { videoId, id } = JSON.parse(ev.detail);
      const app = document.querySelector("ytd-app");
      if (app && typeof app.fire === "function" && okIds(videoId, id)) {
        app.fire("yt-navigate", {
          endpoint: {
            commandMetadata: { webCommandMetadata: { url: `/watch?v=${videoId}&lc=${id}`, webPageType: "WEB_PAGE_TYPE_WATCH", rootVe: 3832 } },
            watchEndpoint: { videoId, params: encodeURIComponent(linkedParams(id)) },
          },
        });
        result = "ok";
      }
    } catch (e) {
      result = "error";
    }
    ack(`wv-navigate-v${V}-ack`, result);
  });
})();
