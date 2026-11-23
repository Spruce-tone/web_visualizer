// 빠른 임베딩: 문자 n-gram + 단어 토큰을 feature hashing → TF-IDF → L2 정규화.
// 모델 다운로드 없음, 수백~수천 개 댓글을 수십 ms 안에 처리.
// 의미(semantic)보다는 "표현이 얼마나 비슷한가"를 잡으므로 복붙/템플릿 댓글 탐지에 강하다.

export function normalizeForEmbed(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFC")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function features(text) {
  const s = normalizeForEmbed(text);
  const feats = [];
  const compact = s.replace(/ /g, "");
  for (const n of [2, 3]) {
    for (let i = 0; i + n <= compact.length; i++) feats.push(`c${n}:` + compact.slice(i, i + n));
  }
  if (compact.length === 1) feats.push("c1:" + compact);
  for (const w of s.split(" ")) if (w) feats.push("w:" + w);
  return feats;
}

/**
 * @param {string[]} texts
 * @param {{dim?: number}} opts
 * @returns {Float32Array[]} L2 정규화된 벡터 (내적 = 코사인 유사도)
 */
export function hashEmbed(texts, { dim = 256 } = {}) {
  const rows = texts.map((t) => {
    const m = new Map(); // bucket -> signed tf
    for (const f of features(t)) {
      const h = fnv1a(f);
      const b = h % dim;
      const sign = h & 0x80000000 ? -1 : 1;
      m.set(b, (m.get(b) || 0) + sign);
    }
    return m;
  });

  // 버킷 단위 IDF
  const df = new Float32Array(dim);
  for (const m of rows) for (const b of m.keys()) df[b]++;
  const N = rows.length;
  const idf = df.map((d) => Math.log((N + 1) / (d + 1)) + 1);

  return rows.map((m) => {
    const v = new Float32Array(dim);
    for (const [b, tf] of m) v[b] = Math.sign(tf) * (1 + Math.log(Math.abs(tf) || 1)) * idf[b];
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++) v[i] /= norm;
    return v;
  });
}
