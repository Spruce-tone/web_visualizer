// 캔버스 그래프 렌더러: 팬(드래그), 줌(휠), 호버 툴팁, 클릭 콜백

const PALETTE = ["#4c6ef5", "#e8590c", "#2f9e44", "#ae3ec9", "#1098ad", "#f08c00", "#d6336c", "#5c940d", "#7048e8", "#0c8599"];

export function createGraph(canvas, tooltip, { onClick } = {}) {
  const ctx = canvas.getContext("2d");
  let data = null; // { layout, edges, nodes:[{label, sub, cluster, likes, kind, highlight}] }
  let view = { k: 1, tx: 0, ty: 0 };
  let hover = -1, dragging = null, raf = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function radius(nd) {
    if (nd.kind === "doc") return 9;
    return 2.5 + Math.min(6, Math.log10((nd.likes || 0) + 1) * 2);
  }
  function color(nd) {
    if (nd.kind === "doc") return css("--fg");
    return nd.cluster >= 0 ? PALETTE[nd.cluster % PALETTE.length] : css("--muted");
  }
  function toScreen(i) {
    const { width, height } = canvas.getBoundingClientRect();
    return [data.layout.x[i] * view.k + width / 2 + view.tx, data.layout.y[i] * view.k + height / 2 + view.ty];
  }

  function draw() {
    const { width, height } = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, width, height);
    if (!data) return;
    const { edges, nodes } = data;
    const focus = data.focus || null; // Set<nodeIndex> | null

    ctx.lineWidth = 1;
    for (const e of edges) {
      const [x1, y1] = toScreen(e.a), [x2, y2] = toScreen(e.b);
      const dim = focus && !(focus.has(e.a) && focus.has(e.b));
      ctx.strokeStyle = css("--edge");
      ctx.globalAlpha = dim ? 0.05 : 0.15 + 0.6 * Math.max(0, e.sim - 0.4);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    nodes.forEach((nd, i) => {
      const [x, y] = toScreen(i);
      const dim = focus && !focus.has(i) && nd.kind !== "doc";
      ctx.globalAlpha = dim ? 0.12 : 1;
      ctx.fillStyle = color(nd);
      const r = radius(nd) * Math.sqrt(view.k);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      if (nd.flag) { // 복붙 의심 신호가 높은 묶음의 댓글
        ctx.strokeStyle = css("--warn"); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1;
      }
      if (i === hover || nd.kind === "doc") {
        ctx.strokeStyle = css("--accent"); ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
      }
    });
    ctx.globalAlpha = 1;
  }

  function pick(mx, my) {
    if (!data) return -1;
    let best = -1, bestD = 100;
    for (let i = 0; i < data.nodes.length; i++) {
      const [x, y] = toScreen(i);
      const d = (x - mx) ** 2 + (y - my) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  canvas.addEventListener("mousemove", (ev) => {
    const r = canvas.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    if (dragging) {
      view.tx += mx - dragging.x; view.ty += my - dragging.y;
      dragging = { x: mx, y: my, moved: true };
      draw(); return;
    }
    const h = pick(mx, my);
    if (h !== hover) { hover = h; draw(); }
    if (h >= 0) {
      const nd = data.nodes[h];
      tooltip.hidden = false;
      tooltip.innerHTML = "";
      const t = document.createElement("div"); t.textContent = nd.label;
      const s = document.createElement("div"); s.className = "sub"; s.textContent = nd.sub;
      tooltip.append(t, s);
      const tx = Math.min(mx + 12, r.width - tooltip.offsetWidth - 4);
      tooltip.style.left = `${Math.max(4, tx)}px`;
      tooltip.style.top = `${my + 14}px`;
    } else tooltip.hidden = true;
  });
  canvas.addEventListener("mousedown", (ev) => {
    const r = canvas.getBoundingClientRect();
    dragging = { x: ev.clientX - r.left, y: ev.clientY - r.top, moved: false };
  });
  window.addEventListener("mouseup", () => {
    if (dragging && !dragging.moved && hover >= 0) onClick?.(hover);
    dragging = null;
  });
  canvas.addEventListener("mouseleave", () => { hover = -1; tooltip.hidden = true; draw(); });
  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const r = canvas.getBoundingClientRect();
    const mx = ev.clientX - r.left - r.width / 2, my = ev.clientY - r.top - r.height / 2;
    const f = Math.exp(-ev.deltaY * 0.0015);
    view.tx = mx - (mx - view.tx) * f;
    view.ty = my - (my - view.ty) * f;
    view.k *= f;
    draw();
  }, { passive: false });
  new ResizeObserver(resize).observe(canvas);

  return {
    set(next) {
      cancelAnimationFrame(raf);
      data = next;
      view = { k: 1, tx: 0, ty: 0 };
      hover = -1;
      const loop = () => {
        let running = true;
        for (let s = 0; s < 3 && running; s++) running = data.layout.tick();
        draw();
        if (running) raf = requestAnimationFrame(loop);
      };
      loop();
    },
    /** @param {Set<number>|null} nodeSet 강조할 노드 인덱스 */
    focus(nodeSet) { if (data) { data.focus = nodeSet; draw(); } },
    redraw: draw,
    palette: PALETTE,
  };
}
