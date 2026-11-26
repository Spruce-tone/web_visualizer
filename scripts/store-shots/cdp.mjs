// 아주 작은 CDP 도우미 (Node 22+ 내장 WebSocket). QA 전용.
export const PORT = +(process.env.CDP_PORT || 9333);

export async function browserWs() {
  const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  return v.webSocketDebuggerUrl;
}

export async function connect() {
  const ws = new WebSocket(await browserWs());
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else for (const l of listeners) l(m);
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const on = (fn) => listeners.push(fn);
  const targets = async () => (await send("Target.getTargets")).targetInfos;
  const attach = async (targetId) => (await send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
  const evaluate = async (sessionId, expression, { awaitPromise = true, timeout = 60000 } = {}) => {
    const r = await Promise.race([
      send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true, userGesture: true }, sessionId),
      new Promise((_, j) => setTimeout(() => j(new Error("eval timeout")), timeout)),
    ]);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const screenshot = async (sessionId, file) => {
    const fs = await import("node:fs");
    const r = await send("Page.captureScreenshot", { format: "png" }, sessionId);
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    return file;
  };
  return { ws, send, on, targets, attach, evaluate, screenshot, close: () => ws.close() };
}

export async function extTarget(c) {
  const ts = await c.targets();
  // 우리 확장: service worker background.js 중 sidepanel/sidepanel.html 이 있는 것
  for (const t of ts.filter((t) => t.type === "service_worker" && t.url.endsWith("/background.js"))) {
    const base = t.url.replace("/background.js", "");
    const r = await fetch(`${base}/manifest.json`).catch(() => null);
    void r;
    const s = await c.attach(t.targetId);
    const name = await c.evaluate(s, "chrome.runtime.getManifest().name").catch(() => "");
    if (name === "Web Visualizer") return { target: t, session: s, base };
  }
  return null;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
