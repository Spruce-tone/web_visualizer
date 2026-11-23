// 간단한 force-directed 레이아웃 (옵시디언 그래프 뷰 느낌). PCA 좌표로 초기화해 수렴이 빠르다.
// 노드 수 n≈1000까지 O(n²) 반발력으로 충분.

export function createLayout(init, edges, { pinned = [] } = {}) {
  const n = init.length;
  // PCA 좌표를 [-200,200] 범위로 스케일
  let maxAbs = 1e-9;
  for (const [x, y] of init) maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(y));
  const s = 200 / maxAbs;
  const x = Float32Array.from(init, (p) => p[0] * s);
  const y = Float32Array.from(init, (p) => p[1] * s);
  const vx = new Float32Array(n), vy = new Float32Array(n);
  const pin = new Uint8Array(n);
  for (const i of pinned) { pin[i] = 1; x[i] = 0; y[i] = 0; }

  const state = { x, y, alpha: 1 };

  state.tick = function () {
    const a = state.alpha;
    // 반발력
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = x[j] - x[i], dy = y[j] - y[i];
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = (i % 7) - 3 || 1; dy = (j % 5) - 2 || 1; d2 = dx * dx + dy * dy; }
        if (d2 > 90000) continue; // 300px 밖은 무시
        const f = (60 * a) / d2;
        vx[i] -= dx * f; vy[i] -= dy * f;
        vx[j] += dx * f; vy[j] += dy * f;
      }
    }
    // 스프링 (유사할수록 짧게)
    for (const { a: i, b: j, sim } of edges) {
      const dx = x[j] - x[i], dy = y[j] - y[i];
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const target = 8 + 50 * (1 - sim);
      const f = ((d - target) / d) * 0.1 * a * Math.max(sim, 0.2);
      vx[i] += dx * f; vy[i] += dy * f;
      vx[j] -= dx * f; vy[j] -= dy * f;
    }
    // 중심 인력 + 적용
    for (let i = 0; i < n; i++) {
      if (pin[i]) { vx[i] = vy[i] = 0; continue; }
      vx[i] -= x[i] * 0.004 * a;
      vy[i] -= y[i] * 0.004 * a;
      x[i] += vx[i]; y[i] += vy[i];
      vx[i] *= 0.6; vy[i] *= 0.6;
    }
    state.alpha *= 0.985;
    return state.alpha > 0.02;
  };

  return state;
}
