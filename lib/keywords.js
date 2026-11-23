// 주제 묶음별 키워드 추출 (형태소 분석기 없이 가볍게)
// 1) 토큰화 → 2) 조사 떼기(말뭉치 안에서 근거가 있을 때만) → 3) 묶음별 c-TF-IDF 로 상위 단어 선택
import { normalizeForEmbed } from "./embed/hash.js";

const JOSA = [
  "으로부터", "에서부터", "이라고", "에게서", "으로써", "으로서", "에서는", "에서도", "이라는", "이지만", "입니다", "이에요",
  "라고", "라는", "지만", "예요", "에서", "에게", "한테", "께서", "으로", "처럼", "보다", "까지", "부터", "마저", "조차", "이나", "이랑", "하고", "이며", "이고", "이다", "에는", "에도", "으론", "이라",
  "은", "는", "이", "가", "을", "를", "의", "에", "도", "로", "와", "과", "만", "랑", "나", "요",
];

const STOP = new Set(`
진짜 정말 너무 그냥 이거 그거 저거 이건 그건 저건 이게 그게 저게 근데 그리고 그래서 하지만 그런데 그러면 그럼 그래도 그러니까
있는 없는 하는 같은 이런 그런 저런 어떤 무슨 우리 저는 나는 제가 내가 너무나 아주 매우 완전 엄청 약간 조금 많이 다시 계속 이제 지금 오늘 항상 역시 아니 아닌 아님 그래 그렇
합니다 입니다 있습니다 없습니다 같아요 같습니다 같네요 있어요 없어요 해요 하네요 되는 되어 된다 한다 하고 해서 하면 하는데 했는데 인데 이네요 네요 군요
것이 것은 것을 거의 때문 때문에 정도 경우 이상 사람 사람들 생각 영상 댓글 구독 좋아요 감사 감사합니다 ㅋㅋ ㅎㅎ ㅠㅠ
the a an and or but is are was were be been to of in on at for with this that these those it its as by from not no do does did have has had you your i my me we our they he she
just so very really too can will would could should what when where who how why if then than there here about into out up down
`.split(/\s+/).filter(Boolean));

export function tokenize(text) {
  return normalizeForEmbed(text)
    .split(" ")
    .filter((w) => w.length >= 2 && w.length <= 20 && !/^[ㄱ-ㅎㅏ-ㅣ]+$/.test(w) && !/^\d+$/.test(w));
}

function stemCandidates(w) {
  const out = [w];
  if (!/[가-힣]$/.test(w)) return out;
  for (const j of JOSA) {
    if (w.length - j.length >= 2 && w.endsWith(j)) out.push(w.slice(0, -j.length));
  }
  return out;
}

/**
 * 말뭉치에서 조사 떼기 규칙을 만든다: 어간이 서로 다른 표면형 2개 이상에서 확인될 때만 뗀다.
 * 예) "정책은", "정책을" → "정책" / "고양이", "고양이가" → "고양이" ("고양"은 근거가 1개뿐이라 채택 안 함)
 */
export function buildStemmer(tokenLists) {
  const forms = new Set();
  for (const list of tokenLists) for (const w of list) forms.add(w);
  const support = new Map(); // 어간 → 서로 다른 표면형 수
  for (const w of forms) for (const s of stemCandidates(w)) support.set(s, (support.get(s) || 0) + 1);
  const cache = new Map();
  return (w) => {
    if (cache.has(w)) return cache.get(w);
    let best = w;
    for (const s of stemCandidates(w)) {
      if (s !== w && support.get(s) >= 2 && s.length < best.length) best = s;
    }
    cache.set(w, best);
    return best;
  };
}

/**
 * @param {number[][]} groups  묶음별 댓글 인덱스
 * @param {string[]} texts     전체 댓글 텍스트
 * @returns {string[][]} 묶음별 키워드 (중요한 순, 최대 k개)
 */
export function topicKeywords(groups, texts, { k = 3 } = {}) {
  const raw = texts.map(tokenize);
  const stem = buildStemmer(raw);
  const docs = raw.map((list) => new Set(list.map(stem).filter((w) => w.length >= 2 && !STOP.has(w))));
  const N = docs.length;
  const df = new Map();
  for (const d of docs) for (const w of d) df.set(w, (df.get(w) || 0) + 1);

  return groups.map((g) => {
    const tf = new Map();
    for (const i of g) for (const w of docs[i]) tf.set(w, (tf.get(w) || 0) + 1);
    const need = Math.max(2, Math.ceil(g.length * 0.15));
    const scored = [];
    for (const [w, c] of tf) {
      if (c < need) continue;
      scored.push([w, (c / g.length) * Math.log(1 + N / df.get(w))]);
    }
    scored.sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
    const out = [];
    for (const [w] of scored) {
      if (out.some((o) => o.includes(w) || w.includes(o))) continue; // "정책" / "정책이" 같은 겹침 제거
      out.push(w);
      if (out.length >= k) break;
    }
    return out;
  });
}
