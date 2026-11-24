// 키워드·주제 합치기 테스트용 한국어 댓글 묶음 (실제 뉴스 영상 댓글의 모양을 흉내 낸 합성 자료)
// - 실제 댓글을 저장하지 않는다. 손으로 쓴 문장 조각을 고정 시드로 섞어 실행할 때 만든다.
// - 모양: 큰 주제는 흐릿하다(주제 낱말이 댓글의 일부에만, 여러 어미로 나온다), 모든 주제에 공통 푸념이 섞인다.
// - 인물·정당·국가 이름은 쓰지 않는다.

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 어느 주제에나 나오는 푸념·감탄 (주제를 가르지 못해야 한다)
const COMMON = [
  "이게 나라냐", "어이가 없네요", "앞으로 어떻게 될지 걱정이다", "국민들이 알아야 합니다", "참 답답하다",
  "말이 안 되는 소리", "세상 참 무섭네", "기가 막힌다", "다들 정신 차려야", "이걸 누가 믿냐",
  "한심하다 정말", "뉴스 보고 깜짝 놀람", "누구를 위한 건지 모르겠다", "결국 국민만 손해", "두고 보면 알겠지",
];

// 주제마다 핵심 낱말이 여러 어미·조사로 나오는 문장들
export const TOPIC_CORE = {
  자유: [
    "표현의 자유가 사라진다", "표현의 자유를 지켜야 한다", "자유는 한번 잃으면 못 찾는다", "말할 자유도 없는 세상",
    "자유가 없는 나라가 되어간다", "표현의 자유는 헌법에 있는 권리", "자유를 빼앗기는 줄도 모르고", "이제 자유롭게 말도 못하네",
    "자유는 공짜가 아니다", "자유가 무너지는 소리가 들린다",
  ],
  가짜뉴스: [
    "가짜뉴스는 처벌해야 맞다", "가짜뉴스를 퍼뜨리는 사람들 처벌하는 건 당연", "가짜뉴스 때문에 피해 본 사람들 생각해라",
    "가짜뉴스로 돈 버는 채널들", "가짜뉴스와 비판은 다르다", "가짜뉴스가 판치는 세상", "처벌이 약해서 가짜뉴스가 넘친다",
    "가짜뉴스 만드는 사람들 처벌하자", "누가 가짜뉴스인지 정하냐가 문제", "가짜뉴스를 막는 건 찬성",
  ],
  감시: [
    "감시사회가 시작됐다", "모든 걸 감시하는 빅브라더", "감시가 일상이 되는 나라", "국민을 감시하려는 법",
    "감시당하는 기분 소름", "감시 카메라 다음은 댓글 감시", "감시가 심해지면 다들 입을 닫는다", "감시하는 쪽은 누가 감시하나",
  ],
  기자: [
    "기자들은 뭐하냐", "기자가 제대로 취재를 안 함", "기자들 질문 수준 보소", "이 기자 다른 기사도 이상하던데",
    "기자는 사실만 전해라", "기자들이 받아쓰기만 한다", "기자 이름 기억해 둔다", "기자라면 반대쪽 말도 들어봐야지",
  ],
};

/**
 * @param {{ sizes?: Record<string, number>, coreRate?: Record<string, number>, seed?: number }} opt
 *   sizes: 주제별 댓글 수, coreRate: 주제별로 핵심 문장이 들어가는 비율 (나머지는 공통 푸념만 → 흐릿한 주제)
 * @returns {{ names: string[], groups: number[][], texts: string[] }}
 */
export function koreanTopics({
  sizes = { 자유: 300, 가짜뉴스: 120, 감시: 80, 기자: 50 },
  coreRate = { 자유: 0.08, 가짜뉴스: 0.6, 감시: 0.6, 기자: 0.7 },
  seed = 7,
} = {}) {
  const r = rng(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const names = Object.keys(sizes);
  const groups = [], texts = [];
  for (const name of names) {
    const g = [];
    for (let i = 0; i < sizes[name]; i++) {
      const parts = [];
      if (r() < coreRate[name]) parts.push(pick(TOPIC_CORE[name]));
      parts.push(pick(COMMON));
      if (r() < 0.4) parts.push(pick(COMMON));
      if (r() < 0.5) parts.reverse();
      g.push(texts.length);
      texts.push(parts.join(" ") + (r() < 0.3 ? " ㅋㅋ" : r() < 0.3 ? "..." : ""));
    }
    groups.push(g);
  }
  return { names, groups, texts };
}
