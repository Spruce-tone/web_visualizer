// 의미 임베딩 (Transformers.js, 브라우저 내 실행 — 서버 전송 없음)
// - GPU(WebGPU)가 있으면 GPU, 없으면 CPU(WASM, 멀티스레드)로 실행
// - "자동"은 기기에 맞춰 모델을 고른다: GPU 있음 → EmbeddingGemma, 없음 → Bekko(경량, CPU용)
// - 같은 문구는 한 번만 계산하고, 길이순으로 묶어 CPU 낭비를 줄인다
// - 모델 가중치는 첫 실행 때 Hugging Face에서 받아 브라우저 캐시에 둔다 (문서/댓글 데이터는 저장하지 않음)
// MV3는 원격 코드를 막으므로 라이브러리/wasm은 vendor/ 에 번들되어 있어야 한다 (릴리스 zip에는 포함됨).

export const MODELS = {
  bekko: {
    label: "가벼움",
    name: "Bekko a25m",
    note: "CPU에서 빠름 · 약 190MB",
    id: "hotchpotch/bekko-embedding-v1-a25m",
    format: (t) => t, // 접두어 없음
    pooling: "mean",
    dims: 256, // 384 → 256 (MRL)
    dtype: { webgpu: "fp32", wasm: "fp32" }, // 임베딩 테이블만 int8인 기본 파일
    batch: { webgpu: 32, wasm: 16 },
    maxChars: 400,
  },
  gemma: {
    label: "균형",
    name: "EmbeddingGemma-300M",
    note: "정확도 높음 · CPU에서도 동작 · 약 200~300MB",
    id: "onnx-community/embeddinggemma-300m-ONNX",
    format: (t) => `task: clustering | query: ${t}`,
    pooling: "sentence_embedding",
    dims: 256, // 768 → 256 (MRL)
    dtype: { webgpu: "q4", wasm: "q4" },
    batch: { webgpu: 16, wasm: 8 },
    maxChars: 500,
  },
  qwen3: {
    label: "고성능",
    name: "Qwen3-Embedding-0.6B",
    note: "GPU 권장 · CPU에서는 느림 · 500MB 이상",
    id: "onnx-community/Qwen3-Embedding-0.6B-ONNX",
    format: (t) => `Instruct: Identify the topic, stance and sentiment of the given online comment\nQuery:${t}`,
    pooling: "last_token",
    dims: 512, // 1024 → 512 (MRL)
    dtype: { webgpu: "q4f16", wasm: "q8" },
    batch: { webgpu: 8, wasm: 4 },
    maxChars: 500,
  },
};

const LIB_URL = new URL("../../vendor/transformers/transformers.min.js", import.meta.url).href;
const WASM_DIR = new URL("../../vendor/transformers/", import.meta.url).href;
const loaded = new Map(); // key → Promise<{run, device}>
let gpuChecked;

export async function semanticAvailable() {
  try {
    const r = await fetch(LIB_URL, { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
}

export async function hasGPU() {
  if (gpuChecked === undefined) {
    try { gpuChecked = !!(await navigator.gpu?.requestAdapter()); } catch { gpuChecked = false; }
  }
  return gpuChecked;
}

/** "auto" → 기기에 맞는 모델 키 */
export async function resolveModel(key) {
  if (key !== "auto") return key;
  return (await hasGPU()) ? "gemma" : "bekko";
}

function progressReporter(onStatus, name) {
  const files = new Map();
  return (p) => {
    if (p.status !== "progress" || !p.file) return;
    files.set(p.file, { loaded: p.loaded || 0, total: p.total || 0 });
    let l = 0, t = 0;
    for (const f of files.values()) { l += f.loaded; t += f.total; }
    if (t > 1e6) onStatus?.(`${name} 모델 내려받는 중 ${Math.round((l / t) * 100)}% (${Math.round(t / 1e6)}MB, 처음 한 번만)`);
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
  // cross-origin isolation(manifest의 COOP/COEP)이 켜져 있으면 CPU 멀티스레드 사용
  env.backends.onnx.wasm.numThreads = globalThis.crossOriginIsolated ? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1)) : 1;
  onStatus?.(`${cfg.name} 모델 준비 중…`);
  const progress_callback = progressReporter(onStatus, cfg.name);

  let lastErr;
  for (const device of (await hasGPU()) ? ["webgpu", "wasm"] : ["wasm"]) {
    const dtype = cfg.dtype[device];
    try {
      if (cfg.pooling === "sentence_embedding") {
        const tokenizer = await AutoTokenizer.from_pretrained(cfg.id, { progress_callback });
        const model = await AutoModel.from_pretrained(cfg.id, { dtype, device, progress_callback });
        const run = async (texts) => {
          const inputs = await tokenizer(texts, { padding: true, truncation: true, max_length: 192 });
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

/**
 * 중복 제거 + 길이순 배치 계획 (순수 함수, 테스트 대상)
 * @returns {{unique: string[], order: number[], map: number[]}} map[i] = texts[i] 가 가리키는 unique 인덱스, order = 길이 오름차순 unique 인덱스
 */
export function planBatches(texts) {
  const index = new Map();
  const unique = [];
  const map = texts.map((t) => {
    if (!index.has(t)) { index.set(t, unique.length); unique.push(t); }
    return index.get(t);
  });
  const order = unique.map((_, i) => i).sort((a, b) => unique[a].length - unique[b].length);
  return { unique, order, map };
}

/** @returns {Promise<{vecs: Float32Array[], device: string, model: string}>} L2 정규화 벡터 */
export async function semanticEmbed(texts, { model: requested = "auto", onStatus } = {}) {
  const key = await resolveModel(requested);
  const cfg = MODELS[key];
  const { run, device } = await getModel(key, onStatus);
  const { unique, order, map } = planBatches(texts.map((t) => String(t).slice(0, cfg.maxChars)));
  const out = new Array(unique.length);
  const B = cfg.batch[device];
  const where = device === "webgpu" ? "GPU" : globalThis.crossOriginIsolated ? "CPU 멀티스레드" : "CPU";
  const t0 = performance.now();
  for (let i = 0; i < order.length; i += B) {
    const idx = order.slice(i, i + B);
    const rows = await run(idx.map((j) => cfg.format(unique[j])));
    rows.forEach((full, k) => {
      const v = Float32Array.from(full.slice(0, cfg.dims));
      let n = 0;
      for (const x of v) n += x * x;
      n = Math.sqrt(n) || 1;
      for (let d = 0; d < v.length; d++) v[d] /= n;
      out[idx[k]] = v;
    });
    const done = Math.min(i + B, order.length);
    const rate = done / ((performance.now() - t0) / 1000);
    const eta = Math.round((order.length - done) / Math.max(rate, 0.1));
    onStatus?.(`의미 분석 중 ${done.toLocaleString()}/${order.length.toLocaleString()} (${cfg.name}, ${where}${eta > 2 ? `, 약 ${eta}초 남음` : ""})`);
  }
  return { vecs: map.map((u) => out[u]), device, model: key, where };
}
