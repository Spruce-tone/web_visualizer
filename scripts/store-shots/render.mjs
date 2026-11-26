// HTML/SVG를 PNG로 (headless Edge, 창 없음). 사용: CDP_PORT=9347 node render.mjs <입력 파일> <폭> <높이> <출력 png> [transparent]
// 스토어 그림 다시 만들기 (scripts/store-shots): 1) 확장을 넣은 headless Edge에서 shots.mjs로 raw 화면 → 2) 이 render.mjs로 frame-modes.html·promo-small.html을 PNG로.
// 작은 그림(440×280)은 1280×800으로 열고 CLIP=440x280 으로 잘라 찍는다.
import fs from "node:fs";
import path from "node:path";
import { connect, sleep } from "./cdp.mjs";
const [input, w, h, outFile, transparent] = process.argv.slice(2);
const c = await connect(); 
const { targetId } = await c.send("Target.createTarget", { url: "about:blank" }); // 앞 탭으로 (headless라 창은 없음). 뒤 탭은 그리지 않아 captureScreenshot이 멈춘다
await c.send("Target.activateTarget", { targetId });
const s = await c.attach(targetId);
await c.send("Page.enable", {}, s);
await c.send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: false }, s);
if (transparent) await c.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } }, s);
const url = "file:///" + path.resolve(input).replace(/\\/g, "/");
await c.send("Page.navigate", { url }, s); // viewBox만 있는 SVG는 화면 크기에 맞춰 그려진다
await sleep(1500);
const [cw, ch] = (process.env.CLIP || "").split("x").map(Number); const r = await c.send("Page.captureScreenshot", cw ? { format: "png", clip: { x: 0, y: 0, width: cw, height: ch, scale: 1 } } : { format: "png" }, s);
fs.writeFileSync(outFile, Buffer.from(r.data, "base64"));
await c.send("Target.closeTarget", { targetId });
console.log(outFile);
c.close(); process.exit(0);
