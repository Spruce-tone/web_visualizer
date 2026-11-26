// offscreen 문서가 계산을 Web Worker(lib/analysis-worker.js)에 맡기는 부분. worker-core와 같은 모양의 처리 함수 (msg, post)를 돌려준다.
// Worker를 못 만들거나, 불러오기에 실패하거나, 맡긴 일에 한동안 아무 말이 없으면(멈추거나 죽음) Worker를 버리고
// 기다리던 일과 그 뒤의 일을 이 문서에서 한다(fallback). 패널(sidepanel.js callWorker)과 같은 방식이다.

export const QUIET_MS = 180e3; // 진행 문구가 올 때마다 다시 잰다(모델 받기가 길 수 있어 넉넉히)

export function createWorkerHandler({ makeWorker, fallback, quietMs = QUIET_MS }) {
  let direct = null;
  const here = () => (direct ??= fallback());
  let w = null, alive = false, broken = false;
  const pending = new Map(); // run → {msg, post, timer}
  try { w = makeWorker(); } catch { broken = true; }
  const giveUp = (why) => {
    if (broken) return;
    broken = true;
    console.warn("[WV] offscreen worker 버림 → 문서에서 계산", why);
    try { w?.terminate(); } catch { /* 이미 죽음 */ }
    const left = [...pending.values()];
    pending.clear();
    for (const p of left) { clearTimeout(p.timer); here()(p.msg, p.post); }
  };
  const arm = (p) => { clearTimeout(p.timer); p.timer = setTimeout(() => giveUp(`${p.msg.type} 응답 없음`), quietMs); };
  if (w) {
    w.onmessage = ({ data: m }) => {
      alive = true;
      const p = pending.get(m.run);
      if (!p) return;
      if (m.type === "status") arm(p);
      else { clearTimeout(p.timer); pending.delete(m.run); }
      p.post(m);
    };
    // 한 번도 답하지 않았으면 불러오기 실패. 그 뒤의 오류는 기록만 하고, 답이 끊기면 위의 시간 제한이 넘긴다
    w.onerror = (e) => { e?.preventDefault?.(); if (!alive) giveUp(e?.message || "불러오기 실패"); else console.warn("[WV] offscreen worker 오류", e?.message || e); };
  }
  return (msg, post) => {
    if (broken) return here()(msg, post);
    const p = { msg, post, timer: 0 };
    pending.set(msg.run, p);
    arm(p);
    w.postMessage(msg);
  };
}
