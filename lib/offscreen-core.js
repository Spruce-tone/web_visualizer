// offscreen 문서의 처리 부분 (offscreen/offscreen.js가 chrome.runtime 메시지에 잇는다). node 테스트에서 직접 부른다.
// 팝업·사이드 패널이 닫혀도 분석이 끝까지 이어지고, 결과는 그 탭이 살아 있는 동안 여기(메모리)에 남는다.
//
// 받는 메시지 (chrome.runtime)
//   패널 → {type:"WV_JOB_START", tabId, videoId, job, useSemantic, mode} → {ok}
//   content → {type:"WV_PROGRESS", count, total, phase}            (sender.tab.id의 진행 문구)
//   content → {type:"WV_COLLECTED", job, reply}                    (수집 응답. 받으면 분석 시작)
//   패널 → {type:"WV_JOB_GET", tabId} → {ok, phase, status, error, videoId, job, result, ui}
//   패널 → {type:"WV_JOB_UI", tabId, job, ui} → {ok}               (지도·분류 등 화면 상태)
//   서비스 워커 → {type:"WV_JOB_DROP", tabId} / {type:"WV_JOB_URL", tabId, videoId}
// 보내는 메시지: {type:"WV_JOB_UPDATE", tabId, job, phase, status, error}
// result는 lib/wire.js 형식: { doc, comments, A(분석 결과, lexVecs는 {flat,dim,n}), fallback }
import { createJobStore, progressText } from "./job-store.js";
import { toWire } from "./wire.js";

export function createOffscreenCore({ broadcast, handler, store = createJobStore(), onEmpty = () => {} }) {
  let run = 0;
  let queue = Promise.resolve(); // 분석은 한 번에 하나씩 (GPU·모델을 나눠 쓰지 않게)
  const inputs = new Map(); // tabId → {job, useSemantic, mode}
  const update = (e) => e && broadcast({ type: "WV_JOB_UPDATE", tabId: e.tabId, job: e.job, phase: e.phase, status: e.status, error: e.error });
  const emptied = () => { if (!store.size) onEmpty(); };

  function analyze(tabId, job, reply) {
    const input = inputs.get(tabId);
    const go = async () => {
      if (store.get(tabId)?.job !== job) return; // 기다리는 사이 지워졌거나 새 작업으로 바뀜
      const { doc, comments } = reply.data;
      const r = ++run;
      const out = await new Promise((resolve) => {
        // keep:false — 세밀도 바꾸기는 패널이 자기 Worker로 하므로, 여기서는 입력을 남기지 않는다(탭이 닫혀도 남는 메모리 없음)
        handler({ type: "analyze", run: r, doc, comments, useSemantic: !!input?.useSemantic, mode: input?.mode, keep: false }, (m) => {
          if (m.type === "status") update(store.progress(tabId, m.text, job));
          else resolve(m);
        });
      });
      if (out.type === "done") update(store.done(tabId, job, toWire({ doc, comments, A: out.result, fallback: reply.fallback || null })));
      else update(store.fail(tabId, job, out.message || "분석하지 못했어요"));
    };
    queue = queue.then(go, go).catch((e) => update(store.fail(tabId, job, e?.message || e)));
    return queue;
  }

  function onMessage(msg, sender = {}) {
    const fromTab = sender.tab?.id;
    switch (msg?.type) {
      case "WV_JOB_START":
        inputs.set(msg.tabId, { job: msg.job, useSemantic: msg.useSemantic, mode: msg.mode });
        update(store.start(msg.tabId, { videoId: msg.videoId, job: msg.job }));
        return { ok: true };
      case "WV_PROGRESS":
        if (fromTab != null) update(store.progress(fromTab, progressText(msg)));
        return undefined;
      case "WV_COLLECTED": {
        if (fromTab == null) return undefined;
        const e = store.collected(fromTab, msg.job);
        if (!e) return undefined; // 이미 지워졌거나 더 새 작업이 있음
        const rp = msg.reply;
        if (!rp?.ok) { update(store.fail(fromTab, msg.job, rp?.error || "페이지에서 응답이 없어요. 영상을 새로고침한 뒤 다시 시도하세요.")); return undefined; }
        if (!rp.data?.comments?.length) { update(store.fail(fromTab, msg.job, "댓글을 찾지 못했어요. 댓글이 꺼진 영상인지 확인하세요.")); return undefined; }
        update(e);
        analyze(fromTab, msg.job, rp);
        return undefined;
      }
      case "WV_JOB_GET": {
        const e = store.get(msg.tabId);
        return e ? { ok: true, phase: e.phase, status: e.status, error: e.error, videoId: e.videoId, job: e.job, result: e.result, ui: e.ui } : { ok: true, phase: null };
      }
      case "WV_JOB_UI":
        return { ok: store.setUi(msg.tabId, msg.job, msg.ui) };
      case "WV_JOB_DROP":
        if (store.drop(msg.tabId)) { inputs.delete(msg.tabId); emptied(); }
        return { ok: true };
      case "WV_JOB_URL":
        if (store.urlChanged(msg.tabId, msg.videoId)) { inputs.delete(msg.tabId); emptied(); }
        return { ok: true };
      default:
        return undefined;
    }
  }
  return { onMessage, store, idle: () => queue };
}
