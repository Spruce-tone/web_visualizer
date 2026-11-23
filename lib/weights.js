// 점수 기준(가중치·임계값) 프로필.
// - 기본: 사람이 정해 문서화한 규칙 (docs/objectivity.md, docs/signals.md)
// - 선택: 공개 데이터로 보정한 값 (calibration/weights.json — `npm run calibrate`로 만든다. 없으면 선택 불가)
// 어떤 프로필이든 "무슨 말을 했는가(어조·주장·대상)"는 점수 항목에 없다. 행동과 구조만 본다.

export const DEFAULT_WEIGHTS = {
  version: "rule-v2",
  source: "기본 규칙",
  cluster: {
    nearIdentical: 35,   // 묶음 평균 문구 유사도 ≥ thresholds.nearIdentical
    similar: 15,         // ≥ thresholds.similar
    perAuthor: 6,        // 서로 다른 작성자 1명당
    authorsMax: 30,
    sameAuthorRepeat: 10,
    timeBurst: 20,       // 영상 전체 댓글의 burstShare 이하만 들어 있는 시간 구간에 묶음 전체가 몰림
    longText: 5,
  },
  author: {
    selfDup: 40,         // × 자기 복제 비율 (1 − 고유 댓글 수 ÷ 댓글 수)
    crossMatch: 30,      // × 다른 작성자와 문구가 겹치는 댓글 비율
    volume: 15,          // 이 영상 작성자 중 상위 5% 다작
    likesDiscount: 15,   // 평균 좋아요가 상위 25%면 감점 (논문: 평균 좋아요가 높을수록 일반 사용자 쪽)
  },
  thresholds: {
    nearIdentical: 0.75,
    similar: 0.6,
    flag: 50,            // 이 점수 이상이면 강조
    minSize: 3,          // 묶음 댓글이 이보다 적으면 판단 보류
    minAuthorComments: 3,
    shortLen: 6,
    longLen: 30,
    burstShare: 0.1,
    fineTimeShare: 0.8,  // 묶음 댓글 중 분·시간 단위 시각이 이 비율 이상일 때만 시간 몰림을 평가
  },
};

export function mergeWeights(base, override) {
  const out = structuredClone(base);
  for (const k of ["cluster", "author", "thresholds"]) Object.assign(out[k], override?.[k] || {});
  if (override?.version) out.version = override.version;
  if (override?.source) out.source = override.source;
  return out;
}

/** 숫자 범위를 벗어난 보정값은 받지 않는다 */
export function validateWeights(w) {
  if (!w || typeof w !== "object") return false;
  for (const k of ["cluster", "author"]) {
    for (const v of Object.values(w[k] || {})) if (typeof v !== "number" || !isFinite(v) || v < 0 || v > 100) return false;
  }
  for (const [k, v] of Object.entries(w.thresholds || {})) {
    if (typeof v !== "number" || !isFinite(v) || v < 0 || (k !== "flag" && k !== "minSize" && k !== "minAuthorComments" && k !== "shortLen" && k !== "longLen" && v > 1)) return false;
  }
  return true;
}

/** 보정 프로필이 설치돼 있으면 읽는다 (확장 안의 파일, 없으면 null) */
export async function loadCalibrated() {
  try {
    const res = await fetch(new URL("../calibration/weights.json", import.meta.url));
    if (!res.ok) return null;
    const json = await res.json();
    return validateWeights(json) ? mergeWeights(DEFAULT_WEIGHTS, json) : null;
  } catch {
    return null;
  }
}
