// 간단 테스트: node tests/run.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { timeHistogram, exactDuplicates, normalize } from "../lib/analyze.js";

// content/parse.js 를 브라우저 전역처럼 로드
const ctx = { globalThis: {}, setTimeout };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL("../content/parse.js", import.meta.url), "utf8"), ctx);
const WV = ctx.WV;

assert.equal(WV.parseCount("1.2천"), 1200);
assert.equal(WV.parseCount("3.4만"), 34000);
assert.equal(WV.parseCount("1.5K"), 1500);
assert.equal(WV.parseCount("12"), 12);
assert.equal(WV.parseCount(""), 0);

const now = Date.parse("2026-11-24T00:00:00Z");
assert.equal(WV.parseRelativeTime("3일 전", now).approx, "2026-11-21T00:00:00.000Z");
assert.equal(WV.parseRelativeTime("2 hours ago (edited)", now).edited, true);
assert.equal(WV.parseRelativeTime("1년 전(수정됨)", now).edited, true);
assert.equal(WV.parseRelativeTime("방금", now).approx, null);

assert.equal(normalize("좋아요!! 최고 👍"), "좋아요최고");
const cs = [
  { text: "이 영상 진짜 최고네요!", author: "a" },
  { text: "이 영상 진짜 최고네요", author: "b" },
  { text: "이영상 진짜 최고네요!!", author: "c" },
  { text: "ㅋㅋ", author: "d" },
  { text: "ㅋㅋ", author: "e" },
];
const d = exactDuplicates(cs);
assert.equal(d.length, 1);
assert.equal(d[0].count, 3);
assert.equal(d[0].authors, 3);

const h = timeHistogram([
  { createdAtApprox: "2026-11-20T00:00:00Z" },
  { createdAtApprox: "2026-11-20T00:00:00Z" },
  { createdAtApprox: "2026-11-23T00:00:00Z" },
]);
assert.equal(h.length, 4);
assert.equal(h[0].count, 2);

console.log("all tests passed");
