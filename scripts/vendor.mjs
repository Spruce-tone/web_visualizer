// 의미 임베딩(실험적)용: node_modules 의 Transformers.js 와 onnxruntime wasm 을 vendor/ 로 복사.
// MV3 확장은 CDN 코드를 불러올 수 없으므로 로컬 파일로 번들해야 한다.
// 사용: npm install && npm run vendor
import fs from "node:fs";
import path from "node:path";

const out = "vendor/transformers";
fs.mkdirSync(out, { recursive: true });

const tf = "node_modules/@huggingface/transformers/dist/transformers.min.js";
if (!fs.existsSync(tf)) {
  console.error(`없음: ${tf}  → 먼저 npm install --ignore-scripts 를 실행하세요.`);
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
// 글꼴: Pretendard (SIL OFL 1.1) — 가변 woff2 한 파일 + 라이선스 문서
function find(dir, name) {
  if (!fs.existsSync(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = find(p, name); if (r) return r; }
    else if (e.name === name) return p;
  }
  return null;
}
const fontOut = "vendor/fonts";
fs.mkdirSync(fontOut, { recursive: true });
const font = find("node_modules/pretendard", "PretendardVariable.woff2");
if (font) {
  fs.copyFileSync(font, path.join(fontOut, "PretendardVariable.woff2"));
  // OFL은 라이선스 문서를 글꼴과 함께 배포해야 한다. 패키지에 없으면 원본 저장소에서 받는다.
  const licOut = path.join(fontOut, "Pretendard-LICENSE.txt");
  const lic = ["LICENSE", "LICENSE.txt", "OFL.txt"].map((f) => path.join("node_modules/pretendard", f)).find((f) => fs.existsSync(f));
  if (lic) fs.copyFileSync(lic, licOut);
  else {
    const res = await fetch("https://raw.githubusercontent.com/orioncactus/pretendard/main/LICENSE");
    if (!res.ok) { console.error(`Pretendard 라이선스를 받지 못했어요 (${res.status}). 라이선스 없이 글꼴을 배포할 수 없어 중단합니다.`); process.exit(1); }
    fs.writeFileSync(licOut, await res.text());
  }
  console.log(`글꼴 복사: ${font} (+라이선스 ${fs.statSync(licOut).size}바이트)`);
} else {
  console.warn("Pretendard 글꼴을 찾지 못했어요. 시스템 글꼴로 표시됩니다.");
}

fs.writeFileSync("vendor/THIRD_PARTY.md", `# 함께 배포되는 외부 구성요소

- Pretendard 글꼴 — SIL Open Font License 1.1 (fonts/Pretendard-LICENSE.txt) — https://github.com/orioncactus/pretendard
- Transformers.js — Apache License 2.0 — https://github.com/huggingface/transformers.js
- ONNX Runtime Web — MIT License — https://github.com/microsoft/onnxruntime

의미 모델(Bekko: MIT, EmbeddingGemma: Gemma 이용약관, Qwen3-Embedding: Apache 2.0)은 zip에 들어 있지 않고, 사용자가 처음 실행할 때 Hugging Face에서 직접 내려받습니다.
`);

console.log(`vendor 완료: transformers.min.js + ort 파일 ${n}개 → ${out}/`);
