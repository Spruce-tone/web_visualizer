// [실험적] 의미 임베딩: Transformers.js + multilingual-e5-small (브라우저 내 실행, 서버 전송 없음).
// MV3는 원격 코드 실행을 막으므로 라이브러리/wasm은 `npm run vendor`로 vendor/ 에 복사해 번들한다.
// 모델 가중치(약 100MB대)는 첫 실행 때 Hugging Face에서 받아 브라우저 캐시에 둔다(문서/댓글 데이터는 저장하지 않음).

const MODEL = "Xenova/multilingual-e5-small";
const LIB_URL = new URL("../../vendor/transformers/transformers.min.js", import.meta.url).href;
const WASM_DIR = new URL("../../vendor/transformers/", import.meta.url).href;

let extractorPromise = null;

async function getExtractor(onStatus) {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      let mod;
      try {
        mod = await import(LIB_URL);
      } catch {
        throw new Error("의미 임베딩 라이브러리가 없습니다. README의 'npm run vendor' 단계를 먼저 실행하세요.");
      }
      const { pipeline, env } = mod;
      env.allowLocalModels = false;
      env.backends.onnx.wasm.wasmPaths = WASM_DIR;
      onStatus?.("모델 불러오는 중… (첫 실행만 다운로드)");
      return pipeline("feature-extraction", MODEL, {
        dtype: "q8",
        device: "wasm",
        progress_callback: (p) => {
          if (p.status === "progress" && p.total) onStatus?.(`모델 다운로드 ${Math.round((p.loaded / p.total) * 100)}%`);
        },
      });
    })();
    extractorPromise.catch(() => (extractorPromise = null));
  }
  return extractorPromise;
}

/** @returns {Promise<Float32Array[]>} L2 정규화된 384차원 벡터 */
export async function semanticEmbed(texts, { onStatus, batchSize = 32 } = {}) {
  const extractor = await getExtractor(onStatus);
  const out = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map((t) => "query: " + String(t).slice(0, 500));
    const tensor = await extractor(batch, { pooling: "mean", normalize: true });
    for (const v of tensor.tolist()) out.push(Float32Array.from(v));
    onStatus?.(`의미 임베딩 ${Math.min(i + batchSize, texts.length)}/${texts.length}`);
  }
  return out;
}
