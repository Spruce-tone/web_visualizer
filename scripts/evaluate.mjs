// 검증 세트로 치우침을 점검한다 (객관성 기준 9).
//   npm run evaluate
// fixtures/<분류>__<이름>.json  (패널의 "JSON 파일로 내려받기"로 만든 파일. 분류 예: politics-a, politics-b, news, music, game, daily)
// 통과 조건: (1) 오락 분류(music, game, daily)의 복붙 의심 비율 ≤ 5%  (2) politics-a 와 politics-b 의 의심 비율 차이 ≤ 5%p
import fs from "node:fs";
import { hashEmbed } from "../lib/embed/hash.js";
import { topKNeighbors, edgesFromNeighbors, clustersFromEdges } from "../lib/vec.js";
import { clusterSignals } from "../lib/signals.js";
import { DEFAULT_WEIGHTS } from "../lib/weights.js";

const files = fs.existsSync("fixtures") ? fs.readdirSync("fixtures").filter((f) => f.endsWith(".json")) : [];
if (!files.length) { console.log("fixtures/ 에 검증용 파일이 없습니다. fixtures/README.md 를 참고해 영상을 모아 주세요."); process.exit(0); }
const byCat = new Map();
for (const f of files) {
  const { doc, comments } = JSON.parse(fs.readFileSync(`fixtures/${f}`, "utf8"));
  if (!comments?.length) continue;
  const nb = topKNeighbors(hashEmbed(comments.map((c) => c.text)), 8);
  const ed = edgesFromNeighbors(nb, 0.6);
  const cl = clustersFromEdges(comments.length, ed);
  const sig = clusterSignals(cl.groups, comments, ed, { doc });
  const flagged = sig.filter((s) => s.state === "scored" && s.score >= DEFAULT_WEIGHTS.thresholds.flag).reduce((n, s) => n + s.size, 0);
  const cat = f.includes("__") ? f.split("__")[0] : "기타";
  const row = { file: f, comments: comments.length, flaggedShare: flagged / comments.length, natural: sig.filter((s) => s.state === "natural").length, hold: sig.filter((s) => s.state === "hold").length };
  if (!byCat.has(cat)) byCat.set(cat, []);
  byCat.get(cat).push(row);
  console.log(`${f}: 댓글 ${row.comments}, 의심 비율 ${(row.flaggedShare * 100).toFixed(1)}%, 자연 반복 ${row.natural}묶음, 보류 ${row.hold}묶음`);
}
const mean = (cat) => { const r = byCat.get(cat); return r ? r.reduce((s, x) => s + x.flaggedShare, 0) / r.length : null; };
let ok = true;
console.log("\n분류별 평균 의심 비율");
for (const cat of byCat.keys()) console.log(`  ${cat}: ${(mean(cat) * 100).toFixed(1)}% (영상 ${byCat.get(cat).length}개)`);
for (const cat of ["music", "game", "daily"]) {
  const m = mean(cat);
  if (m !== null && m > 0.05) { ok = false; console.log(`✗ ${cat}: 오락 영상의 의심 비율이 5%를 넘습니다 (${(m * 100).toFixed(1)}%)`); }
}
const a = mean("politics-a"), b = mean("politics-b");
if (a !== null && b !== null && Math.abs(a - b) > 0.05) { ok = false; console.log(`✗ politics-a 와 politics-b 의 차이가 5%p를 넘습니다 (${(a * 100).toFixed(1)}% vs ${(b * 100).toFixed(1)}%)`); }
console.log(ok ? "\n✓ 통과" : "\n✗ 기준을 다시 살펴봐야 합니다");
process.exit(ok ? 0 : 1);
