// 의미 임베딩(실험적)용: node_modules 의 Transformers.js 와 onnxruntime wasm 을 vendor/ 로 복사.
// MV3 확장은 CDN 코드를 불러올 수 없으므로 로컬 파일로 번들해야 한다.
// 사용: npm install && npm run vendor
import fs from "node:fs";
import path from "node:path";

const out = "vendor/transformers";
fs.mkdirSync(out, { recursive: true });

const tf = "node_modules/@huggingface/transformers/dist/transformers.min.js";
if (!fs.existsSync(tf)) {
  console.error(`없음: ${tf}  → 먼저 npm install 을 실행하세요.`);
  process.exit(1);
}
fs.copyFileSync(tf, path.join(out, "transformers.min.js"));

const ortDir = ["node_modules/onnxruntime-web/dist", "node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist"]
  .find((d) => fs.existsSync(d));
if (!ortDir) {
  console.error("onnxruntime-web/dist 를 찾지 못했습니다.");
  process.exit(1);
}
let n = 0;
for (const f of fs.readdirSync(ortDir)) {
  if (/^ort-wasm.*\.(wasm|mjs)$/.test(f)) { fs.copyFileSync(path.join(ortDir, f), path.join(out, f)); n++; }
}
console.log(`vendor 완료: transformers.min.js + ort 파일 ${n}개 → ${out}/`);
