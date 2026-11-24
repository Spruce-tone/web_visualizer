// 주제 묶음별 키워드 추출 (형태소 분석기 없이 가볍게)
// 1) 토큰화 → 2) 조사·흔한 어미 떼기(말뭉치 안에서 근거가 있을 때만) → 3) 묶음별로 우연보다 많이·쏠려 나온 낱말을 z 순으로
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
말고 거다 거임 그니까 아니냐 아니고 아니라 이렇게 저렇게 그렇게 어떻게 없다 있다 했다 된다 하게 못하게 것도 그것도 이미 이걸 보면 누구 뭐가 다들 모든
것이 것은 것을 거의 때문 때문에 정도 경우 이상 사람 사람들 생각 영상 댓글 구독 좋아요 감사 감사합니다 ㅋㅋ ㅎㅎ ㅠㅠ
the a an and or but is are was were be been to of in on at for with this that these those it its as by from not no do does did have has had you your i my me we our they he she
just so very really too can will would could should what when where who how why if then than there here about into out up down
`.split(/\s+/).filter(Boolean));

export function tokenize(text) {
  // 답글 앞의 @아이디는 주제 낱말이 아니고, 작성자 이름을 키워드로 드러내지 않기 위해 뺀다
  return normalizeForEmbed(String(text).replace(/@[^\s@]+/gu, " "))
    .split(" ")
    .filter((w) => w.length >= 2 && w.length <= 20 && !/^[ㄱ-ㅎㅏ-ㅣ]+$/.test(w) && !/^\d+$/.test(w));
}

function stemCandidates(w) {
  const out = [w];
  if (!/[가-힣]$/.test(w)) return out;
  for (const j of SUFFIX) {
    if (w.length - j.length >= 2 && w.endsWith(j)) out.push(w.slice(0, -j.length));
  }
  return out;
}

// 복수 "들"은 조사 앞에 한 번 더 붙는다 ("기자들이" → "기자들" → "기자")
function pluralCandidates(w) {
  return stemCandidates(w).filter((s) => s.length >= 3 && s.endsWith("들")).map((s) => s.slice(0, -1));
}

/**
 * 말뭉치에서 조사 떼기 규칙을 만든다: 어간이 서로 다른 표면형 2개 이상에서 확인될 때만 뗀다.
 * 예) "정책은", "정책을" → "정책" / "고양이", "고양이가" → "고양이" ("고양"은 근거가 1개뿐이라 채택 안 함)
 */
export function buildStemmer(tokenLists) {
  const forms = new Set();
  for (const list of tokenLists) for (const w of list) forms.add(w);
  const support = new Map(); // 어간 → 서로 다른 표면형 수 ("들"을 떼지 않고 닿는 것만)
  for (const w of forms) for (const s of stemCandidates(w)) support.set(s, (support.get(s) || 0) + 1);
  const cache = new Map();
  return (w) => {
    if (cache.has(w)) return cache.get(w);
    let best = w;
    for (const s of stemCandidates(w)) {
      if (s !== w && support.get(s) >= 2 && s.length < best.length) best = s;
    }
    // "들" 떼기는 "X"가 그대로 나오거나 "X+조사"가 두 가지 이상 나올 때만 ("기자들이"+"기자" → "기자").
    // "큰아들", "큰아들이"는 서로를 근거로 삼지 않고, 검증 안 된 조사 떼기 하나("큰아이" → "큰아")도 근거가 되지 않는다.
    for (const s of pluralCandidates(w)) {
      if ((forms.has(s) || (support.get(s) || 0) >= 2) && s.length < best.length) best = s;
    }
    cache.set(w, best);
    return best;
  };
}

/**
 * 키워드가 되려면 묶음 안에서 나와야 하는 최소 댓글 수.
 * - 16개 이하: 2번 — 두 번이면 충분히 그 묶음의 말이다.
 * - 그 위: 3%, 최소 3번 (100개까지는 3번). 묶음이 클수록 말투가 흩어져 한 낱말이 차지하는 비율이 낮아지므로,
 *   예전처럼 12%를 요구하면 300개 묶음은 36번이 필요해 키워드가 비게 된다. 우연은 아래 z 검사로 거른다.
 */
export function minCount(size) {
  return size <= 16 ? 2 : Math.max(3, Math.ceil(size * 0.03));
}

/**
 * 키워드가 그 묶음에 우연보다 많이 나왔다고 볼 기준 (초기하 분포의 정규 근사로 잰 z). 1.96 = 양측 95%(단측 97.5%).
 * 다중 비교 보정은 아니다. 큰 묶음에서 우연히 조금 많이 나온 푸념은 아래 SPEC_MIN이 거른다.
 */
const Z_MIN = 1.96;
/**
 * z만 보면 큰 묶음에서는 "조금 더 나온" 흔한 낱말도 표본이 커서 쉽게 넘는다. 그래서 차이의 크기도 본다. 둘 중 하나면 된다.
 * - LIFT_MIN: 그 묶음에서 영상 전체보다 2배 이상 자주 나온다. 여러 주제에 걸친 낱말(예: 두세 주제에서 많이 쓰인 낱말)도 산다.
 * - SPEC_MIN: 쏠림 = (그 낱말이 나온 댓글 중 이 묶음 몫 − 묶음 크기 몫) / (1 − 묶음 크기 몫). 무작위면 0, 이 묶음에만 나오면 1.
 *   댓글 대부분을 차지하는 묶음은 배율이 1/몫을 넘을 수 없어(70% 묶음이면 최대 1.4배) 배율 대신 이 눈금으로 본다.
 *   0.4 = 무작위와 독점 사이의 40% 이상.
 */
const LIFT_MIN = 2;
const SPEC_MIN = 0.4;

/**
 * 낱말이 묶음 안에 c번 나왔을 때, 무작위로 나눴을 때보다 얼마나 많은지 (초기하 분포의 정규 근사).
 * @param {number} c 묶음 안 댓글 수, @param {number} g 묶음 크기, @param {number} d 전체에서 그 낱말이 나온 댓글 수, @param {number} N 전체 댓글 수
 */
export function zScore(c, g, d, N) {
  if (g >= N) return Infinity; // 묶음이 전부면 견줄 바깥이 없다
  const p = d / N;
  const v = g * p * (1 - p) * (N - g) / (N - 1);
  return v > 0 ? (c - g * p) / Math.sqrt(v) : (c > g * p ? Infinity : 0);
}

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
    const scored = [];
    const multi = groups.length > 1;
    for (const [w, c] of tf) {
      if (c < need) continue;
      const inC = c / g.length, overall = df.get(w) / N;
      // 모든 묶음에 흔한 낱말(예: 정치 영상의 "민주당")은 비율이 1에 가까워 빠진다 → 묶음을 가르는 낱말만 남는다.
      if (multi && Math.log(inC / overall) <= 0.05) continue;
      // 두 낱말 묶음 안에 영상 전체에 흔한 낱말(예: 정치 영상의 "민주당")이 있으면 묶음을 가르지 못하므로 뺀다
      if (w.includes(" ") && multi && w.split(" ").some((p) => (df.get(p) || 0) / N >= 0.35)) continue;
      const bonus = w.includes(" ") ? 1.15 : 1; // 두 낱말 묶음이 충분히 자주 나오면 조금 우선
      if (!multi) { scored.push([w, inC * bonus]); continue; }
      // 우연을 거른다: 영상 전체 비율대로 무작위로 나눴을 때 기대되는 수보다 충분히 많아야(z) 하고, 충분히 쏠려(spec) 있어야 한다.
      // 기준을 못 넘는 낱말로 예비 이름을 짓지 않는다 — 그중 가장 나은 것은 대개 우연히 조금 많이 나온 푸념이다.
      // 이름이 비면 "주제 N"으로 보인다 (잡음 이름보다 낫다).
      const z = zScore(c, g.length, df.get(w), N);
      const f = g.length / N;
      const spec = f < 1 ? (c / df.get(w) - f) / (1 - f) : 1;
      if (z < Z_MIN || (inC / overall < LIFT_MIN && spec < SPEC_MIN)) continue;
      // 순위는 z로 (Monroe 외 2008, "Fightin' Words": 낱말을 묶음 사이 차이의 z로 줄 세운다).
      // 빈도 비율 × 로그 비율로 세우면, 흔한 푸념이 큰 묶음에서 조금 더 나온 것과 드물지만 그 묶음에만 나온 낱말이 비슷해진다.
      scored.push([w, Math.min(z, 1e6) * bonus]);
    }
    scored.sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || (a[0] < b[0] ? -1 : 1));
    const out = [];
    for (const [w] of scored) {
      // 이미 고른 것과 낱말이 겹치면 건너뛴다 (다양성: "탄핵" 과 "탄핵 반대" 중 하나만)
      const parts = w.split(" ");
      if (out.some((o) => o.split(" ").some((p) => parts.some((q) => p.includes(q) || q.includes(p))))) continue;
      out.push(w);
      if (out.length >= k) break;
    }
    return out;
  });
  return result;
}
