// 캔버스 지도 — 댓글(또는 작성자)을 점으로 찍는다. 밝은 배경이 기본, 어둡게 전환 가능 (옵시디언 그래프 뷰처럼 손으로 배치·분류)
// 조작
//   빈 곳 드래그: 화면 이동 · 휠: 확대/축소
//   점 클릭: 그 댓글 선택(onPick) · 점 드래그: 옮기고 그 자리에 고정(이웃은 따라 움직임)
//   Shift+드래그(빈 곳): 영역 선택 · Shift+클릭: 선택 추가/해제 · Esc: 선택 해제
//   숫자키 1~9: 선택한 점을 분류에 넣기 · 0: 분류 빼기 · 더블클릭: 고정 해제

// 밝은 지도가 기본. 색은 밝은 배경에서 또렷하게 보이는 진한 색
const PALETTES = {
  light: ["#3B5BDB", "#E8590C", "#2B8A3E", "#9C36B5", "#0B7285", "#B8860B", "#C2255C", "#5C7A0D", "#6741D9", "#1864AB"],
  dark: ["#7C9CFF", "#FF9F5A", "#5BD68A", "#D08CFF", "#4FD1D9", "#FFC94A", "#FF7FA8", "#A6D34B", "#9E8CFF", "#59B8E8"],
};
const THEMES = {
  light: { reply: "150,95,10", edge: "70,90,130", lone: "#8D98AB", doc: "#18202F", flag: "#D9480F", ink: "#18202F", halo: "rgba(255,255,255,.92)", select: "#18202F", edgeBase: 0.16 },
  dark: { reply: "255,200,120", edge: "150,170,215", lone: "#56627A", doc: "#FFFFFF", flag: "#FF8A3D", ink: "#E8EDF7", halo: "rgba(10,15,28,.82)", select: "#FFFFFF", edgeBase: 0.1 },
};
export const TOPIC_COLORS = PALETTES.light; // 목록·배지에서 쓰는 주제 색 (지도와 같은 순서)
export const TAG_COLORS = ["#FF5A5F", "#3DA5FF", "#3ED598", "#FFB020", "#C77DFF", "#00C2C7", "#FF8FB1", "#B4D335", "#F06FD5"];
let MAP = THEMES.light;
let PAL = PALETTES.light;

export function createGraph(canvas, tooltip, { onPick, onTagsChange, onSelectionChange } = {}) {
  const ctx = canvas.getContext("2d");
  canvas.tabIndex = 0;
  let data = null; // { layout, edges, nodes:[{label, sub, cluster, likes, kind, flag}], focus, labels:[{cluster, text}] }
  let view = { k: 1, tx: 0, ty: 0 };
  let hover = -1, drag = null, raf = 0;
  let selection = new Set();
  let tags = new Int8Array(0); // -1 = 없음
  let tagCount = 4;
  let showLabels = true;
  let showReplyLinks = true;
  let filter = "all"; // all | top(댓글만) | reply(답글만)

  const rect = () => canvas.getBoundingClientRect();

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = rect();
    canvas.width = Math.max(1, width * dpr);
    canvas.height = Math.max(1, height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  // 크기: weight(0~1, 그 영상 안에서의 상대적 좋아요·댓글 수)에 따라 3 ~ 17px. 차이가 눈에 띄게 1.4제곱
  const radius = (nd) => (nd.kind === "doc" ? 9 : 3 + 14 * Math.pow(nd.weight || 0, 1.4));
  const color = (nd) => (nd.kind === "doc" ? MAP.doc : nd.tint ? nd.tint[MAP === THEMES.dark ? 1 : 0] : nd.cluster >= 0 ? PAL[nd.cluster % PAL.length] : MAP.lone);
  function toScreen(i) {
    const { width, height } = rect();
    return [data.layout.x[i] * view.k + width / 2 + view.tx, data.layout.y[i] * view.k + height / 2 + view.ty];
  }
  function toWorld(sx, sy) {
    const { width, height } = rect();
    return [(sx - width / 2 - view.tx) / view.k, (sy - height / 2 - view.ty) / view.k];
  }

  function drawLabels(width, height) {
    if (!showLabels || !data.labels?.length) return;
    const sum = new Map();
    data.nodes.forEach((nd, i) => {
      if (nd.cluster < 0) return;
      let s = sum.get(nd.cluster);
      if (!s) sum.set(nd.cluster, (s = [0, 0, 0]));
      s[0] += data.layout.x[i]; s[1] += data.layout.y[i]; s[2]++;
    });
    ctx.font = "650 12.5px Pretendard, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const { cluster, text } of data.labels) {
      const s = sum.get(cluster);
      if (!s || !text) continue;
      const x = (s[0] / s[2]) * view.k + width / 2 + view.tx;
      const y = (s[1] / s[2]) * view.k + height / 2 + view.ty;
      if (x < 0 || y < 0 || x > width || y > height) continue;
      const w = ctx.measureText(text).width + 16;
      ctx.fillStyle = MAP.halo;
      ctx.beginPath(); ctx.roundRect(x - w / 2, y - 11, w, 22, 11); ctx.fill();
      ctx.fillStyle = PAL[cluster % PAL.length];
      ctx.fillText(text, x, y + 0.5);
    }
  }

  function draw() {
    const { width, height } = rect();
    ctx.clearRect(0, 0, width, height);
    if (!data) return;
    const { edges, nodes, layout } = data;
    const focus = data.focus || null;
    const hiddenByFilter = (i) => nodes[i].kind !== "doc" && ((filter === "top" && nodes[i].reply) || (filter === "reply" && !nodes[i].reply));

    ctx.lineWidth = 1;
    for (const e of edges) {
      const [x1, y1] = toScreen(e.a), [x2, y2] = toScreen(e.b);
      const dim = (focus && !(focus.has(e.a) && focus.has(e.b))) || hiddenByFilter(e.a) || hiddenByFilter(e.b);
      ctx.strokeStyle = `rgba(${MAP.edge},${dim ? 0.03 : MAP.edgeBase + 0.4 * Math.max(0, e.sim - 0.4)})`;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    // 답글 → 원댓글 연결선 (점선)
    if (showReplyLinks && data.replyEdges?.length && filter !== "top") {
      ctx.setLineDash([3, 3]);
      for (const e of data.replyEdges) {
        const [x1, y1] = toScreen(e.a), [x2, y2] = toScreen(e.b);
        const dim = focus && !(focus.has(e.a) || focus.has(e.b));
        ctx.strokeStyle = `rgba(${MAP.reply},${dim ? 0.05 : 0.38})`;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    const rk = Math.sqrt(view.k);
    for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i];
      const [x, y] = toScreen(i);
      if (x < -20 || y < -20 || x > width + 20 || y > height + 20) continue;
      const dim = (focus && !focus.has(i) && nd.kind !== "doc") || hiddenByFilter(i);
      ctx.globalAlpha = dim ? 0.1 : 1;
      const r = radius(nd) * rk;
      if (nd.reply) { // 답글: 속이 빈 고리
        ctx.strokeStyle = color(nd); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, Math.max(r - 0.8, 1.6), 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.fillStyle = color(nd);
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      if (nd.flag) { ctx.strokeStyle = MAP.flag; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 2.6, 0, Math.PI * 2); ctx.stroke(); }
      if (tags[i] >= 0 && tagCount) { ctx.strokeStyle = TAG_COLORS[tags[i] % TAG_COLORS.length]; ctx.lineWidth = 2; ctx.strokeRect(x - r - 4.5, y - r - 4.5, 2 * r + 9, 2 * r + 9); }
      if (layout.pin[i] && nd.kind !== "doc") { ctx.fillStyle = MAP.ink; ctx.beginPath(); ctx.arc(x + r * 0.9, y - r * 0.9, 1.6, 0, Math.PI * 2); ctx.fill(); }
      if (selection.has(i) || i === hover) {
        ctx.strokeStyle = MAP.select; ctx.lineWidth = selection.has(i) ? 2 : 1.2;
        ctx.beginPath(); ctx.arc(x, y, r + 1.2, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.lineWidth = 1;
    }
    ctx.globalAlpha = 1;
    drawLabels(width, height);
    if (drag?.type === "box") {
      ctx.strokeStyle = MAP.select; ctx.setLineDash([4, 3]);
      ctx.strokeRect(drag.x0, drag.y0, drag.x - drag.x0, drag.y - drag.y0);
      ctx.setLineDash([]);
    }
  }

  function animate() {
    if (raf || !data) return;
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
    let best = -1, bestD = 110;
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
    tooltip.style.top = `${Math.max(4, Math.min(my + 14, r.height - tooltip.offsetHeight - 4))}px`;
  }

  const emitSelection = () => onSelectionChange?.([...selection]);
  const emitTags = () => onTagsChange?.(api.tagCounts());

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
      drag = { type: "pan", x: mx, y: my, moved: false };
    }
  });

  canvas.addEventListener("mousemove", (ev) => {
    if (!data) return;
    const r = rect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    if (drag?.type === "node") {
      const [wx, wy] = toWorld(mx, my);
      const dx = wx - drag.wx, dy = wy - drag.wy;
      if (!drag.moved && (dx * dx + dy * dy) * view.k * view.k < 9) return;
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
    if (h !== hover) { hover = h; canvas.style.cursor = h >= 0 && data.nodes[h].kind !== "doc" ? "pointer" : "grab"; draw(); }
    showTooltip(h, mx, my);
  });

  window.addEventListener("mouseup", () => {
    if (!drag || !data) { drag = null; return; }
    if (drag.type === "node" && !drag.moved) {
      selection = new Set([drag.i]);
      emitSelection();
      onPick?.(drag.i);
    }
    if (drag.type === "pan" && !drag.moved && selection.size) { selection.clear(); emitSelection(); onPick?.(-1); }
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
    if (i >= 0 && data.nodes[i].kind !== "doc") { data.layout.release(i); data.layout.reheat(0.3); animate(); }
  });

  canvas.addEventListener("mouseleave", () => { hover = -1; tooltip.hidden = true; draw(); });

  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const r = rect();
    const mx = ev.clientX - r.left - r.width / 2, my = ev.clientY - r.top - r.height / 2;
    const f = Math.exp(-ev.deltaY * 0.0015);
    view.tx = mx - (mx - view.tx) * f;
    view.ty = my - (my - view.ty) * f;
    view.k = Math.max(0.15, Math.min(8, view.k * f));
    draw();
  }, { passive: false });

  canvas.addEventListener("keydown", (ev) => {
    if (!data) return;
    if (ev.key === "Escape") { selection.clear(); emitSelection(); onPick?.(-1); draw(); return; }
    if (/^[0-9]$/.test(ev.key) && selection.size) {
      const t = Number(ev.key) - 1;
      if (t < tagCount && tagCount) { api.tagSelection(t); ev.preventDefault(); }
    }
  });

  new ResizeObserver(resize).observe(canvas);

  const api = {
    set(next, { keepView = false, tags: restore = null } = {}) {
      cancelAnimationFrame(raf); raf = 0;
      data = next;
      if (!keepView) view = { k: 1, tx: 0, ty: 0 };
      hover = -1;
      selection = new Set();
      tags = new Int8Array(next.nodes.length).fill(-1);
      if (restore && restore.length === tags.length) tags.set(restore);
      emitSelection();
      emitTags();
      animate();
    },
    focus(nodeSet) { if (data) { data.focus = nodeSet; draw(); } },
    select(nodeIdx) { selection = new Set(nodeIdx); emitSelection(); draw(); },
    clearSelection() { selection.clear(); emitSelection(); draw(); },
    setLabels(labels) { if (data) { data.labels = labels; draw(); } },
    toggleLabels(on) { showLabels = on; draw(); },
    toggleReplyLinks(on) { showReplyLinks = on; draw(); },
    setFilter(f) { filter = f; draw(); },
    // 분류(수동 태그)
    setTagCount(n) { tagCount = n; },
    tagSelection(tag) { if (!tagCount) return; for (const i of selection) tags[i] = tag; emitTags(); draw(); },
    removeTag(tag) { // 분류 삭제: 해당 분류는 비우고 뒤 번호를 당긴다
      for (let i = 0; i < tags.length; i++) { if (tags[i] === tag) tags[i] = -1; else if (tags[i] > tag) tags[i]--; }
      emitTags(); draw();
    },
    tagCounts() {
      const c = new Array(tagCount).fill(0);
      for (const t of tags) if (t >= 0 && t < tagCount) c[t]++;
      return c;
    },
    tagged(tag) { const s = []; tags.forEach((t, i) => t === tag && s.push(i)); return s; },
    tagsArray: () => tags,
    unpinAll() {
      if (!data) return;
      for (let i = 0; i < data.nodes.length; i++) if (data.nodes[i].kind !== "doc") data.layout.release(i);
      data.layout.reheat(0.6); animate();
    },
    fit() { view = { k: 1, tx: 0, ty: 0 }; draw(); },
    setTheme(name) { MAP = THEMES[name] || THEMES.light; PAL = PALETTES[name] || PALETTES.light; draw(); },
    palette: () => PAL,
    redraw: draw,
  };
  return api;
}
