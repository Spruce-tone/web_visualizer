// 의미 임베딩 (Transformers.js, 브라우저 내 실행 — 서버 전송 없음)
// - WebGPU가 있으면 GPU, 없으면 WASM(CPU)으로 자동 폴백
// - MRL로 차원을 잘라 재정규화 (유사도 계산 속도 ↑, 품질 손실 적음)
// - 모델 가중치는 첫 실행 때 Hugging Face에서 받아 브라우저 캐시에 둔다 (문서/댓글 데이터는 저장하지 않음)
// MV3는 원격 코드를 막으므로 라이브러리/wasm은 vendor/ 에 번들되어 있어야 한다 (릴리스 zip에는 포함됨).

export const MODELS = {
  qwen3: {
    label: "고성능 · Qwen3-Embedding-0.6B",
    id: "onnx-community/Qwen3-Embedding-0.6B-ONNX",
    // 지시문 + 질의 형식. 마지막 토큰 풀링
    format: (t) => `Instruct: Identify the topic, stance and sentiment of the given online comment\nQuery:${t}`,
    pooling: "last_token",
    dims: 512, // 1024 → 512 (MRL)
    dtype: { webgpu: "q4f16", wasm: "q8" },
    batch: 8,
  },
  gemma: {
    label: "균형 · EmbeddingGemma-300M",
    id: "onnx-community/embeddinggemma-300m-ONNX",
    format: (t) => `task: clustering | query: ${t}`,
    pooling: "sentence_embedding",
    dims: 256, // 768 → 256 (MRL)
    dtype: { webgpu: "q4", wasm: "q4" },
    batch: 16,
  },
};

const LIB_URL = new URL("../../vendor/transformers/transformers.min.js", import.meta.url).href;
const WASM_DIR = new URL("../../vendor/transformers/", import.meta.url).href;
const loaded = new Map(); // key → Promise<{run, device}>

export async function semanticAvailable() {
  try {
    const r = await fetch(LIB_URL, { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
}

function progressReporter(onStatus, label) {
  const files = new Map();
  return (p) => {
    if (p.status !== "progress" || !p.file) return;
    files.set(p.file, { loaded: p.loaded || 0, total: p.total || 0 });
    let l = 0, t = 0;
    for (const f of files.values()) { l += f.loaded; t += f.total; }
    if (t > 1e6) onStatus?.(`${label} 다운로드 ${Math.round((l / t) * 100)}% (${Math.round(t / 1e6)}MB, 첫 실행만)`);
  };
}

async function load(key, onStatus) {
  const cfg = MODELS[key];
  let mod;
  try {
    mod = await import(LIB_URL);
  } catch {
    throw new Error("의미 모델 라이브러리가 없어요. 릴리스 zip으로 설치하거나 `npm run vendor`를 실행하세요.");
  }
  const { AutoTokenizer, AutoModel, pipeline, env } = mod;
  env.allowLocalModels = false;
  env.backends.onnx.wasm.wasmPaths = WASM_DIR;
  onStatus?.(`${cfg.label} 준비 중…`);
  const progress_callback = progressReporter(onStatus, cfg.label);

  let lastErr;
  for (const device of navigator.gpu ? ["webgpu", "wasm"] : ["wasm"]) {
    const dtype = cfg.dtype[device];
    try {
      if (cfg.pooling === "sentence_embedding") {
        // EmbeddingGemma: 모델 출력의 sentence_embedding 사용
        const tokenizer = await AutoTokenizer.from_pretrained(cfg.id, { progress_callback });
        const model = await AutoModel.from_pretrained(cfg.id, { dtype, device, progress_callback });
        const run = async (texts) => {
          const inputs = await tokenizer(texts, { padding: true, truncation: true, max_length: 256 });
          return (await model(inputs)).sentence_embedding.tolist();
        };
        return { run, device };
      }
      const extractor = await pipeline("feature-extraction", cfg.id, { dtype, device, progress_callback });
      const run = async (texts) => (await extractor(texts, { pooling: cfg.pooling, normalize: true })).tolist();
      return { run, device };
    } catch (e) {
      lastErr = e;
      console.warn(`[WV] ${cfg.id} ${device}/${dtype} 로드 실패, 다음 백엔드 시도`, e);
    }
  }
  throw lastErr;
}

function getModel(key, onStatus) {
  if (!loaded.has(key)) {
    const p = load(key, onStatus);
    loaded.set(key, p);
    p.catch(() => loaded.delete(key));
  }
  return loaded.get(key);
}

/** @returns {Promise<{vecs: Float32Array[], device: string, label: string}>} L2 정규화 벡터 */
export async function semanticEmbed(texts, { model: key = "qwen3", onStatus } = {}) {
  const cfg = MODELS[key];
  const { run, device } = await getModel(key, onStatus);
  const vecs = [];
  const t0 = performance.now();
  for (let i = 0; i < texts.length; i += cfg.batch) {
    const batch = texts.slice(i, i + cfg.batch).map((t) => cfg.format(String(t).slice(0, 1000)));
    for (const full of await run(batch)) {
      const v = Float32Array.from(full.slice(0, cfg.dims));
      let n = 0;
      for (const x of v) n += x * x;
      n = Math.sqrt(n) || 1;
      for (let k = 0; k < v.length; k++) v[k] /= n;
      vecs.push(v);
    }
    const done = Math.min(i + cfg.batch, texts.length);
    const rate = done / ((performance.now() - t0) / 1000);
    const eta = Math.round((texts.length - done) / Math.max(rate, 0.1));
    onStatus?.(`의미 임베딩 ${done}/${texts.length} (${device === "webgpu" ? "GPU" : "CPU"}, 약 ${eta}초 남음)`);
  }
  return { vecs, device, label: cfg.label };
}
