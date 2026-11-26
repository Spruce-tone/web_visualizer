// 스토어 스크린샷 원본: 실제 확장 페이지(크게 보기·팝업·사이드 패널 폭)에 합성 댓글(demo-data.mjs)을 넣어 실제 모델로 분석하고 찍는다.
// 실제 YouTube 댓글·사람은 나오지 않는다. 사용: CDP_PORT=<확장을 --load-extension으로 넣은 headless Edge 포트> node shots.mjs <view> <폭> <높이> <출력 이름> [준비 식]
// 결과는 ./out/ (gitignore 안 됨 → 쓴 뒤 docs/store/로 옮기고 지울 것). 확장 id는 이 저장소 폴더 경로로 정해지므로 다르면 EXT를 고친다.
//   view: big | popup | panel
import fs from "node:fs";
import { connect, sleep } from "./cdp.mjs";
import { demoFixture } from "./demo-data.mjs";
const [view, w, h, name, prep = ""] = process.argv.slice(2);
const EXT = "chrome-extension://bpgalbfkfboniikidhcadnaanaighcmp";
const data = demoFixture();
const inject = `(() => {
  const DATA = ${JSON.stringify(data)};
  const TAB = { id: 999999, url: "https://www.youtube.com/watch?v=DEMO", index: 0, windowId: 1, status: "complete" };
  chrome.tabs.get = async () => TAB;
  chrome.tabs.query = async () => [TAB];
  chrome.tabs.sendMessage = async (_id, m) => m.type === "WV_COLLECT_ALL" || m.type === "WV_EXTRACT" ? { ok: true, data: structuredClone(DATA) } : { ok: true };
  const send = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (m, ...a) => (m && (m.type === "WV_OFFSCREEN_ENSURE" || m.type === "WV_JOB_GET" || m.type === "WV_STATE_REQUEST") ? Promise.resolve(null) : send(m, ...a));
  globalThis.__WV_TEST__ = (api) => { globalThis.__api = api; };
})();`;
const c = await connect();
const { targetId } = await c.send("Target.createTarget", { url: "about:blank" }); // 앞 탭으로 (headless라 창은 뜨지 않음). 뒤 탭은 rAF가 초당 2번으로 줄어 지도가 자리를 못 잡는다
await c.send("Target.activateTarget", { targetId });
const s0 = await c.attach(targetId); await c.send("Emulation.setFocusEmulationEnabled", { enabled: true }, s0); await c.send("Page.setWebLifecycleState", { state: "active" }, s0).catch(() => {}); // 백그라운드 탭이라도 화면 갱신(rAF)이 느려지지 않게
const s = await c.attach(targetId);
await c.send("Page.enable", {}, s);
await c.send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: false }, s);
await c.send("Page.addScriptToEvaluateOnNewDocument", { source: inject }, s);
const url = view === "big" ? `${EXT}/sidepanel/sidepanel.html?tab=999999` : view === "popup" ? `${EXT}/sidepanel/sidepanel.html?mode=popup` : `${EXT}/sidepanel/sidepanel.html`;
await c.send("Page.navigate", { url }, s);
await sleep(2500);
console.log(await c.evaluate(s, `(async () => { await __api.ready; document.getElementById('max').value = '1000'; await document.getElementById('btn-all').onclick(); return document.getElementById('status').textContent })()`, { timeout: 180000 }));
await sleep(2500); // 지도 자리 잡기
if (prep) console.log(await c.evaluate(s, `(async () => { ${prep} })()`, { timeout: 30000 }));
await sleep(1500);
const r = await c.send("Page.captureScreenshot", { format: "png" }, s); // 지금 보이는 화면 그대로 (크기 = 위에서 정한 폭×높이)
const out = new URL(`./out/raw-${name}.png`, import.meta.url);
fs.mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
fs.writeFileSync(out, Buffer.from(r.data, "base64"));
console.log(decodeURIComponent(out.pathname.slice(1)));
await c.send("Target.closeTarget", { targetId });
c.close(); process.exit(0);
