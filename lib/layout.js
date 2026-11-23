// force-directed 레이아웃 (옵시디언 그래프 뷰 느낌). PCA 좌표로 초기화해 수렴이 빠르다.
// - 반발력은 격자(spatial grid)로 가까운 노드끼리만 계산 → 수천 개 노드도 실시간
// - 고정(pin): 사용자가 손으로 옮긴 노드는 그 자리에 머문다. 다른 노드는 계속 반응한다.

const CUTOFF = 160; // 이 거리 밖의 반발력은 무시

/**
 * @param init   [x,y][] 초기 좌표
 * @param opts.pinned  원점에 고정할 노드(본문)
 * @param opts.keep    {x, y, pin} 이전 레이아웃 — 주면 좌표·고정 상태를 그대로 이어받는다 (기준값만 바꿀 때 손으로 옮긴 배치 유지)
 */
export function createLayout(init, edges, { pinned = [], keep = null } = {}) {
  const n = init.length;
  let maxAbs = 1e-9;
  for (const [x, y] of init) maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(y));
  const scale = (120 + 6 * Math.sqrt(n)) / maxAbs; // 노드가 많을수록 넓게
  const reuse = keep && keep.x.length === n;
  const x = reuse ? Float32Array.from(keep.x) : Float32Array.from(init, (p) => p[0] * scale);
  const y = reuse ? Float32Array.from(keep.y) : Float32Array.from(init, (p) => p[1] * scale);
  const vx = new Float32Array(n), vy = new Float32Array(n);
  const pin = reuse ? Uint8Array.from(keep.pin) : new Uint8Array(n);
  for (const i of pinned) { pin[i] = 1; x[i] = 0; y[i] = 0; }

  const state = { x, y, pin, alpha: reuse ? 0.5 : 1 };

  function repulse(a) {
    const grid = new Map();
    const key = (gx, gy) => gx * 73856093 ^ gy * 19349663;
    for (let i = 0; i < n; i++) {
      const k = key(Math.floor(x[i] / CUTOFF), Math.floor(y[i] / CUTOFF));
      let cell = grid.get(k);
      if (!cell) grid.set(k, (cell = []));
      cell.push(i);
    }
    const c2 = CUTOFF * CUTOFF;
    for (let i = 0; i < n; i++) {
      const gx = Math.floor(x[i] / CUTOFF), gy = Math.floor(y[i] / CUTOFF);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const cell = grid.get(key(gx + ox, gy + oy));
        if (!cell) continue;
        for (const j of cell) {
          if (j <= i) continue;
          let dx = x[j] - x[i], dy = y[j] - y[i];
          let d2 = dx * dx + dy * dy;
          if (d2 > c2) continue;
          if (d2 < 1) { dx = ((i * 7) % 5) - 2 || 1; dy = ((j * 3) % 5) - 2 || 1; d2 = dx * dx + dy * dy; }
          const f = (40 * a) / d2;
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
      const f = ((d - target) / d) * 0.08 * a * Math.max(sim, 0.2);
      vx[i] += dx * f; vy[i] += dy * f;
      vx[j] -= dx * f; vy[j] -= dy * f;
    }
    for (let i = 0; i < n; i++) {
      if (pin[i]) { vx[i] = vy[i] = 0; continue; }
      vx[i] -= x[i] * 0.003 * a;
      vy[i] -= y[i] * 0.003 * a;
      x[i] += vx[i]; y[i] += vy[i];
      vx[i] *= 0.6; vy[i] *= 0.6;
    }
    state.alpha *= 0.985;
    return state.alpha > 0.02;
  };

  /** 노드를 (px,py)에 고정 */
  state.fix = (i, px, py) => { pin[i] = 1; x[i] = px; y[i] = py; vx[i] = vy[i] = 0; };
  state.release = (i) => { pin[i] = 0; };
  state.reheat = (a = 0.3) => { state.alpha = Math.max(state.alpha, a); };

  return state;
}
