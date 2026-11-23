// 캔버스 그래프 (옵시디언 그래프 뷰처럼 손으로 배치·분류)
// 조작
//   빈 곳 드래그: 화면 이동 · 휠: 확대/축소
//   점 드래그: 옮기고 그 자리에 고정(이웃은 따라 움직임) · 선택된 점을 끌면 선택 전체 이동
//   Shift+드래그(빈 곳): 영역 선택 · Shift+클릭: 선택 추가/해제 · Esc: 선택 해제
//   1~4: 선택한 점에 분류 지정 · 0: 분류 지우기 · 더블클릭: 고정 해제
//   점 클릭: onClick 콜백 (페이지의 해당 댓글로 이동)

export const PALETTE = ["#4c6ef5", "#e8590c", "#2f9e44", "#ae3ec9", "#1098ad", "#f08c00", "#d6336c", "#5c940d", "#7048e8", "#0c8599"];
export const TAG_COLORS = ["#f03e3e", "#1c7ed6", "#37b24d", "#f59f00"];

export function createGraph(canvas, tooltip, { onClick, onTagsChange, onSelectionChange } = {}) {
  const ctx = canvas.getContext("2d");
  canvas.tabIndex = 0;
  let data = null; // { layout, edges, nodes:[{label, sub, cluster, likes, kind, flag}], focus }
  let view = { k: 1, tx: 0, ty: 0 };
  let hover = -1, drag = null, raf = 0;
  let selection = new Set();
  let tags = new Int8Array(0); // -1 = 없음, 0..3

  const rect = () => canvas.getBoundingClientRect();
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = rect();
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  const radius = (nd) => (nd.kind === "doc" ? 9 : 2.5 + Math.min(6, Math.log10((nd.likes || 0) + 1) * 2));
  const color = (nd) => (nd.kind === "doc" ? css("--fg") : nd.cluster >= 0 ? PALETTE[nd.cluster % PALETTE.length] : css("--muted"));
  function toScreen(i) {
    const { width, height } = rect();
    return [data.layout.x[i] * view.k + width / 2 + view.tx, data.layout.y[i] * view.k + height / 2 + view.ty];
  }
  function toWorld(sx, sy) {
    const { width, height } = rect();
    return [(sx - width / 2 - view.tx) / view.k, (sy - height / 2 - view.ty) / view.k];
  }

  function draw() {
    const { width, height } = rect();
    ctx.clearRect(0, 0, width, height);
    if (!data) return;
    const { edges, nodes, layout } = data;
    const focus = data.focus || null;
    const edgeColor = css("--edge"), warn = css("--warn"), accent = css("--accent"), fg = css("--fg");

    ctx.lineWidth = 1;
    ctx.strokeStyle = edgeColor;
    for (const e of edges) {
      const [x1, y1] = toScreen(e.a), [x2, y2] = toScreen(e.b);
      const dim = focus && !(focus.has(e.a) && focus.has(e.b));
      ctx.globalAlpha = dim ? 0.04 : 0.12 + 0.5 * Math.max(0, e.sim - 0.4);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    const rk = Math.sqrt(view.k);
    for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i];
      const [x, y] = toScreen(i);
      if (x < -20 || y < -20 || x > width + 20 || y > height + 20) continue;
      const dim = focus && !focus.has(i) && nd.kind !== "doc";
      ctx.globalAlpha = dim ? 0.1 : 1;
      const r = radius(nd) * rk;
      ctx.fillStyle = color(nd);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      if (nd.flag) { ctx.strokeStyle = warn; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, Math.PI * 2); ctx.stroke(); }
      if (tags[i] >= 0) { ctx.strokeStyle = TAG_COLORS[tags[i]]; ctx.lineWidth = 2; ctx.strokeRect(x - r - 4, y - r - 4, 2 * r + 8, 2 * r + 8); }
      if (layout.pin[i] && nd.kind !== "doc") { ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(x + r * 0.8, y - r * 0.8, 1.8, 0, Math.PI * 2); ctx.fill(); }
      if (selection.has(i) || i === hover || nd.kind === "doc") {
        ctx.strokeStyle = accent; ctx.lineWidth = selection.has(i) ? 2.5 : 1.5;
        ctx.beginPath(); ctx.arc(x, y, r + 1, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.lineWidth = 1;
    }
    ctx.globalAlpha = 1;
    if (drag?.type === "box") {
      ctx.strokeStyle = accent; ctx.setLineDash([4, 3]);
      ctx.strokeRect(drag.x0, drag.y0, drag.x - drag.x0, drag.y - drag.y0);
      ctx.setLineDash([]);
    }
  }

  function animate() {
    if (raf) return;
    const loop = () => {
      let running = true;
      for (let s = 0; s < 2 && running; s++) running = data.layout.tick();
      draw();
      raf = running || drag?.type === "node" ? requestAnimationFrame(loop) : 0;
    };
    raf = requestAnimationFrame(loop);
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

  function showTooltip(i, mx, my) {
    if (i < 0) { tooltip.hidden = true; return; }
    const nd = data.nodes[i];
    tooltip.hidden = false;
    tooltip.replaceChildren();
    const t = document.createElement("div"); t.textContent = nd.label;
    const s = document.createElement("div"); s.className = "sub"; s.textContent = nd.sub;
    tooltip.append(t, s);
    const r = rect();
    tooltip.style.left = `${Math.max(4, Math.min(mx + 12, r.width - tooltip.offsetWidth - 4))}px`;
    tooltip.style.top = `${Math.min(my + 14, r.height - tooltip.offsetHeight - 4)}px`;
  }

  const emitSelection = () => onSelectionChange?.(selection.size);

  canvas.addEventListener("mousedown", (ev) => {
    if (!data) return;
    canvas.focus();
    const r = rect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const i = pick(mx, my);
    if (i >= 0 && data.nodes[i].kind !== "doc") {
      if (ev.shiftKey) {
        selection.has(i) ? selection.delete(i) : selection.add(i);
        emitSelection(); draw();
        drag = { type: "none" };
        return;
      }
      const group = selection.has(i) ? [...selection] : [i];
      const [wx, wy] = toWorld(mx, my);
      drag = { type: "node", i, group, wx, wy, start: group.map((j) => [data.layout.x[j], data.layout.y[j]]), moved: false };
    } else if (ev.shiftKey) {
      drag = { type: "box", x0: mx, y0: my, x: mx, y: my };
    } else {
      drag = { type: "pan", x: mx, y: my, moved: false, hit: i };
    }
  });

  canvas.addEventListener("mousemove", (ev) => {
    if (!data) return;
    const r = rect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    if (drag?.type === "node") {
      const [wx, wy] = toWorld(mx, my);
      const dx = wx - drag.wx, dy = wy - drag.wy;
      if (!drag.moved && dx * dx + dy * dy < 4 / view.k) return;
      drag.moved = true;
      drag.group.forEach((j, k) => data.layout.fix(j, drag.start[k][0] + dx, drag.start[k][1] + dy));
      data.layout.reheat(0.25);
      animate();
      tooltip.hidden = true;
      return;
    }
    if (drag?.type === "box") { drag.x = mx; drag.y = my; draw(); return; }
    if (drag?.type === "pan") {
      view.tx += mx - drag.x; view.ty += my - drag.y;
      if (Math.abs(mx - drag.x) + Math.abs(my - drag.y) > 1) drag.moved = true;
      drag.x = mx; drag.y = my;
      draw(); return;
    }
    const h = pick(mx, my);
    if (h !== hover) { hover = h; draw(); }
    showTooltip(h, mx, my);
  });

  window.addEventListener("mouseup", () => {
    if (!drag || !data) { drag = null; return; }
    if (drag.type === "node" && !drag.moved) onClick?.(drag.i);
    if (drag.type === "pan" && !drag.moved && drag.hit === 0) onClick?.(0);
    if (drag.type === "box") {
      const [x0, x1] = [Math.min(drag.x0, drag.x), Math.max(drag.x0, drag.x)];
      const [y0, y1] = [Math.min(drag.y0, drag.y), Math.max(drag.y0, drag.y)];
      data.nodes.forEach((nd, i) => {
        if (nd.kind === "doc") return;
        const [x, y] = toScreen(i);
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) selection.add(i);
      });
      emitSelection();
    }
    drag = null;
    draw();
  });

  canvas.addEventListener("dblclick", (ev) => {
    if (!data) return;
    const r = rect();
    const i = pick(ev.clientX - r.left, ev.clientY - r.top);
    if (i > 0) { data.layout.release(i); data.layout.reheat(0.3); animate(); }
  });

  canvas.addEventListener("mouseleave", () => { hover = -1; tooltip.hidden = true; draw(); });

  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const r = rect();
    const mx = ev.clientX - r.left - r.width / 2, my = ev.clientY - r.top - r.height / 2;
    const f = Math.exp(-ev.deltaY * 0.0015);
    view.tx = mx - (mx - view.tx) * f;
    view.ty = my - (my - view.ty) * f;
    view.k *= f;
    draw();
  }, { passive: false });

  canvas.addEventListener("keydown", (ev) => {
    if (!data) return;
    if (ev.key === "Escape") { selection.clear(); emitSelection(); draw(); return; }
    if (/^[0-4]$/.test(ev.key) && selection.size) {
      api.tagSelection(ev.key === "0" ? -1 : Number(ev.key) - 1);
      ev.preventDefault();
    }
  });

  new ResizeObserver(resize).observe(canvas);

  const api = {
    set(next) {
      cancelAnimationFrame(raf); raf = 0;
      data = next;
      view = { k: 1, tx: 0, ty: 0 };
      hover = -1;
      selection = new Set();
      tags = new Int8Array(next.nodes.length).fill(-1);
      emitSelection();
      onTagsChange?.(api.tagCounts());
      animate();
    },
    focus(nodeSet) { if (data) { data.focus = nodeSet; draw(); } },
    select(nodeSet) { selection = new Set(nodeSet); emitSelection(); draw(); },
    tagSelection(tag) {
      for (const i of selection) tags[i] = tag;
      onTagsChange?.(api.tagCounts());
      draw();
    },
    tagCounts() {
      const c = [0, 0, 0, 0];
      for (const t of tags) if (t >= 0) c[t]++;
      return c;
    },
    tagged(tag) { const s = []; tags.forEach((t, i) => t === tag && s.push(i)); return s; },
    tagsArray: () => tags,
    unpinAll() {
      if (!data) return;
      for (let i = 1; i < data.nodes.length; i++) data.layout.release(i);
      data.layout.reheat(0.6); animate();
    },
    clearSelection() { selection.clear(); emitSelection(); draw(); },
    palette: PALETTE,
  };
  return api;
}
