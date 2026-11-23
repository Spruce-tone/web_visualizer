// 어조 표현 찾기 — 설명용. 의심 점수와 지도 배치에는 쓰지 않는다 (docs/objectivity.md 기준 1).
// 방법: 누구에게나 똑같이 쓰이는 일반 평가 어휘만 사전으로 둔다. 인물·정당·국가 이름이나 특정 대상 전용 멸칭은 넣지 않는다.
//       → 같은 문장에서 대상만 바꿔도 결과가 같다(바꿔 넣기 테스트로 검증).
// 한계: 반어·비꼼, 사전에 없는 표현은 잡지 못한다. 그래서 '추정'으로만 표시하고 확신이 낮으면 '불확실'로 둔다.

// 어간 기준 (단어가 이 글자로 시작하면 일치)
const CONDEMN = `한심 역겹 역겨 혐오 쓰레기 뻔뻔 파렴치 추악 더럽 더러운 수치 부끄럽 부끄러 창피 망신 썩었 썩은 무능 무책임 거짓말 사기꾼 위선 비겁 악질 최악 나쁜 못된 양심없 양심도
정신차려 꺼져 물러나 사퇴하 처벌 구속하 감옥 범죄자 매국 반역 적폐 추하 저질 천박 가증 괘씸 기가막 어이없 염치 후안무치 몰상식 비열 야비 끔찍 한심하
disgusting shame shameful pathetic corrupt liar evil worst traitor hypocrite disgrace terrible trash garbage idiot stupid coward criminal awful`.split(/\s+/).filter(Boolean);
const PRAISE = `존경 훌륭 대단하 대단한 멋지 멋진 멋있 자랑스럽 자랑스러 감동 영웅 응원 지지합 믿습니다 위대 탁월 현명 용기 본받 천재 역시 든든 고맙 감사 사랑합 사랑해 최고의 최고다 최고입 최고예 최고야
admire respect hero proud brilliant wonderful inspiring genius brave love amazing awesome great`.split(/\s+/).filter(Boolean);

const TOKEN_RE = /[\p{L}\p{N}]+/gu;

/**
 * @returns {{label: "condemn"|"praise"|"mixed"|"none", condemn: number, praise: number, strength: "뚜렷"|"약함"|null, spans: {start,end,type}[]}}
 */
export function toneOf(text) {
  const spans = [];
  let c = 0, p = 0;
  for (const m of String(text).matchAll(TOKEN_RE)) {
    const w = m[0].toLowerCase();
    let type = null;
    if (CONDEMN.some((s) => w.startsWith(s))) type = "condemn";
    else if (PRAISE.some((s) => w.startsWith(s))) type = "praise";
    if (!type) continue;
    if (type === "condemn") c++; else p++;
    spans.push({ start: m.index, end: m.index + m[0].length, type });
  }
  let label = "none";
  if (c || p) {
    const lo = Math.min(c, p), hi = Math.max(c, p);
    label = lo / hi >= 0.5 ? "mixed" : c > p ? "condemn" : "praise";
  }
  return { label, condemn: c, praise: p, strength: label === "none" || label === "mixed" ? null : Math.max(c, p) >= 2 ? "뚜렷" : "약함", spans };
}

const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/**
 * 영상 단위 요약 (사실 서술만): 표현별 댓글 수, 좋아요 중앙값, 좋아요 상위 10% 댓글 안에서의 비율
 */
export function toneSummary(comments) {
  const tones = comments.map((c) => toneOf(c.text));
  const likesSorted = comments.map((c) => c.likes || 0).sort((a, b) => b - a);
  const topCut = likesSorted[Math.max(0, Math.ceil(comments.length * 0.1) - 1)] ?? 0;
  const isTop = (c) => (c.likes || 0) >= topCut && (c.likes || 0) > 0;
  const topN = comments.filter(isTop).length;
  const rows = ["condemn", "praise", "mixed", "none"].map((label) => {
    const idx = [];
    tones.forEach((t, i) => t.label === label && idx.push(i));
    return {
      label,
      count: idx.length,
      share: comments.length ? idx.length / comments.length : 0,
      medianLikes: median(idx.map((i) => comments[i].likes || 0)),
      topShare: topN ? idx.filter((i) => isTop(comments[i])).length / topN : 0,
      indices: idx,
    };
  });
  return { tones, rows, topN };
}

export const TONE_LABEL = { condemn: "비난 표현", praise: "칭찬 표현", mixed: "섞임 (불확실)", none: "평가 표현 없음" };
