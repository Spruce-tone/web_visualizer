// 캔버스 지도 — 댓글(또는 작성자)을 점으로 찍는다. 밝은 배경이 기본, 어둡게 전환 가능.
// 조작
//   빈 곳 드래그: 화면 이동 · 휠: 확대/축소
//   점 클릭: 선택(onPick) · 점 드래그: 옮기고 그 자리에 고정
//   키워드(주제 이름표) 드래그: 그 주제의 댓글 전체가 함께 이동
//   Shift+드래그(빈 곳): 영역 선택 · Shift+클릭: 선택 추가/해제 · Esc: 선택 해제
//   숫자키 1~9: 선택한 점을 분류에 넣기 · 0: 분류 빼기 · 더블클릭: 고정 해제
// 성능: 화면 크기·좌표를 한 번만 계산하고, 선과 점을 색별로 묶어 한 번에 그린다 (수천 개도 부드럽게).

const PALETTES = {
  light: ["#3B5BDB", "#E8590C", "#2B8A3E", "#9C36B5", "#0B7285", "#B8860B", "#C2255C", "#5C7A0D", "#6741D9", "#1864AB"],
  dark: ["#7C9CFF", "#FF9F5A", "#5BD68A", "#D08CFF", "#4FD1D9", "#FFC94A", "#FF7FA8", "#A6D34B", "#9E8CFF", "#59B8E8"],
};
const THEMES = {
  light: { reply: "150,95,10", edge: "70,90,130", lone: "#8D98AB", doc: "#18202F", flag: "#D9480F", ink: "#18202F", halo: "rgba(255,255,255,.94)", select: "#18202F", edgeBase: 0.16, island: 0.07 },
  dark: { reply: "255,200,120", edge: "150,170,215", lone: "#56627A", doc: "#FFFFFF", flag: "#FF8A3D", ink: "#E8EDF7", halo: "rgba(10,15,28,.85)", select: "#FFFFFF", edgeBase: 0.1, island: 0.1 },
};
export const TOPIC_COLORS = PALETTES.light; // 목록·배지에서 쓰는 주제 색 (지도와 같은 순서)
export const TAG_COLORS = ["#FF5A5F", "#3DA5FF", "#3ED598", "#FFB020", "#C77DFF", "#00C2C7", "#FF8FB1", "#B4D335", "#F06FD5"];

export function createGraph(canvas, tooltip, { onPick, onTagsChange, onSelectionChange } = {}) {
  const ctx = canvas.getContext("2d");
  canvas.tabIndex = 0;
  let MAP = THEMES.light, PAL = PALETTES.light, themeName = "light";
  let data = null; // { layout, edges, nodes, focus, labels:[{cluster, text}], replyEdges }
  let view = { k: 1, tx: 0, ty: 0 };
  let W = 1, H = 1;
  let autoFit = true; // 사용자가 직접 옮기거나 확대하기 전까지는 크기가 바뀔 때 전체가 보이게 다시 맞춘다
  let hover = -1, hoverLabel = -1, drag = null, raf = 0;
  let selection = new Set();
  let tags = new Int8Array(0); // -1 = 없음
  let tagCount = 4;
  let showLabels = true, showReplyLinks = true, showEdges = false, filter = "all"; // all | top(댓글만) | reply(답글만)
  // 그릴 때마다 다시 만들지 않는 캐시
  let sx = new Float32Array(0), sy = new Float32Array(0), rad = new Float32Array(0);
  let colorOf = [], colorGroups = new Map(), marked = [], labelRects = [];

  function measure() {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    W = r.width || 1; H = r.height || 1;
    canvas.width = Math.max(1, W * dpr);
    canvas.height = Math.max(1, H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function resize() {
    measure();
    if (data && autoFit) fitView();
    draw();
  }

  // 크기: weight(0~1, 그 영상 안에서의 상대적 좋아요·댓글 수)에 따라 3 ~ 17px
  const baseRadius = (nd) => (nd.kind === "doc" ? 9 : 3 + 14 * Math.pow(nd.weight || 0, 1.4));
  const colorFor = (nd) => (nd.kind === "doc" ? MAP.doc : nd.tint ? nd.tint[themeName === "dark" ? 1 : 0] : nd.cluster >= 0 ? PAL[nd.cluster % PAL.length] : MAP.lone);
  const hiddenByFilter = (nd) => nd.kind !== "doc" && ((filter === "top" && nd.reply) || (filter === "reply" && !nd.reply));

  function prepare() { // set()·테마 변경 때 한 번
    const n = data.nodes.length;
    if (sx.length !== n) { sx = new Float32Array(n); sy = new Float32Array(n); rad = new Float32Array(n); }
    colorOf = new Array(n);
    colorGroups = new Map();
    marked = [];
    data.nodes.forEach((nd, i) => {
      rad[i] = baseRadius(nd);
      const c = colorFor(nd);
      colorOf[i] = c;
      if (!colorGroups.has(c)) colorGroups.set(c, []);
      colorGroups.get(c).push(i);
      if (nd.flag) marked.push(i);
    });
  }

  function project() {
    const { x, y } = data.layout, k = view.k, ox = W / 2 + view.tx, oy = H / 2 + view.ty;
    for (let i = 0; i < sx.length; i++) { sx[i] = x[i] * k + ox; sy[i] = y[i] * k + oy; }
  }
  const toWorld = (px, py) => [(px - W / 2 - view.tx) / view.k, (py - H / 2 - view.ty) / view.k];

  /** 주제 이름표: 닻이 있으면 섬 위에, 없으면(연속 지도) 그 주제 점들의 가운데에. 서로 겹치지 않게 위아래로 비켜 놓는다. */
  function drawIslandsAndLabels(labelsOnly) {
    const an = data.layout.anchors;
    if (!data.labels?.length) { labelRects = []; return; }
    const k = view.k, ox = W / 2 + view.tx, oy = H / 2 + view.ty;
    if (!labelsOnly) {
      if (!an) return;
      for (const { cluster, color } of data.labels) {
        const a = an[cluster];
        if (!a) continue;
        ctx.globalAlpha = MAP.island;
        ctx.fillStyle = color || PAL[cluster % PAL.length];
        ctx.beginPath(); ctx.arc(a.x * k + ox, a.y * k + oy, (a.r + 10) * k, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      return;
    }
    labelRects = [];
    if (!showLabels) return;
    // 주제별 가운데 (닻이 없을 때)
    let mid = null;
    if (!an) {
      mid = new Map();
      for (let i = 0; i < data.nodes.length; i++) {
        const c = data.nodes[i].cluster;
        if (c < 0 || data.nodes[i].kind === "doc") continue;
        let m = mid.get(c);
        if (!m) mid.set(c, (m = [0, 0, 0]));
        m[0] += sx[i]; m[1] += sy[i]; m[2]++;
      }
    }
    ctx.font = "650 12.5px Pretendard, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    data.labels.forEach(({ cluster, text, color }, li) => {
      if (!text) return;
      let x, y;
      if (an && an[cluster]) { x = an[cluster].x * k + ox; y = (an[cluster].y - an[cluster].r - 6) * k + oy - 12; }
      else if (mid?.get(cluster)) { const m = mid.get(cluster); x = m[0] / m[2]; y = m[1] / m[2]; }
      else return;
      if (x < -60 || y < -20 || x > W + 60 || y > H + 20) return;
      const w = ctx.measureText(text).width + 18;
      // 겹치면 위·아래로 번갈아 비켜 준다
      const hit = (yy) => labelRects.some((r) => x - w / 2 < r.x1 + 4 && x + w / 2 > r.x0 - 4 && yy - 12 < r.y1 + 3 && yy + 12 > r.y0 - 3);
      for (let t = 0; t < 8 && hit(y); t++) y += (t % 2 ? -1 : 1) * 27 * (t + 1);
      const c = color || PAL[cluster % PAL.length];
      ctx.fillStyle = MAP.halo;
      ctx.beginPath(); ctx.roundRect(x - w / 2, y - 12, w, 24, 12); ctx.fill();
      ctx.strokeStyle = c;
      ctx.lineWidth = li === hoverLabel || (drag?.type === "label" && drag.li === li) ? 2.4 : 1.2;
      ctx.stroke();
      ctx.fillStyle = c;
      ctx.fillText(text, x, y + 0.5);
      labelRects.push({ li, cluster, x0: x - w / 2, y0: y - 12, x1: x + w / 2, y1: y + 12 });
    });
    ctx.lineWidth = 1;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (!data) return;
    const { edges, nodes, layout } = data;
    const focus = data.focus || null;
    const n = nodes.length;
    project();
    drawIslandsAndLabels(false);

    // 주제 번짐: 같은 주제의 점 주위를 옅게 칠해 무리가 한눈에 보이게 한다 (연속 지도에서 섬 대신)
    const rk = Math.max(0.75, Math.min(2.2, Math.sqrt(view.k)));
    if (!data.layout.anchors && !data.noGlow) {
      const glow = 9 * Math.max(0.6, Math.min(2.5, view.k));
      ctx.globalAlpha = MAP.island + 0.03;
      for (const [c, list] of colorGroups) {
        if (c === MAP.lone || c === MAP.doc) continue;
        ctx.fillStyle = c;
        ctx.beginPath();
        for (const i of list) {
          if (nodes[i].cluster < 0 || nodes[i].tint || hiddenByFilter(nodes[i]) || (focus && !focus.has(i))) continue;
          const r = rad[i] * rk + glow;
          ctx.moveTo(sx[i] + r, sy[i]); ctx.arc(sx[i], sy[i], r, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // 선: 진하기 3단계 × (보통/흐림) 으로 묶어 한 번씩만 그린다. 움직이는 중이고 선이 아주 많으면 생략.
    const busy = raf && edges.length > 6000;
    if (!busy) {
      if (showEdges || data.layout.anchors || data.alwaysEdges) {
      const paths = [[], [], [], []]; // 0~2 = 유사도 단계, 3 = 흐림
      for (const e of edges) {
        const dim = (focus && !(focus.has(e.a) && focus.has(e.b))) || hiddenByFilter(nodes[e.a]) || hiddenByFilter(nodes[e.b]);
        paths[dim ? 3 : e.sim > 0.75 ? 2 : e.sim > 0.5 ? 1 : 0].push(e);
      }
      const alphas = [MAP.edgeBase, MAP.edgeBase + 0.12, MAP.edgeBase + 0.26, 0.03];
      ctx.lineWidth = 1;
      paths.forEach((list, b) => {
        if (!list.length) return;
        ctx.strokeStyle = `rgba(${MAP.edge},${alphas[b]})`;
        ctx.beginPath();
        for (const e of list) { ctx.moveTo(sx[e.a], sy[e.a]); ctx.lineTo(sx[e.b], sy[e.b]); }
        ctx.stroke();
      });
      }
      if (showReplyLinks && data.replyEdges?.length && filter !== "top") {
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = `rgba(${MAP.reply},${focus ? 0.12 : 0.38})`;
        ctx.beginPath();
        for (const e of data.replyEdges) { ctx.moveTo(sx[e.a], sy[e.a]); ctx.lineTo(sx[e.b], sy[e.b]); }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 점: 색별로 묶어 채운 점 / 고리(답글) / 흐린 점을 각각 한 번에
    const onScreen = (i) => sx[i] > -20 && sy[i] > -20 && sx[i] < W + 20 && sy[i] < H + 20;
    for (const [c, list] of colorGroups) {
      for (let pass = 0; pass < 4; pass++) { // 0 채움 1 고리 2 흐린 채움 3 흐린 고리
        const hollow = pass % 2 === 1, dimPass = pass >= 2;
        let any = false;
        ctx.beginPath();
        for (const i of list) {
          const nd = nodes[i];
          if (!!nd.reply !== hollow) continue;
          const dim = (focus && !focus.has(i) && nd.kind !== "doc") || hiddenByFilter(nd);
          if (dim !== dimPass || !onScreen(i)) continue;
          const r = hollow ? Math.max(rad[i] * rk - 0.8, 1.6) : rad[i] * rk;
          ctx.moveTo(sx[i] + r, sy[i]);
          ctx.arc(sx[i], sy[i], r, 0, Math.PI * 2);
          any = true;
        }
        if (!any) continue;
        ctx.globalAlpha = dimPass ? 0.1 : 1;
        if (hollow) { ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.stroke(); } else { ctx.fillStyle = c; ctx.fill(); }
      }
    }
    ctx.globalAlpha = 1;

    // 표시가 붙는 점만 따로: 복붙 의심 테, 내 분류, 고정 표시, 선택·가리킴
    ctx.lineWidth = 2;
    ctx.strokeStyle = MAP.flag;
    ctx.beginPath();
    for (const i of marked) {
      if (!onScreen(i) || hiddenByFilter(nodes[i]) || (focus && !focus.has(i))) continue;
      const r = rad[i] * rk + 2.6;
      ctx.moveTo(sx[i] + r, sy[i]); ctx.arc(sx[i], sy[i], r, 0, Math.PI * 2);
    }
    ctx.stroke();
    if (tagCount) {
      for (let i = 0; i < n; i++) {
        if (tags[i] < 0 || !onScreen(i)) continue;
        const r = rad[i] * rk;
        ctx.strokeStyle = TAG_COLORS[tags[i] % TAG_COLORS.length];
        ctx.strokeRect(sx[i] - r - 4.5, sy[i] - r - 4.5, 2 * r + 9, 2 * r + 9);
      }
    }
    ctx.fillStyle = MAP.ink;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (!layout.pin[i] || nodes[i].kind === "doc" || !onScreen(i)) continue;
      const r = rad[i] * rk;
      ctx.moveTo(sx[i] + r * 0.9 + 1.6, sy[i] - r * 0.9); ctx.arc(sx[i] + r * 0.9, sy[i] - r * 0.9, 1.6, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.strokeStyle = MAP.select;
    ctx.beginPath();
    for (const i of selection) { const r = rad[i] * rk + 1.4; ctx.moveTo(sx[i] + r, sy[i]); ctx.arc(sx[i], sy[i], r, 0, Math.PI * 2); }
    ctx.stroke();
    if (hover >= 0 && !selection.has(hover)) {
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(sx[hover], sy[hover], rad[hover] * rk + 1.2, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.lineWidth = 1;

    drawIslandsAndLabels(true);
    if (drag?.type === "box") {
      ctx.strokeStyle = MAP.select; ctx.setLineDash([4, 3]);
      ctx.strokeRect(drag.x0, drag.y0, drag.x - drag.x0, drag.y - drag.y0);
      ctx.setLineDash([]);
    }
  }

  function animate() {
    if (raf || !data) return;
    const loop = () => {
      const steps = data.nodes.length > 2500 ? 1 : 2;
      let running = true;
      for (let s = 0; s < steps && running; s++) running = data.layout.tick();
      raf = running || drag?.type === "node" ? requestAnimationFrame(loop) : 0;
      draw();
    };
    raf = requestAnimationFrame(loop);
  }

  function pick(mx, my) {
    if (!data) return -1;
    let best = -1, bestD = 120;
    for (let i = 0; i < sx.length; i++) {
      const dx = sx[i] - mx, dy = sy[i] - my;
      const d = dx * dx + dy * dy;
      if (d < bestD && !hiddenByFilter(data.nodes[i])) { bestD = d; best = i; }
    }
    return best;
  }
  const pickLabel = (mx, my) => { const r = labelRects.find((l) => mx >= l.x0 && mx <= l.x1 && my >= l.y0 && my <= l.y1); return r ? r.li : -1; };

  function showTooltip(i, mx, my) {
    if (i < 0) { tooltip.hidden = true; return; }
    const nd = data.nodes[i];
    tooltip.hidden = false;
    tooltip.replaceChildren();
    const t = document.createElement("div"); t.textContent = nd.label;
    const s = document.createElement("div"); s.className = "sub"; s.textContent = nd.sub;
    tooltip.append(t, s);
    tooltip.style.left = `${Math.max(4, Math.min(mx + 12, W - tooltip.offsetWidth - 4))}px`;
    tooltip.style.top = `${Math.max(4, Math.min(my + 14, H - tooltip.offsetHeight - 4))}px`;
  }

  const emitSelection = () => onSelectionChange?.([...selection]);
  const emitTags = () => onTagsChange?.(api.tagCounts());
  const pos = (ev) => { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };

  canvas.addEventListener("mousedown", (ev) => {
    if (!data) return;
    canvas.focus();
    const [mx, my] = pos(ev);
    const li = pickLabel(mx, my);
    if (li >= 0) { // 키워드를 끌면 그 주제 전체가 따라온다
      const [wx, wy] = toWorld(mx, my);
      drag = { type: "label", li, cluster: data.labels[li].cluster, wx, wy, moved: false };
      return;
    }
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
    const [mx, my] = pos(ev);
    if (drag?.type === "label") {
      const [wx, wy] = toWorld(mx, my);
      data.layout.moveGroup(drag.cluster, wx - drag.wx, wy - drag.wy);
      drag.wx = wx; drag.wy = wy; drag.moved = true;
      tooltip.hidden = true;
      if (data.layout.alpha > 0.02) animate(); else if (!raf) draw();
      return;
    }
    if (drag?.type === "node") {
      const [wx, wy] = toWorld(mx, my);
      const dx = wx - drag.wx, dy = wy - drag.wy;
      if (!drag.moved && (dx * dx + dy * dy) * view.k * view.k < 9) return;
      drag.moved = true;
      drag.group.forEach((j, k) => data.layout.fix(j, drag.start[k][0] + dx, drag.start[k][1] + dy));
      data.layout.reheat(0.15);
      animate();
      tooltip.hidden = true;
      return;
    }
    if (drag?.type === "box") { drag.x = mx; drag.y = my; draw(); return; }
    if (drag?.type === "pan") {
      view.tx += mx - drag.x; view.ty += my - drag.y;
      if (Math.abs(mx - drag.x) + Math.abs(my - drag.y) > 1) { drag.moved = true; autoFit = false; }
      drag.x = mx; drag.y = my;
      if (!raf) draw();
      return;
    }
    const hl = pickLabel(mx, my);
    const h = hl >= 0 ? -1 : pick(mx, my);
    if (h !== hover || hl !== hoverLabel) {
      hover = h; hoverLabel = hl;
      canvas.style.cursor = hl >= 0 ? "move" : h >= 0 && data.nodes[h].kind !== "doc" ? "pointer" : "grab";
      if (!raf) draw();
    }
    showTooltip(h, mx, my);
  });

  window.addEventListener("mouseup", () => {
    if (!drag || !data) { drag = null; return; }
    if (drag.type === "node" && !drag.moved) {
      selection = new Set([drag.i]);
      emitSelection();
      onPick?.(drag.i);
    }
    if (drag.type === "label" && !drag.moved) { // 키워드를 그냥 누르면 그 주제의 댓글을 모두 고른다
      const c = drag.cluster;
      selection = new Set();
      data.nodes.forEach((nd, i) => { if (nd.cluster === c && nd.kind !== "doc") selection.add(i); });
      emitSelection();
    }
    if (drag.type === "pan" && !drag.moved && selection.size) { selection.clear(); emitSelection(); onPick?.(-1); }
    if (drag.type === "box") {
      const [x0, x1] = [Math.min(drag.x0, drag.x), Math.max(drag.x0, drag.x)];
      const [y0, y1] = [Math.min(drag.y0, drag.y), Math.max(drag.y0, drag.y)];
      data.nodes.forEach((nd, i) => {
        if (nd.kind === "doc" || hiddenByFilter(nd)) return;
        if (sx[i] >= x0 && sx[i] <= x1 && sy[i] >= y0 && sy[i] <= y1) selection.add(i);
      });
      emitSelection();
    }
    drag = null;
    draw();
  });

  canvas.addEventListener("dblclick", (ev) => {
    if (!data) return;
    const [mx, my] = pos(ev);
    const i = pick(mx, my);
    if (i >= 0 && data.nodes[i].kind !== "doc") { data.layout.release(i); data.layout.reheat(0.2); animate(); draw(); }
  });

  canvas.addEventListener("mouseleave", () => { hover = -1; hoverLabel = -1; tooltip.hidden = true; if (!raf) draw(); });

  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const [px, py] = pos(ev);
    const mx = px - W / 2, my = py - H / 2;
    const f = Math.exp(-ev.deltaY * 0.0015);
    const nk = Math.max(0.1, Math.min(8, view.k * f)), g = nk / view.k;
    view.tx = mx - (mx - view.tx) * g;
    view.ty = my - (my - view.ty) * g;
    view.k = nk;
    autoFit = false;
    if (!raf) draw();
  }, { passive: false });

  canvas.addEventListener("keydown", (ev) => {
    if (!data) return;
    if (ev.key === "Escape") { selection.clear(); emitSelection(); onPick?.(-1); draw(); return; }
    if (/^[0-9]$/.test(ev.key) && selection.size && tagCount) {
      const t = Number(ev.key) - 1;
      if (t < tagCount) { api.tagSelection(t); ev.preventDefault(); }
    }
  });

  new ResizeObserver(resize).observe(canvas);

  /** 지도 전체가 화면에 들어오도록 배율·위치 맞춤 */
  function fitView() {
    if (!data) return;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const { x, y, anchors } = data.layout;
    for (let i = 0; i < x.length; i++) { x0 = Math.min(x0, x[i]); x1 = Math.max(x1, x[i]); y0 = Math.min(y0, y[i]); y1 = Math.max(y1, y[i]); }
    for (const a of anchors || []) { x0 = Math.min(x0, a.x - a.r); x1 = Math.max(x1, a.x + a.r); y0 = Math.min(y0, a.y - a.r - 30); y1 = Math.max(y1, a.y + a.r); }
    if (!isFinite(x0)) { view = { k: 1, tx: 0, ty: 0 }; return; }
    const k = Math.max(0.1, Math.min(2.5, 0.92 * Math.min(W / Math.max(1, x1 - x0), H / Math.max(1, y1 - y0))));
    view = { k, tx: -((x0 + x1) / 2) * k, ty: -((y0 + y1) / 2) * k };
  }

  const api = {
    set(next, { keepView = false, tags: restore = null } = {}) {
      cancelAnimationFrame(raf); raf = 0;
      data = next;
      hover = -1; hoverLabel = -1;
      selection = new Set();
      tags = new Int8Array(next.nodes.length).fill(-1);
      if (restore && restore.length === tags.length) tags.set(restore);
      prepare();
      measure();
      if (!keepView) { autoFit = true; fitView(); }
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
    toggleEdges(on) { showEdges = on; draw(); },
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
      data.layout.reheat(0.5); animate(); draw();
    },
    fit() { autoFit = true; fitView(); draw(); },
    setTheme(name) { themeName = THEMES[name] ? name : "light"; MAP = THEMES[themeName]; PAL = PALETTES[themeName]; if (data) prepare(); draw(); },
    palette: () => PAL,
    redraw: draw,
  };
  return api;
}
