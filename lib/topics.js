// 주제 나누기: 이웃 그래프 → Louvain → 같은 키워드 합치기 → 큰 순 번호 → 키워드 → 겹침.
// 패널(sidepanel.js computeTopics)과 검증 스크립트(scripts/evaluate.mjs)가 같은 계산을 쓰도록 한곳에 둔다.
import { louvain, overlapTopics, mergeSameKeywordTopics } from "./community.js";
import { topicKeywords } from "./keywords.js";

/** 세밀도 슬라이더(0~100) → Louvain resolution(0.25~4). 50이 보통(1.0) */
export const resolutionOf = (v) => 0.25 * Math.pow(16, v / 100);

const groupsOf = (arr) => { const g = []; arr.forEach((c, i) => { if (c >= 0) (g[c] ||= []).push(i); }); return g.map((x) => x || []); };
/** 댓글 번호 ids → 점 번호(0 = 본문, i+1 = 댓글 i) */
const asNodes = (ids) => Int32Array.from({ length: ids.length + 1 }, (_, k) => (k === 0 ? -1 : ids[k - 1]));

/**
 * @param {{n:number, graphEdges:{a:number,b:number,w:number}[], short:boolean[], texts:string[], resolution:number}} p
 *   graphEdges는 점 번호(0 = 본문, i+1 = 댓글 i) 기준
 * @returns {{ids:Int32Array, groups:number[][], keywords:string[][], merges:any[], ov:{extra:number[][], members:Map<number,number[]>}}}
 *   ids[i] = 댓글 i의 주 주제(큰 순 0..K-1, 짧은 반응 -1)
 */
export function topicPartition({ n, graphEdges, short, texts, resolution }) {
  const lv = louvain(n + 1, graphEdges, { resolution, minSize: Math.max(3, Math.round(n / 200)) });
  let ids = Int32Array.from({ length: n }, (_, i) => (short[i] ? -1 : lv.ids[i + 1]));
  // 키워드가 같고 서로 이어진 주제는 합친다
  const mg = mergeSameKeywordTopics(asNodes(ids), graphEdges,
    (pt) => topicKeywords(groupsOf(Array.from(pt.subarray(1))), texts, { k: 4 }), { resolution });
  ids = Int32Array.from(mg.ids.subarray(1));
  // 큰 묶음부터 번호를 다시 매긴다
  const order = groupsOf(ids).map((g, c) => [c, g.length]).filter(([, s]) => s > 0).sort((p, q) => q[1] - p[1] || p[0] - q[0]);
  const rank = new Map(order.map(([c], r) => [c, r]));
  ids = ids.map((c) => (c >= 0 ? rank.get(c) : -1));
  const groups = groupsOf(ids);
  const keywords = topicKeywords(groups, texts, { k: 4 }); // 주 주제 기준 (보조로 들어온 댓글이 키워드를 흐리지 않게)
  // 겹침: 이웃 그래프에서 다른 주제와도 강하게 이어진 댓글은 그 주제에도 넣는다
  const ov = overlapTopics(asNodes(ids), graphEdges);
  return { ids, groups, keywords, merges: mg.merges, ov };
}
