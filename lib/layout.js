// 지도 배치.
// - 묶음(주제)마다 '닻'을 두고, 닻끼리는 겹치지 않게 떨어뜨린다 → 주제가 섬처럼 갈라져 보인다.
// - 점은 자기 닻 쪽으로 끌리고, 가까운 점끼리는 밀어낸다(격자로 가까운 점만 계산 → 수천 개도 실시간).
// - 닻을 옮기면(키워드 끌기) 그 묶음의 점이 모두 함께 움직인다. 손으로 옮긴 점은 고정된다.
// - 닻이 없으면(작성자 지도) 예전처럼 이웃 간선과 중심 인력으로 배치한다.

const CUTOFF = 36;

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
      const target = 10 + 50 * (1 - sim);
      const f = ((d - target) / d) * (anch ? 0.03 : 0.08) * a * Math.max(sim, 0.2);
      vx[i] += dx * f; vy[i] += dy * f;
      vx[j] -= dx * f; vy[j] -= dy * f;
    }
    let cen = null;
    if (cohesion && groups && !anch) {
      cen = [];
      for (let i = 0; i < n; i++) { const g = groups[i]; if (g < 0) continue; const c = cen[g] || (cen[g] = [0, 0, 0]); c[0] += x[i]; c[1] += y[i]; c[2]++; }
    }
    for (let i = 0; i < n; i++) {
      if (pin[i]) { vx[i] = vy[i] = 0; continue; }
      const g = state.groups ? state.groups[i] : -1;
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
        if (cohesion && cen && g >= 0 && cen[g] && cen[g][2] >= 3) { // 같은 주제끼리 약하게 모인다 (옵시디언 그래프처럼 이어진 채로)
          vx[i] += (cen[g][0] / cen[g][2] - x[i]) * cohesion * a;
          vy[i] += (cen[g][1] / cen[g][2] - y[i]) * cohesion * a;
        }
      }
      x[i] += vx[i]; y[i] += vy[i];
      vx[i] *= 0.6; vy[i] *= 0.6;
    }
    state.alpha *= 0.97;
    return state.alpha > 0.02;
  };

  state.fix = (i, px, py) => { pin[i] = 1; x[i] = px; y[i] = py; vx[i] = vy[i] = 0; };
  state.release = (i) => { pin[i] = 0; };
  state.reheat = (a = 0.3) => { state.alpha = Math.max(state.alpha, a); };
  /** 묶음 통째로 옮기기 (키워드를 끌 때): 닻과 그 묶음의 모든 점이 함께 움직인다 */
  state.moveGroup = (g, dx, dy) => {
    const gs = state.groups;
    if (!gs) return;
    if (anch && anch[g]) { anch[g].x += dx; anch[g].y += dy; }
    for (let i = 0; i < n; i++) if (gs[i] === g) { x[i] += dx; y[i] += dy; }
    if (!anch) state.alpha = Math.max(state.alpha, 0.12); // 이웃 주제가 자리를 비켜 주도록 살짝 다시 움직인다
  };
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
