// 공개 데이터로 작성자 점수 가중치를 보정한다 (선택 사항).
//   npm run calibrate -- --data <파일.jsonl 또는 .csv> [--user user_id --text comment --likes likes --label is_troll] [--limit 2000000]
// 결과: calibration/weights.json (패널의 "점수 기준 → 공개 데이터 보정"에서 선택 가능) + calibration/report.json
// 데이터 파일의 열 이름은 데이터마다 다르므로 --user/--text/--likes/--label 로 맞춰 준다.
// 확장 프로그램에는 가중치 JSON만 들어가고 데이터는 들어가지 않는다.
import fs from "node:fs";
import readline from "node:readline";
import { calibrateAuthorWeights } from "../lib/calibrate.js";

const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map((s) => { const [k, ...v] = s.trim().split(/\s+/); return [k, v.join(" ") || true]; }));
if (!args.data) { console.error("사용법: npm run calibrate -- --data <파일> [--user 열 --text 열 --likes 열 --label 열] [--limit N]"); process.exit(1); }
const col = { user: args.user || "user", text: args.text || "text", likes: args.likes || "likes", label: args.label || "label" };
const limit = Number(args.limit) || Infinity;
const isCsv = /\.csv$/i.test(args.data);

function parseCsvLine(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
}

const rows = [];
let header = null, n = 0;
for await (const line of readline.createInterface({ input: fs.createReadStream(args.data), crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  let obj;
  if (isCsv) {
    const cells = parseCsvLine(line);
    if (!header) { header = cells; continue; }
    obj = Object.fromEntries(header.map((h, i) => [h, cells[i]]));
  } else {
    try { obj = JSON.parse(line); } catch { continue; }
  }
  if (obj[col.user] === undefined || obj[col.text] === undefined) continue;
  const label = obj[col.label];
  rows.push({ user: obj[col.user], text: obj[col.text], likes: obj[col.likes], label: label === true || label === "1" || label === 1 || /^(true|troll|suspected)$/i.test(String(label)) ? 1 : 0 });
  if (++n >= limit) break;
}
console.log(`읽은 댓글 ${rows.length.toLocaleString()}개`);
const { override, report } = calibrateAuthorWeights(rows, { date: new Date().toISOString().slice(0, 10) });
fs.mkdirSync("calibration", { recursive: true });
fs.writeFileSync("calibration/weights.json", JSON.stringify(override, null, 2) + "\n");
fs.writeFileSync("calibration/report.json", JSON.stringify(report, null, 2) + "\n");
console.log("가중치:", override.author);
console.log("검증:", report);
console.log("저장: calibration/weights.json, calibration/report.json");
