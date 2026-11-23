// 사이트 무관 분석 함수. 입력은 공통 스키마 Comment[].
// M1에서 유사도 클러스터, 시간 폭주 탐지 등이 여기 추가된다.

/** 근사 작성 시각을 시간순 구간으로 묶는다. 상대시간 단위가 거칠어 '구간 라벨' 기반으로 집계 */
export function timeHistogram(comments) {
  const pts = comments.map((c) => c.createdAtApprox && Date.parse(c.createdAtApprox)).filter(Boolean);
  if (!pts.length) return [];
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = max - min;
  const DAY = 86400e3;
  // 기간에 따라 구간 크기 결정
  const step = span <= 2 * DAY ? 3600e3 : span <= 60 * DAY ? DAY : 7 * DAY;
  const n = Math.max(1, Math.floor(span / step) + 1);
  const bins = Array.from({ length: Math.min(n, 120) }, (_, i) => ({ start: min + i * step, count: 0 }));
  for (const t of pts) {
    const i = Math.min(bins.length - 1, Math.floor((t - min) / step));
    bins[i].count++;
  }
  const fmt = step < DAY
    ? (t) => new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric" })
    : (t) => new Date(t).toLocaleDateString("ko-KR", { year: "2-digit", month: "numeric", day: "numeric" });
  return bins.map((b) => ({ ...b, label: fmt(b.start) }));
}

export function topByLikes(comments, k = 5) {
  return [...comments].sort((a, b) => b.likes - a.likes).slice(0, k);
}

/** 공백·문장부호·이모지 차이를 무시한 완전 일치 그룹 */
export function normalize(text) {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function exactDuplicates(comments, minCount = 2) {
  const groups = new Map();
  for (const c of comments) {
    const key = normalize(c.text);
    if (key.length < 4) continue; // "ㅋㅋ" 같은 짧은 반응은 제외
    if (!groups.has(key)) groups.set(key, { text: c.text, items: [] });
    groups.get(key).items.push(c);
  }
  return [...groups.values()]
    .filter((g) => g.items.length >= minCount)
    .map((g) => ({ text: g.text, count: g.items.length, authors: new Set(g.items.map((c) => c.authorId || c.author)).size }))
    .sort((a, b) => b.count - a.count);
}
