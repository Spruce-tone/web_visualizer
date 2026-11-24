// 주제 묶음별 키워드 추출 (형태소 분석기 없이 가볍게)
// 1) 토큰화 → 2) 조사·흔한 어미 떼기(말뭉치 안에서 근거가 있을 때만) → 3) 묶음별 c-TF-IDF 로 상위 단어 선택
import { normalizeForEmbed } from "./embed/hash.js";

const JOSA = [
  "으로부터", "에서부터", "이라고", "에게서", "으로써", "으로서", "에서는", "에서도", "이라는", "이지만", "입니다", "이에요",
  "라고", "라는", "지만", "예요", "에서", "에게", "한테", "께서", "으로", "처럼", "보다", "까지", "부터", "마저", "조차", "이나", "이랑", "하고", "이며", "이고", "이다", "에는", "에도", "으론", "이라",
  "은", "는", "이", "가", "을", "를", "의", "에", "도", "로", "와", "과", "만", "랑", "나", "요",
];

// 명사 뒤에 붙는 흔한 동사·형용사 어미 ("통제하는", "처벌해야", "공개된다" → "통제", "처벌", "공개").
// 조사와 같이 말뭉치 안에 어간이 다른 표면형 2개 이상으로 나올 때만 뗀다.
const EOMI = [
  "했는데", "하는데", "합니다", "하려는", "해야지", "됩니다", "되는데",
  "하는", "하고", "한다", "하면", "해서", "해야", "했다", "하지", "하네", "하자", "되는", "된다", "되고", "되면", "됐다", "되어", "시키는",
];
const SUFFIX = [...new Set([...JOSA, ...EOMI])].sort((a, b) => b.length - a.length);

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
  for (const j of SUFFIX) {
    if (w.length - j.length >= 2 && w.endsWith(j)) out.push(w.slice(0, -j.length));
  }
  // 복수 "들"은 조사 앞에 한 번 더 붙는다 ("기자들이" → "기자들" → "기자")
  for (const s of [...out]) if (s.length >= 3 && s.endsWith("들")) out.push(s.slice(0, -1));
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
 * 키워드가 되려면 묶음 안에서 나와야 하는 최소 댓글 수.
 * - 작은 묶음(약 25개 미만): 12% (최소 2) — 두세 번이면 충분히 그 묶음의 말이다.
 * - 큰 묶음: 3% (최소 3). 묶음이 클수록 말투가 흩어져 한 낱말이 차지하는 비율이 낮아지므로, 비율 기준을 그대로 두면
 *   300개 묶음은 36번이 필요해 키워드가 비게 된다. 대신 아래 Z_MIN 검사로 우연을 거른다.
 */
export function minCount(size) {
  return Math.max(2, Math.min(Math.ceil(size * 0.12), Math.max(3, Math.ceil(size * 0.03))));
}

/** 키워드가 그 묶음에 우연보다 많이 나왔다고 볼 기준 (정규 근사 95%). 낱말 여럿을 한꺼번에 견주므로 단측 1.645보다 조금 엄하게 둔다. */
const Z_MIN = 1.96;

/**
 * @param {number[][]} groups  묶음별 댓글 인덱스
 * @param {string[]} texts     전체 댓글 텍스트
 * @returns {string[][]} 묶음별 키워드 (그 묶음을 다른 묶음과 가르는 낱말부터, 최대 k개)
 */
export function topicKeywords(groups, texts, { k = 3 } = {}) {
  const raw = texts.map(tokenize);
  const stem = buildStemmer(raw);
  // 낱말 + 두 낱말 묶음(예: "탄핵 반대", "사법부 독립") — 묶음의 성향은 낱말 하나보다 두 낱말에서 더 잘 드러난다
  const docs = raw.map((list) => {
    const words = list.map(stem).filter((w) => w.length >= 2 && !STOP.has(w));
    const set = new Set(words);
    for (let i = 0; i + 1 < words.length; i++) if (words[i] !== words[i + 1]) set.add(`${words[i]} ${words[i + 1]}`);
    return set;
  });
  const N = docs.length;
  const df = new Map();
  for (const d of docs) for (const w of d) df.set(w, (df.get(w) || 0) + 1);

  const result = groups.map((g) => {
    const tf = new Map();
    for (const i of g) for (const w of docs[i]) tf.set(w, (tf.get(w) || 0) + 1);
    const need = minCount(g.length);
    const scored = [], weak = [];
    for (const [w, c] of tf) {
      if (c < need) continue;
      // 그 묶음에서 얼마나 자주 쓰이는가 × 영상 전체보다 얼마나 더 자주 쓰이는가.
      // 모든 묶음에 흔한 낱말(예: 정치 영상의 "민주당")은 비율이 1에 가까워 점수가 0 근처가 된다 → 묶음을 가르는 낱말만 남는다.
      const inC = c / g.length, overall = df.get(w) / N;
      const lift = Math.log(inC / overall);
      if (lift <= 0.05 && groups.length > 1) continue;
      // 두 낱말 묶음 안에 영상 전체에 흔한 낱말(예: 정치 영상의 "민주당")이 있으면 묶음을 가르지 못하므로 뺀다
      if (w.includes(" ") && groups.length > 1 && w.split(" ").some((p) => (df.get(p) || 0) / N >= 0.35)) continue;
      const bonus = w.includes(" ") ? 1.15 : 1; // 두 낱말 묶음이 충분히 자주 나오면 조금 우선
      const item = [w, inC * (groups.length > 1 ? lift : 1) * bonus];
      // 우연한 들쭉날쭉을 거른다: 영상 전체 비율대로 무작위로 나눴을 때 기대되는 수보다 표준편차 Z_MIN 배 이상 많아야 한다.
      // (큰 묶음에서는 흔한 푸념도 몇 %쯤은 우연히 더 나오므로, 비율만 보면 그런 낱말이 키워드로 뽑힌다)
      const z = groups.length > 1 ? (c - g.length * overall) / Math.sqrt(g.length * overall * (1 - overall) || 1) : Infinity;
      (z >= Z_MIN ? scored : weak).push(item);
    }
    // 뚜렷한 낱말이 하나도 없으면, 그나마 가장 가르는 낱말 하나라도 (주제 이름이 "주제 N"으로 비지 않게)
    if (!scored.length && weak.length) scored.push(weak.sort((a, b) => b[1] - a[1])[0]);
    scored.sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || (a[0] < b[0] ? -1 : 1));
    const out = [];
    for (const [w] of scored) {
      // 이미 고른 것과 낱말이 겹치면 건너뛴다 (다양성: "탄핵" 과 "탄핵 반대" 중 하나만)
      const parts = w.split(" ");
      if (out.some((o) => o.split(" ").some((p) => parts.some((q) => p.includes(q) || q.includes(p))))) continue;
      out.push(w);
      if (out.length >= k) break;
    }
    if (!out.length) { // 가르는 낱말이 없으면 가장 흔한 낱말이라도
      const common = [...tf].filter(([, c]) => c >= Math.min(need, 2)).sort((a, b) => b[1] - a[1]);
      if (common.length) out.push(common[0][0]);
    }
    return out;
  });
  return result;
}
