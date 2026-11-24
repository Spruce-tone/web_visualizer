// YouTube 어댑터: DOM → 공통 스키마(Doc, Comment[])
// 선택자는 YouTube 개편 시 깨질 수 있으므로 이 파일에만 모아둔다.
(function () {
  // 다시 주입될 수 있다(확장을 새로 고친 뒤 영상 탭을 새로고침하지 않은 경우 등).
  // 예전에는 '이미 있음' 표시만 보고 그냥 끝내서, 죽은 옛 리스너만 남아 응답이 없었다 → 옛 리스너를 떼고 새로 단다.
  try { if (globalThis.__WV_YT_LISTENER__) chrome.runtime.onMessage.removeListener(globalThis.__WV_YT_LISTENER__); } catch { /* 옛 문맥이 이미 무효 */ }
  const SEL = {
    title: "ytd-watch-metadata h1, h1.ytd-watch-metadata, #title h1",
    channel: "ytd-watch-metadata #channel-name a, #owner #channel-name a",
    description: "ytd-watch-metadata #description-inline-expander, #description",
    thread: "ytd-comment-thread-renderer",
    // 신형(ytd-comment-view-model) / 구형(ytd-comment-renderer) 모두 대응
    comment: "ytd-comment-view-model, ytd-comment-renderer",
    author: "#author-text",
    content: "#content-text",
    likes: "#vote-count-middle",
    time: "#published-time-text a, #published-time-text, .published-time-text a",
    replyButton: "#more-replies button, #more-replies",
  };

  function videoId() {
    return new URL(location.href).searchParams.get("v");
  }

  function parseComment(el, docId, parentId) {
    const timeEl = el.querySelector(SEL.time);
    const href = timeEl && (timeEl.getAttribute("href") || timeEl.querySelector("a")?.getAttribute("href"));
    const lc = href ? new URL(href, location.origin).searchParams.get("lc") : null;
    const authorEl = el.querySelector(SEL.author);
    const authorHref = authorEl?.getAttribute("href") || authorEl?.querySelector("a")?.getAttribute("href") || "";
    const timeRaw = WV.text(timeEl);
    const t = WV.parseRelativeTime(timeRaw);
    const text = WV.text(el.querySelector(SEL.content));
    return {
      id: lc || `${docId}:${parentId || "root"}:${text.slice(0, 24)}:${WV.text(authorEl)}`,
      docId,
      parentId: parentId || null,
      author: WV.text(authorEl),
      authorId: authorHref.replace(/^\//, "") || null,
      text,
      likes: WV.parseCount(WV.text(el.querySelector(SEL.likes))),
      createdAtRaw: timeRaw,
      createdAtApprox: t.approx,
      edited: t.edited,
      meta: {},
    };
  }

  function extract() {
    const doc = docMeta();
    doc.meta.collection = { method: "dom" };

    const comments = [];
    const seen = new Set();
    document.querySelectorAll(SEL.thread).forEach((thread) => {
      const nodes = thread.querySelectorAll(SEL.comment);
      if (!nodes.length) return;
      const top = parseComment(nodes[0], doc.id, null);
      const replyRaw = WV.text(thread.querySelector(SEL.replyButton));
      top.meta.replyCount = WV.parseCount((replyRaw.match(/[\d.,]+\s*(천|만|K|M)?/i) || [""])[0]);
      if (!seen.has(top.id)) { seen.add(top.id); comments.push(top); }
      // 펼쳐진 답글만 수집 (M0에서는 자동으로 펼치지 않음)
      for (let i = 1; i < nodes.length; i++) {
        const r = parseComment(nodes[i], doc.id, top.id);
        if (!seen.has(r.id)) { seen.add(r.id); comments.push(r); }
      }
    });
    return { doc, comments };
  }

  // ---- 전체 댓글 수집: YouTube 웹이 쓰는 내부 API(youtubei/v1/next)를 같은 출처에서 호출 ----
  let cancelled = false;

  function docMeta() {
    const id = videoId();
    return {
      id: `youtube:${id}`,
      site: "youtube",
      url: location.href,
      title: WV.text(document.querySelector(SEL.title)) || document.title,
      author: WV.text(document.querySelector(SEL.channel)),
      publishedAt: null,
      text: WV.text(document.querySelector(SEL.description)).slice(0, 5000),
      meta: { videoId: id },
      extractedAt: new Date().toISOString(),
    };
  }

  async function callNext(endpoint, cfg) {
    const url = new URL(endpoint.commandMetadata?.webCommandMetadata?.apiUrl || "/youtubei/v1/next", location.origin);
    if (cfg.INNERTUBE_API_KEY) url.searchParams.set("key", cfg.INNERTUBE_API_KEY);
    url.searchParams.set("prettyPrint", "false");
    const res = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-YouTube-Client-Name": String(cfg.INNERTUBE_CONTEXT_CLIENT_NAME || 1),
        "X-YouTube-Client-Version": cfg.INNERTUBE_CLIENT_VERSION || cfg.INNERTUBE_CONTEXT?.client?.clientVersion || "",
      },
      body: JSON.stringify({ context: cfg.INNERTUBE_CONTEXT, continuation: endpoint.continuationCommand.token }),
    });
    if (!res.ok) throw new Error(`YouTube 응답 오류 ${res.status}`);
    return res.json();
  }

  /**
   * @param {{max:number, sort:"random"|"top"|"new"|"mix", includeReplies:boolean}} opts
   */
  async function collectAll({ max = 1000, sort = "top", includeReplies = true } = {}) {
    cancelled = false;
    const doc = docMeta();
    const progress = (count, total, phase = "") => chrome.runtime.sendMessage({ type: "WV_PROGRESS", count, total, phase }).catch(() => {});

    const html = await (await fetch(`/watch?v=${encodeURIComponent(doc.meta.videoId)}`, { credentials: "same-origin" })).text();
    const { cfg, data } = WV.parseWatchHtml(html);
    if (!cfg.INNERTUBE_CONTEXT || !data) throw new Error("YouTube 설정을 읽지 못했어요.");
    const fresh = WV.parseWatchMeta(html);
    if (fresh.title) doc.title = fresh.title;
    if (fresh.channel) doc.author = fresh.channel;
    if (fresh.description) doc.text = fresh.description.slice(0, 5000);

    // 댓글 섹션 → 정렬 메뉴(인기/최신) endpoint
    const section = [...WV.searchDict(data, "itemSectionRenderer")].find((s) => WV.first(s, "continuationItemRenderer"));
    if (!section) throw new Error("댓글이 꺼져 있거나 찾을 수 없어요.");
    let first = await callNext(WV.first(WV.first(section, "continuationItemRenderer"), "continuationEndpoint"), cfg);
    const sortItems = WV.first(first, "sortFilterSubMenuRenderer")?.subMenuItems || [];
    const comments = [];
    const seen = new Set();
    let total = null;
    let complete = true;

    // 한 가지 정렬로 limit 개까지 모은다
    async function drain(sortEndpoint, limit) {
      const queue = [];
      let pending = sortEndpoint ? null : first; // 정렬 메뉴가 없으면 첫 응답부터 바로 사용
      if (sortEndpoint) queue.push(sortEndpoint);
      while ((pending || queue.length) && comments.length < limit && !cancelled) {
        const resp = pending || (await callNext(queue.shift(), cfg));
        pending = null;
        const r = WV.parseInnertubeComments(resp, doc.id, { includeReplies });
        if (r.error && !comments.length) throw new Error(r.error);
        if (r.total) total = r.total;
        for (const c of r.comments) {
          if (seen.has(c.id) || comments.length >= limit) continue;
          seen.add(c.id);
          comments.push(c);
        }
        queue.unshift(...r.replies); // 답글을 먼저 받아 스레드를 붙여서 수집
        queue.push(...r.next);
        progress(comments.length, total);
        await WV.sleep(120); // 서버 부담 줄이기
      }
      if (queue.length || cancelled) complete = false;
    }

    let pool = null;
    if (sort === "random" && sortItems.length >= 2) {
      // 고르게 무작위: 최신순(좋아요와 무관한 순서)으로 원댓글 후보를 넉넉히 훑은 뒤, 씨앗이 정해진 무작위로 뽑는다.
      // 후보가 영상의 모든 원댓글을 덮으면 전체에서 균등 추출이고, 댓글이 아주 많으면 '최근 N개 중 균등 추출'이 된다.
      const poolLimit = Math.min(20000, Math.max(max * 3, 1500));
      const cand = [], seenTop = new Set(), threadEps = new Map();
      const queue = [sortItems[1].serviceEndpoint];
      while (queue.length && cand.length < poolLimit && !cancelled) {
        const r = WV.parseInnertubeComments(await callNext(queue.shift(), cfg), doc.id, { includeReplies });
        if (r.error && !cand.length) throw new Error(r.error);
        if (r.total) total = r.total;
        for (const c of r.comments) { if (!c.parentId && !seenTop.has(c.id)) { seenTop.add(c.id); cand.push(c); } }
        for (const t of r.threads) if (t.id && t.endpoints.length) threadEps.set(t.id, t.endpoints);
        queue.push(...r.next);
        progress(cand.length, total, "후보 확인");
        await WV.sleep(50);
      }
      pool = { size: cand.length, complete: !queue.length && !cancelled };
      for (const top of WV.seededShuffle(cand, doc.meta.videoId)) {
        if (comments.length >= max || cancelled) break;
        seen.add(top.id);
        comments.push(top);
        const rq = includeReplies ? [...(threadEps.get(top.id) || [])] : [];
        while (rq.length && comments.length < max && !cancelled) { // 뽑힌 스레드의 답글만 받는다
          const r = WV.parseInnertubeComments(await callNext(rq.shift(), cfg), doc.id, { includeReplies: true });
          for (const c of r.comments) { if (c.parentId && !seen.has(c.id) && comments.length < max) { seen.add(c.id); comments.push(c); } }
          rq.push(...r.replies);
          progress(comments.length, total, "답글 받는 중");
          await WV.sleep(50);
        }
      }
      complete = pool.complete && !cancelled;
    } else if (sort === "mix" && sortItems.length >= 2) {
      // 인기순 절반 + 최신순 절반: 좋아요 많은 댓글 쪽으로만 치우치지 않게
      await drain(sortItems[0].serviceEndpoint, Math.ceil(max / 2));
      const topDone = complete;
      complete = true;
      if (!topDone && !cancelled) await drain(sortItems[1].serviceEndpoint, max);
      else complete = topDone;
    } else {
      await drain(sortItems[sort === "new" ? 1 : 0]?.serviceEndpoint, max);
    }
    doc.meta.totalComments = total;
    doc.meta.collection = { method: "innertube", sort, includeReplies, cancelled, complete, pool };
    return { doc, comments };
  }

  // ---- 댓글의 실제 위치로 이동 (페이지를 다시 열지 않는다) ----
  let findCancelled = false;

  function highlight(el) {
    // 길어서 접힌 댓글이면 "자세히 보기"를 눌러 펼친다
    const more = el.querySelector("#more:not([hidden]), tp-yt-paper-button#more:not([hidden]), .more-button:not([hidden])");
    if (more && more.offsetParent !== null) more.click();
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.style.transition = "outline-color .4s";
    el.style.outline = "3px solid #3D6BFF";
    el.style.outlineOffset = "6px";
    el.style.borderRadius = "8px";
    setTimeout(() => (el.style.outlineColor = "transparent"), 3000);
  }

  /** 화면에 보이고 lc 값이 정확히 일치하는 댓글 요소 (접두어만 같은 답글 링크에 속지 않게 값 비교) */
  function findCommentEl(id) {
    for (const a of document.querySelectorAll(`ytd-comments a[href*="lc="]`)) {
      let lc = null;
      try { lc = new URL(a.getAttribute("href"), location.origin).searchParams.get("lc"); } catch { /* 무시 */ }
      // 숨은 댓글 패널(넓은 화면의 engagement panel)에도 같은 댓글이 있을 수 있다 → 화면에 보이는 것만
      if (lc === id) { const el = a.closest(SEL.comment); if (el && el.getClientRects().length) return el; }
    }
    return null;
  }

  const topThreads = () => document.querySelectorAll("ytd-comments ytd-comment-thread-renderer").length;
  const say = (text) => chrome.runtime.sendMessage({ type: "WV_FIND_PROGRESS", text }).catch(() => {});

  /**
   * YouTube 내부 이동(yt-navigate) 직후: 영상 위치를 되돌리고, 댓글 영역 맨 위에 뜨는 '하이라이트 댓글/답글'을 기다렸다가 강조한다.
   * 페이지는 새로고침되지 않는다. (실제 페이지에서 2~3초 안에 뜨는 것을 확인)
   */
  async function waitForLinked({ id, t = 0, paused = false, timeoutMs = 15000 }) {
    findCancelled = false;
    const deadline = Date.now() + timeoutMs;
    let restored = false;
    await WV.sleep(400);
    while (Date.now() < deadline && !findCancelled) {
      const v = document.querySelector("video");
      // 내부 이동을 하면 영상이 처음부터 다시 시작한다 → 보던 위치로 되돌린다
      const ad = !!document.querySelector(".html5-video-player.ad-showing"); // 광고가 나오는 동안에는 위치를 되돌릴 수 없다
      if (!restored && !ad && v && v.readyState >= 1 && t > 3 && v.currentTime < t - 2) {
        try { v.currentTime = t; if (paused) v.pause(); restored = true; } catch { /* 무시 */ }
      }
      const section = document.querySelector("ytd-comments");
      const el = findCommentEl(id);
      if (el) {
        highlight(el);
        return { ok: true };
      }
      if (section && !document.querySelector("ytd-comments ytd-comment-thread-renderer")) section.scrollIntoView({ block: "start" }); // 댓글은 화면 근처에 와야 불러온다
      await WV.sleep(250);
    }
    return { ok: false, reason: findCancelled ? "찾기를 멈췄어요." : "댓글이 뜨지 않았어요. 삭제됐거나 숨겨진 댓글일 수 있어요." };
  }

  /**
   * (예비 방법) 내부 이동을 쓸 수 없을 때만: 댓글 영역을 내려가며 찾는다. 느리다.
   * 1) 이미 있으면 바로 이동  2) 없으면 댓글 영역을 내려가며 원댓글(또는 그 댓글)을 불러옴
   * 3) 답글이면 스레드의 "답글 N개"와 "답글 더보기"를 눌러 가며 찾음
   */
  async function locateComment(id, parentId, { timeoutMs = 60000 } = {}) {
    findCancelled = false;
    let el = findCommentEl(id);
    if (el) { highlight(el); return { ok: true }; }

    const section = document.querySelector("ytd-comments");
    if (!section) return { ok: false, reason: "이 페이지에서 댓글 영역을 찾지 못했어요." };
    section.scrollIntoView({ block: "start" });
    const deadline = Date.now() + timeoutMs;
    const anchorId = parentId || id;
    let thread = null, last = -1, idle = 0;

    while (Date.now() < deadline && !findCancelled) {
      el = findCommentEl(id);
      if (el) { highlight(el); return { ok: true }; }
      const anchor = findCommentEl(anchorId);
      if (anchor) { thread = anchor.closest("ytd-comment-thread-renderer"); break; }
      const n = topThreads();
      idle = n === last ? idle + 1 : 0;
      last = n;
      if (idle >= 10) break; // 더 불러올 댓글이 없음
      say(`페이지에서 댓글을 찾는 중 (${n.toLocaleString()}개까지 불러옴)`);
      const conts = [...section.querySelectorAll("ytd-continuation-item-renderer")].filter((c) => !c.closest("ytd-comment-replies-renderer"));
      const target = conts.pop() || section.querySelector("ytd-comment-thread-renderer:last-of-type") || section;
      target.scrollIntoView({ block: "center" });
      await WV.sleep(650);
    }

    if (parentId && thread && !findCancelled) {
      say("답글을 펼치는 중");
      thread.scrollIntoView({ block: "center" });
      const replyCount = () => thread.querySelectorAll("ytd-comment-replies-renderer ytd-comment-view-model, ytd-comment-replies-renderer ytd-comment-renderer").length;
      if (replyCount() === 0) {
        thread.querySelector("#more-replies button, #more-replies-sub-thread button, ytd-comment-replies-renderer #expander button")?.click();
        await WV.sleep(900);
      }
      let lastR = -1, idleR = 0;
      while (Date.now() < deadline && !findCancelled) {
        el = findCommentEl(id);
        if (el) { highlight(el); return { ok: true }; }
        const moreBtn = thread.querySelector("ytd-comment-replies-renderer ytd-continuation-item-renderer button");
        if (moreBtn) { moreBtn.scrollIntoView({ block: "center" }); moreBtn.click(); }
        const r = replyCount();
        idleR = r === lastR && !moreBtn ? idleR + 1 : 0;
        lastR = r;
        if (idleR >= 6) break;
        say(`답글을 펼치는 중 (${r}개 확인)`);
        await WV.sleep(700);
      }
    }
    if (findCancelled) return { ok: false, reason: "찾기를 멈췄어요." };
    return { ok: false, reason: Date.now() >= deadline ? "시간 안에 찾지 못했어요. 댓글이 아주 아래쪽에 있을 수 있어요." : "페이지에서 이 댓글을 찾지 못했어요. 삭제됐거나 정렬 방식에 따라 보이지 않을 수 있어요." };
  }

  // 개발·점검용 (background.js 참고)
  const devOpen = () => { if (location.hash === "#wv-dev-open") { history.replaceState(history.state, "", location.href.replace(/#wv-dev-open$/, "")); chrome.runtime.sendMessage({ type: "WV_DEV_OPEN" }).catch(() => {}); } };
  window.addEventListener("hashchange", devOpen);
  devOpen();

  const BRIDGE_V = 2; // content/page-bridge.js 의 V와 같아야 한다
  /** 페이지 쪽 다리(page-bridge.js)에 부탁하고 답을 기다린다. 다리가 없으면 "timeout". */
  function askBridge(name, payload, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; document.removeEventListener(`${name}-ack`, onAck); resolve(v); };
      const onAck = (ev) => finish(String(ev.detail));
      document.addEventListener(`${name}-ack`, onAck);
      document.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(payload) }));
      setTimeout(() => finish("timeout"), timeoutMs);
    });
  }

  /** 댓글이 화면(DOM)에 나타날 때까지 기다렸다가 강조 */
  async function waitAndHighlight(id, timeoutMs) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end && !findCancelled) {
      const el = findCommentEl(id);
      if (el) { highlight(el); return true; }
      await WV.sleep(200);
    }
    return false;
  }

  /**
   * 댓글 열기. 빠르고 영상에 영향이 없는 방법부터 차례로 시도한다.
   *  1) 이미 화면에 있음 → 바로 이동
   *  2) 댓글 영역만 다시 불러와 '하이라이트 댓글'로 띄움 (영상 계속 재생, 1~2초)
   *  3) YouTube 내부 이동 (영상이 다시 불러와지고 광고가 나올 수 있음)
   *  4) 안 되면 패널에 알려 다른 길(스크롤 탐색)을 쓰게 한다
   */
  async function openComment(id) {
    findCancelled = false;
    let el = findCommentEl(id);
    if (el) { highlight(el); return { ok: true, via: "화면에 있던 댓글" }; }
    const section = document.querySelector("ytd-comments");
    if (!section) return { ok: false, reason: "이 페이지에서 댓글 영역을 찾지 못했어요." };
    section.scrollIntoView({ block: "start" }); // 댓글 영역이 화면에 와야 YouTube가 댓글과 정렬 버튼을 불러온다
    say("댓글 영역에서 그 댓글을 불러오는 중");
    const shown = await askBridge(`wv-show-comment-v${BRIDGE_V}`, { videoId: videoId(), id }, 14000);
    if (shown === "ok" && (await waitAndHighlight(id, 10000))) return { ok: true, via: "댓글 영역만 다시 불러옴" };
    if (findCancelled) return { ok: false, reason: "찾기를 멈췄어요." };
    const v = document.querySelector("video");
    const t = v ? v.currentTime : 0, paused = v ? v.paused : true;
    const nav = await askBridge(`wv-navigate-v${BRIDGE_V}`, { videoId: videoId(), id }, 600);
    if (nav === "ok") { const r = await waitForLinked({ id, t, paused }); return { ...r, via: "YouTube 내부 이동", detail: shown }; }
    return { ok: false, need: "navigate", t, paused, detail: `${shown}/${nav}` };
  }

  const listener = (msg, _sender, sendResponse) => {
    if (!/youtube\.com\/watch/.test(location.href)) {
      sendResponse({ ok: false, error: "YouTube 영상 페이지(/watch)에서 실행하세요." });
      return;
    }
    if (msg.type === "WV_FOCUS") {
      openComment(msg.id).then(sendResponse, (e) => sendResponse({ ok: false, reason: String(e.message || e) }));
      return true;
    } else if (msg.type === "WV_FOCUS_WAIT") {
      waitForLinked(msg).then(sendResponse, (e) => sendResponse({ ok: false, reason: String(e.message || e) }));
      return true;
    } else if (msg.type === "WV_FOCUS_SCAN") {
      locateComment(msg.id, msg.parentId).then(sendResponse, (e) => sendResponse({ ok: false, reason: String(e.message || e) }));
      return true; // 비동기 응답
    } else if (msg.type === "WV_FIND_CANCEL") {
      findCancelled = true;
      sendResponse({ ok: true });
    } else if (msg.type === "WV_EXTRACT") {
      try { sendResponse({ ok: true, data: extract() }); }
      catch (e) { sendResponse({ ok: false, error: String(e) }); }
    } else if (msg.type === "WV_COLLECT_ALL") {
      collectAll(msg.options).then(
        (data) => sendResponse({ ok: true, data }),
        (e) => {
          // 내부 API가 실패하면 화면에 보이는 댓글로 대체
          try { sendResponse({ ok: true, data: extract(), fallback: String(e.message || e) }); }
          catch { sendResponse({ ok: false, error: String(e.message || e) }); }
        }
      );
      return true; // 비동기 응답
    } else if (msg.type === "WV_CANCEL") {
      cancelled = true;
      sendResponse({ ok: true });
    }
  };
  globalThis.__WV_YT_LISTENER__ = listener;
  chrome.runtime.onMessage.addListener(listener);
})();
