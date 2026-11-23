// 의미 임베딩: EmbeddingGemma-300M (Transformers.js, 브라우저 내 실행 — 서버 전송 없음).
// - WebGPU가 있으면 GPU, 없으면 WASM(CPU)으로 자동 폴백
// - q4 양자화, MRL로 768 → 256차원 잘라 재정규화 (속도 ↑, 품질 손실 적음)
// - 모델 가중치는 첫 실행 때 Hugging Face에서 받아 브라우저 캐시에 둔다 (문서/댓글 데이터는 저장하지 않음)
// MV3는 원격 코드를 막으므로 라이브러리/wasm은 vendor/ 에 번들되어 있어야 한다 (릴리스 zip에는 포함됨).

export const MODEL = "onnx-community/embeddinggemma-300m-ONNX";
const DIM = 256;
const PROMPT = "task: clustering | query: ";
const LIB_URL = new URL("../../vendor/transformers/transformers.min.js", import.meta.url).href;
const WASM_DIR = new URL("../../vendor/transformers/", import.meta.url).href;

let loading = null;

export async function semanticAvailable() {
  try {
    const r = await fetch(LIB_URL, { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
}

function progressReporter(onStatus) {
  const files = new Map();
  return (p) => {
    if (p.status !== "progress" || !p.file) return;
    files.set(p.file, { loaded: p.loaded || 0, total: p.total || 0 });
    let loaded = 0, total = 0;
    for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    if (total > 1e6) onStatus?.(`의미 모델 다운로드 ${Math.round((loaded / total) * 100)}% (${Math.round(total / 1e6)}MB, 첫 실행만)`);
  };
}

async function load(onStatus) {
  let mod;
  try {
    mod = await import(LIB_URL);
  } catch {
    throw new Error("의미 모델 라이브러리가 없어요. 릴리스 zip으로 설치하거나 `npm run vendor`를 실행하세요.");
  }
  const { AutoTokenizer, AutoModel, env } = mod;
  env.allowLocalModels = false;
  env.backends.onnx.wasm.wasmPaths = WASM_DIR;

  onStatus?.("의미 모델 준비 중…");
  const progress_callback = progressReporter(onStatus);
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL, { progress_callback });

  let lastErr;
  for (const device of navigator.gpu ? ["webgpu", "wasm"] : ["wasm"]) {
    try {
      const model = await AutoModel.from_pretrained(MODEL, { dtype: "q4", device, progress_callback });
      return { tokenizer, model, device };
    } catch (e) {
      lastErr = e;
      console.warn(`[WV] ${device} 로드 실패, 다음 백엔드 시도`, e);
    }
  }
  throw lastErr;
}

function getModel(onStatus) {
  if (!loading) {
    loading = load(onStatus);
    loading.catch(() => (loading = null));
  }
  return loading;
}

/** @returns {Promise<{vecs: Float32Array[], device: string}>} L2 정규화된 256차원 벡터 */
export async function semanticEmbed(texts, { onStatus, batchSize = 16 } = {}) {
  const { tokenizer, model, device } = await getModel(onStatus);
  const vecs = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map((t) => PROMPT + String(t));
    const inputs = await tokenizer(batch, { padding: true, truncation: true, max_length: 256 });
    const { sentence_embedding } = await model(inputs);
    for (const full of sentence_embedding.tolist()) {
      const v = Float32Array.from(full.slice(0, DIM));
      let n = 0;
      for (const x of v) n += x * x;
      n = Math.sqrt(n) || 1;
      for (let k = 0; k < v.length; k++) v[k] /= n;
      vecs.push(v);
    }
    onStatus?.(`의미 임베딩 ${Math.min(i + batchSize, texts.length)}/${texts.length} (${device === "webgpu" ? "GPU" : "CPU"})`);
  }
  return { vecs, device };
}
