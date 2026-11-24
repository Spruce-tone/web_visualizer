// 지도 배치.
// - 묶음(주제)마다 '닻'을 두고, 닻끼리는 겹치지 않게 떨어뜨린다 → 주제가 섬처럼 갈라져 보인다.
// - 점은 자기 닻 쪽으로 끌리고, 가까운 점끼리는 밀어낸다(격자로 가까운 점만 계산 → 수천 개도 실시간).
// - 닻을 옮기면(키워드 끌기) 그 묶음의 점이 모두 함께 움직인다. 손으로 옮긴 점은 고정된다.
// - 닻이 없을 때 키워드를 끌면: 끄는 동안 그 주제는 힘 계산에서 빠져 커서만 따르고, 놓은 뒤에는 주제 중심이 그 자리에 머문다
//   (모양은 계속 다듬어지고, 이웃 주제가 비켜 준다). '고정 풀기'로 푼다.
// - 닻이 없으면(작성자 지도) 예전처럼 이웃 간선과 중심 인력으로 배치한다.

const CUTOFF = 36;

// 주제를 아는 배치 (닻 없는 댓글 지도, cohesion > 0).
// 주제를 모르는 힘 배치는 댓글이 많을수록 UMAP이 만든 분리를 흐렸다. 한 영상(SBS 8뉴스)의 실제 임베딩, 패널과 같은 계산:
//   2D 실루엣(클수록 주제가 갈림)  300개 0.27/0.26 → 0.45/0.41,  1,000개 0.11/0.18 → 0.37/0.38,  3,000개 0.07/0.07 → 0.23/0.28  (Gemma/Bekko)
//   섬 검사: 모두 근접 덩어리 1개, 주제 사이 가장 큰 틈은 점 간격의 1.3~1.9배. 이웃 보존(고차원 이웃 15개가 지도에서도 가까운 비율)은 조금 오름.
// 판단 재료는 이웃 그래프와 그 주제(Louvain)뿐이다. 주제 사이 선은 그대로 그려 이어진 그래프로 남긴다.
/** 다른 주제를 잇는 선: 당김 배율과 목표 길이 배율 (약하고 길게 → 주제 사이 '다리') */
export const CROSS_PULL = 0.35;
export const CROSS_LEN = 1.8;
/** 두 주제 중심이 (반경 합 × 이 값)보다 가까우면 겹친 만큼 통째로 민다 */
export const TOPIC_GAP = 1.4;
export const TOPIC_PUSH = 0.12;
/** 주제를 아는 배치는 더 오래 다듬는다. 다만 거의 자리 잡은 뒤(alpha < TAIL_FROM)는 빨리 식힌다:
 *  검증 세트 30개 영상 + 3,000개 표본에서 실루엣·덩어리 수·틈은 그대로, 멈출 때까지 프레임 117 → 78 (qa/2026-11-30) */
const TOPIC_DECAY = 0.985;
const TAIL_FROM = 0.1, TAIL_DECAY = 0.95;
/** 서로 닿지 않은 주제 무리는 가장 가까운 다른 무리 쪽으로 남은 거리 × 이 값씩 당긴다. 주제 사이 선이 거의 없어도 섬이 되지 않게 */
const TOPIC_CONTACT = 0.1;

/**
 * 그리는 선 줄이기: 점마다 가장 강한 선 perNode개만 남긴다(너무 빽빽하지 않게).
 * 그렇게 줄이다 원래 이어져 있던 무리가 끊기면, 버린 선 중 가장 강한 것부터 끊긴 곳을 다시 잇는다 (지도에 섬이 생기지 않게).
 * @param {{a:number,b:number,w:number}[]} edges
 * @returns 남긴 선 (입력 순서 그대로)
 */
export function thinEdges(edges, perNode = 3) {
  const per = new Map();
  edges.forEach((e, k) => { for (const p of [e.a, e.b]) { if (!per.has(p)) per.set(p, []); per.get(p).push(k); } });
  const keep = new Uint8Array(edges.length);
  for (const list of per.values()) { list.sort((u, v) => edges[v].w - edges[u].w || u - v); for (const k of list.slice(0, perNode)) keep[k] = 1; }
  const root = new Map();
  const find = (i) => { if (!root.has(i)) root.set(i, i); while (root.get(i) !== i) { root.set(i, root.get(root.get(i))); i = root.get(i); } return i; };
  edges.forEach((e, k) => { if (keep[k]) root.set(find(e.a), find(e.b)); });
  const rest = edges.map((_, k) => k).filter((k) => !keep[k]).sort((u, v) => edges[v].w - edges[u].w || u - v);
  for (const k of rest) { const ra = find(edges[k].a), rb = find(edges[k].b); if (ra !== rb) { root.set(ra, rb); keep[k] = 1; } }
  return edges.filter((_, k) => keep[k]);
}

/** 묶음 크기에 맞는 섬의 반지름 */
export const groupRadius = (size) => 18 + 8.5 * Math.sqrt(size);

/**
 * 닻 위치 정하기: 묶음 중심 벡터의 2D 투영을 출발점으로, 서로(그리고 가운데 본문과) 겹치지 않을 때까지 밀어낸다. 결정적.
 * @param {number[][]} coords 묶음별 [x, y] (아무 스케일)
 * @param {number[]} sizes
 * @returns {{x, y, r}[]}
 */
export function placeAnchors(coords, sizes, { gap = 34, centerClear = 40 } = {}) {
  const k = coords.length;
  let maxAbs = 1e-9;
  for (const [x, y] of coords) maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(y));
  const total = sizes.reduce((s, n) => s + groupRadius(n) ** 2, 0);
  const spread = Math.sqrt(total) * 1.1 + 60;
  const A = coords.map(([x, y], i) => {
    const ang = (i * 2.399963) % (Math.PI * 2); // 투영이 겹칠 때를 대비한 작은 흩뜨림 (황금각, 결정적)
    return { x: (x / maxAbs) * spread + Math.cos(ang) * 8, y: (y / maxAbs) * spread + Math.sin(ang) * 8, r: groupRadius(sizes[i]) };
  });
  for (let it = 0; it < 200; it++) {
    let moved = false;
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        let dx = A[j].x - A[i].x, dy = A[j].y - A[i].y;
        let d = Math.hypot(dx, dy);
        const need = A[i].r + A[j].r + gap;
        if (d >= need) continue;
        if (d < 1e-6) { dx = Math.cos(i + j); dy = Math.sin(i + j); d = 1; }
        const push = (need - d) / 2;
        A[i].x -= (dx / d) * push; A[i].y -= (dy / d) * push;
        A[j].x += (dx / d) * push; A[j].y += (dy / d) * push;
        moved = true;
      }
      const d0 = Math.hypot(A[i].x, A[i].y), need0 = A[i].r + centerClear; // 가운데(본문) 비우기
      if (d0 < need0) {
        const ux = d0 > 1e-6 ? A[i].x / d0 : Math.cos(i * 2.399963), uy = d0 > 1e-6 ? A[i].y / d0 : Math.sin(i * 2.399963);
        A[i].x = ux * need0; A[i].y = uy * need0; moved = true;
      }
    }
    if (!moved) break;
  }
  return A;
}

/**
 * @param init   [x,y][] 초기 좌표 (닻이 있으면 무시하고 닻 주위에 해바라기 모양으로 놓는다)
 * @param opts.pinned  원점에 고정할 점(본문)
 * @param opts.groups  점별 묶음 번호 (-1 = 없음)
 * @param opts.anchors 묶음별 {x, y, r}
 * @param opts.order   점별 '중심에 가까운 순서 점수'(클수록 중심) — 닻 주위에 놓을 때 중심부터 채운다
 * @param opts.keep    {x, y, pin} 이전 배치를 그대로 이어받는다
 * @param opts.keepPins {x, y, pin} 손으로 고정한 점만 이어받는다 (묶음이 바뀌어 다시 배치할 때)
 */
export function createLayout(init, edges, { pinned = [], keep = null, keepPins = null, groups = null, anchors = null, order = null, alpha = null, cohesion = 0 } = {}) {
  const n = init.length;
  const reuse = keep && keep.x.length === n;
  const x = new Float32Array(n), y = new Float32Array(n);
  const vx = new Float32Array(n), vy = new Float32Array(n);
  const pin = reuse ? Uint8Array.from(keep.pin) : new Uint8Array(n);
  const anch = anchors ? anchors.map((a) => ({ ...a })) : null;

  if (reuse) { x.set(keep.x); y.set(keep.y); }
  else if (anch && groups) {
    // 묶음별로 중심에 가까운 댓글부터 해바라기 나선으로
    const members = anch.map(() => []);
    for (let i = 0; i < n; i++) if (groups[i] >= 0 && anch[groups[i]]) members[groups[i]].push(i);
    members.forEach((list, g) => {
      if (order) list.sort((a, b) => order[b] - order[a] || a - b);
      const a = anch[g];
      list.forEach((i, t) => {
        const rad = a.r * 0.92 * Math.sqrt((t + 0.5) / list.length);
        const ang = t * 2.399963;
        x[i] = a.x + rad * Math.cos(ang); y[i] = a.y + rad * Math.sin(ang);
      });
    });
  } else {
    let maxAbs = 1e-9;
    for (const [px, py] of init) maxAbs = Math.max(maxAbs, Math.abs(px), Math.abs(py));
    const scale = (160 + 9 * Math.sqrt(n)) / maxAbs;
    for (let i = 0; i < n; i++) { x[i] = init[i][0] * scale; y[i] = init[i][1] * scale; }
  }
  if (!reuse && keepPins && keepPins.x.length === n) {
    for (let i = 0; i < n; i++) if (keepPins.pin[i]) { pin[i] = 1; x[i] = keepPins.x[i]; y[i] = keepPins.y[i]; }
  }
  for (const i of pinned) { pin[i] = 1; x[i] = 0; y[i] = 0; }

  const state = { x, y, pin, groups, anchors: anch, alpha: alpha ?? (reuse ? 0.3 : anch ? 0.6 : 1) };
  // 키워드로 옮긴 주제 → 놓은 자리(고정 안 된 점들의 중심). 다시 그릴 때 주제가 그대로면 이어받는다.
  const sameGroups = reuse && groups && keep.groups && keep.groups.length === n && groups.every((g, i) => g === keep.groups[i]);
  const held = new Map(sameGroups && keep.held ? keep.held : []);
  state.held = held;
  let dragging = -1;
  const topicAware = !!(cohesion && groups && !anch);
  const K = topicAware ? Math.max(-1, ...groups) + 1 : 0;
  // 이웃 선이 하나도 없는 묶음(짧은 반응)은 접촉 대상에서 뺀다 → 따로 놓인 자리를 지킨다
  const linked = new Uint8Array(K);
  if (topicAware) for (const e of edges) { if (groups[e.a] >= 0) linked[groups[e.a]] = 1; if (groups[e.b] >= 0) linked[groups[e.b]] = 1; }
  /** 주제별 [중심 x, 중심 y, 점 수, RMS 반경]. 손으로 고정한 점은 빼고 센다 (멀리 둔 점 하나로 주제 반경이 부풀지 않게) */
  const topicStats = () => {
    const c = new Float64Array(K * 4);
    for (let i = 0; i < n; i++) { const g = groups[i]; if (g < 0 || pin[i]) continue; c[g * 4] += x[i]; c[g * 4 + 1] += y[i]; c[g * 4 + 2]++; }
    for (let g = 0; g < K; g++) if (c[g * 4 + 2]) { c[g * 4] /= c[g * 4 + 2]; c[g * 4 + 1] /= c[g * 4 + 2]; }
    for (let i = 0; i < n; i++) { const g = groups[i]; if (g >= 0 && !pin[i]) c[g * 4 + 3] += (x[i] - c[g * 4]) ** 2 + (y[i] - c[g * 4 + 1]) ** 2; }
    for (let g = 0; g < K; g++) if (c[g * 4 + 2]) c[g * 4 + 3] = Math.sqrt(c[g * 4 + 3] / c[g * 4 + 2]);
    return c;
  };
  /** 고정 안 된 점들의 중심 (주제 g) */
  const centerOf = (g) => {
    let sx = 0, sy = 0, c = 0;
    for (let i = 0; i < n; i++) if (groups[i] === g && !pin[i]) { sx += x[i]; sy += y[i]; c++; }
    return c ? [sx / c, sy / c] : null;
  };
  const cell = anch ? CUTOFF : 70;

  function repulse(a) {
    const grid = new Map();
    for (let i = 0; i < n; i++) {
      const k = Math.floor(x[i] / cell) * 73856093 ^ Math.floor(y[i] / cell) * 19349663;
      let c = grid.get(k);
      if (!c) grid.set(k, (c = []));
      c.push(i);
    }
    const c2 = cell * cell;
    const strength = anch ? 9 : 70;
    for (let i = 0; i < n; i++) {
      const gx = Math.floor(x[i] / cell), gy = Math.floor(y[i] / cell);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const c = grid.get((gx + ox) * 73856093 ^ (gy + oy) * 19349663);
        if (!c) continue;
        for (const j of c) {
          if (j <= i) continue;
          let dx = x[j] - x[i], dy = y[j] - y[i];
          let d2 = dx * dx + dy * dy;
          if (d2 > c2) continue;
          if (d2 < 1) { dx = ((i * 7) % 5) - 2 || 1; dy = ((j * 3) % 5) - 2 || 1; d2 = dx * dx + dy * dy; }
          const f = (strength * a) / d2;
          vx[i] -= dx * f; vy[i] -= dy * f;
          vx[j] += dx * f; vy[j] += dy * f;
        }
      }
    }
  }

  state.tick = function () {
    const a = state.alpha;
    repulse(a);
    for (const { a: i, b: j, sim } of edges) {
      const dx = x[j] - x[i], dy = y[j] - y[i];
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const cross = topicAware && groups[i] !== groups[j];
      const target = (10 + 50 * (1 - sim)) * (cross ? CROSS_LEN : 1);
      const f = ((d - target) / d) * (anch ? 0.03 : 0.08) * a * Math.max(sim, 0.2) * (cross ? CROSS_PULL : 1);
      vx[i] += dx * f; vy[i] += dy * f;
      vx[j] -= dx * f; vy[j] -= dy * f;
    }
    const cen = topicAware ? topicStats() : null;
    // 주제 중심끼리 겹치면 통째로 민다 (작은 주제가 더 비킨다). 점 사이 선은 그대로라 이어진 채로 벌어진다.
    const shift = new Float64Array(K * 2);
    for (let p = 0; p < K; p++) for (let q = p + 1; q < K; q++) {
      const sp = cen[p * 4 + 2], sq = cen[q * 4 + 2];
      if (sp < 3 || sq < 3) continue;
      const dx = cen[q * 4] - cen[p * 4], dy = cen[q * 4 + 1] - cen[p * 4 + 1], d = Math.hypot(dx, dy) || 1;
      const need = (cen[p * 4 + 3] + cen[q * 4 + 3]) * TOPIC_GAP;
      if (d >= need) continue;
      const push = (need - d) * TOPIC_PUSH * a;
      shift[p * 2] -= (dx / d) * push * (sq / (sp + sq)); shift[p * 2 + 1] -= (dy / d) * push * (sq / (sp + sq));
      shift[q * 2] += (dx / d) * push * (sp / (sp + sq)); shift[q * 2 + 1] += (dy / d) * push * (sp / (sp + sq));
    }
    // 접촉: 서로 닿은 주제끼리 무리를 짓고(닿음 = 겹침 기준 안), 무리가 둘 이상이면 무리마다 다른 무리의 가장 가까운 주제 쪽으로
    // 무리를 통째로 당긴다. 주제 하나가 떨어진 경우도, 서로만 닿은 주제 무리(A–B, C–D)도 섬이 되지 않는다.
    // 끄는 주제와 손으로 옮겨 둔 주제는 뺀다: 사용자가 떼어 놓은 자리이므로 당기지도, 당김의 목표가 되지도 않는다
    // (넣으면 나머지 무리 전체가 옮긴 주제를 쫓아간다)
    const live = [];
    for (let g = 0; g < K; g++) if (linked[g] && cen[g * 4 + 2] >= 3 && g !== dragging && !held.has(g)) live.push(g);
    const slackOf = (g, h) => Math.hypot(cen[h * 4] - cen[g * 4], cen[h * 4 + 1] - cen[g * 4 + 1]) - (cen[g * 4 + 3] + cen[h * 4 + 3]) * TOPIC_GAP;
    const root = new Int32Array(K).map((_, g) => g);
    const find = (g) => { while (root[g] !== g) g = root[g] = root[root[g]]; return g; };
    for (let p = 0; p < live.length; p++) for (let q = p + 1; q < live.length; q++) if (slackOf(live[p], live[q]) <= 0) root[find(live[p])] = find(live[q]);
    const comps = new Map();
    for (const g of live) { const r = find(g); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(g); }
    if (comps.size > 1) {
      for (const members of comps.values()) {
        let slack = Infinity, from = -1, to = -1;
        for (const g of members) for (const h of live) {
          if (find(h) === find(g)) continue;
          const sl = slackOf(g, h);
          if (sl < slack) { slack = sl; from = g; to = h; }
        }
        if (to < 0) continue;
        const dx = cen[to * 4] - cen[from * 4], dy = cen[to * 4 + 1] - cen[from * 4 + 1], d = Math.hypot(dx, dy) || 1;
        const mx = (dx / d) * slack * TOPIC_CONTACT * a, my = (dy / d) * slack * TOPIC_CONTACT * a;
        for (const g of members) { shift[g * 2] += mx; shift[g * 2 + 1] += my; }
      }
    }
    for (let i = 0; i < n; i++) {
      if (pin[i]) { vx[i] = vy[i] = 0; continue; }
      const g = state.groups ? state.groups[i] : -1;
      if (g >= 0 && g === dragging) { vx[i] = vy[i] = 0; continue; } // 끄는 주제는 커서만 따른다
      const an = anch && g >= 0 ? anch[g] : null;
      if (an) {
        // 닻으로 끌림: 섬 안에서는 약하게, 섬 밖으로 나가면 세게
        const dx = an.x - x[i], dy = an.y - y[i];
        const d = Math.sqrt(dx * dx + dy * dy);
        const pull = d > an.r ? 0.2 : 0.02;
        vx[i] += dx * pull * a; vy[i] += dy * pull * a;
      } else {
        vx[i] -= x[i] * 0.003 * a;
        vy[i] -= y[i] * 0.003 * a;
        if (cen && g >= 0 && cen[g * 4 + 2] >= 3) { // 같은 주제끼리 모인다 (옵시디언 그래프처럼 이어진 채로)
          vx[i] += (cen[g * 4] - x[i]) * cohesion * a + shift[g * 2];
          vy[i] += (cen[g * 4 + 1] - y[i]) * cohesion * a + shift[g * 2 + 1];
        }
      }
      x[i] += vx[i]; y[i] += vy[i];
      vx[i] *= 0.6; vy[i] *= 0.6;
    }
    for (const [g, [hx, hy]] of held) { // 옮겨 둔 주제는 모양만 다듬고 중심은 놓은 자리에 둔다
      if (g === dragging) continue;
      const c = centerOf(g);
      if (!c) continue;
      const dx = hx - c[0], dy = hy - c[1];
      for (let i = 0; i < n; i++) if (groups[i] === g && !pin[i]) { x[i] += dx; y[i] += dy; }
    }
    state.alpha *= topicAware ? (state.alpha > TAIL_FROM ? TOPIC_DECAY : TAIL_DECAY) : 0.97;
    return state.alpha > 0.02;
  };

  // 옮겨 둔 주제 안의 점을 고정하거나 풀면 '고정 안 된 점들의 중심'이 바뀐다 → 놓은 자리를 지금 중심으로 다시 잡아 주제가 튀지 않게
  const rebase = (i) => { const g = groups ? groups[i] : -1; if (g >= 0 && held.has(g)) { const c = centerOf(g); if (c) held.set(g, c); } };
  state.fix = (i, px, py) => { const was = pin[i]; pin[i] = 1; x[i] = px; y[i] = py; vx[i] = vy[i] = 0; if (!was) rebase(i); };
  state.release = (i) => { if (!pin[i]) return; pin[i] = 0; rebase(i); };
  state.reheat = (a = 0.3) => { state.alpha = Math.max(state.alpha, a); };
  /** 묶음 통째로 옮기기 (키워드를 끌 때): 닻과 그 묶음의 모든 점이 함께 움직인다 */
  state.moveGroup = (g, dx, dy) => {
    const gs = state.groups;
    if (!gs) return;
    if (anch && anch[g]) { anch[g].x += dx; anch[g].y += dy; }
    for (let i = 0; i < n; i++) if (gs[i] === g) { x[i] += dx; y[i] += dy; }
    if (!anch) {
      dragging = g;
      const c = centerOf(g);
      if (c) held.set(g, c);
      state.alpha = Math.max(state.alpha, 0.12); // 이웃 주제가 자리를 비켜 주도록 살짝 다시 움직인다
    }
  };
  /** 키워드 끌기를 마칠 때: 그 주제도 다시 힘 계산을 받되 중심은 놓은 자리에 머문다 */
  state.endGroupDrag = () => { dragging = -1; };
  /** 옮겨 둔 주제를 모두 풀기 ('고정 풀기') */
  state.releaseGroups = () => { held.clear(); dragging = -1; };
  return state;
}

/**
 * 고정 배치 (UMAP 좌표를 그대로 쓰는 댓글 지도용). 힘 계산을 하지 않아 가볍다.
 * 손으로 옮긴 점·주제는 pin 으로 표시하고, release 하면 원래 자리로 돌아간다.
 */
export function createStaticLayout(x0, y0, groups) {
  const n = x0.length;
  const x = Float32Array.from(x0), y = Float32Array.from(y0);
  const pin = new Uint8Array(n);
  const state = { x, y, pin, groups, anchors: null, alpha: 0 };
  state.tick = () => false;
  state.fix = (i, px, py) => { pin[i] = 1; x[i] = px; y[i] = py; };
  state.release = (i) => { pin[i] = 0; x[i] = x0[i]; y[i] = y0[i]; };
  state.reheat = () => {};
  state.moveGroup = (g, dx, dy) => {
    for (let i = 0; i < n; i++) if (state.groups[i] === g) { x[i] += dx; y[i] += dy; pin[i] = 1; }
  };
  /** 다른 탭에서 넘겨받은 위치 적용 */
  state.restore = (pos) => {
    if (!pos || pos.x.length !== n) return;
    x.set(pos.x); y.set(pos.y); pin.set(pos.pin);
  };
  return state;
}
