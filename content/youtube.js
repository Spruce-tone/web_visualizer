// YouTube 어댑터: DOM → 공통 스키마(Doc, Comment[])
// 선택자는 YouTube 개편 시 깨질 수 있으므로 이 파일에만 모아둔다.
(function () {
  if (globalThis.__WV_YT_LOADED__) return; // 재주입 시 리스너 중복 방지
  globalThis.__WV_YT_LOADED__ = true;
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
   * @param {{max:number, sort:"top"|"new", includeReplies:boolean}} opts
   */
  async function collectAll({ max = 1000, sort = "top", includeReplies = true } = {}) {
    cancelled = false;
    const doc = docMeta();
    const progress = (count, total) => chrome.runtime.sendMessage({ type: "WV_PROGRESS", count, total }).catch(() => {});

    const html = await (await fetch(`/watch?v=${encodeURIComponent(doc.meta.videoId)}`, { credentials: "same-origin" })).text();
    const { cfg, data } = WV.parseWatchHtml(html);
    if (!cfg.INNERTUBE_CONTEXT || !data) throw new Error("YouTube 설정을 읽지 못했어요.");

    // 댓글 섹션 → 정렬 메뉴(인기/최신) endpoint
    const section = [...WV.searchDict(data, "itemSectionRenderer")].find((s) => WV.first(s, "continuationItemRenderer"));
    if (!section) throw new Error("댓글이 꺼져 있거나 찾을 수 없어요.");
    let first = await callNext(WV.first(WV.first(section, "continuationItemRenderer"), "continuationEndpoint"), cfg);
    const sortItems = WV.first(first, "sortFilterSubMenuRenderer")?.subMenuItems || [];
    const sortEndpoint = sortItems[sort === "new" ? 1 : 0]?.serviceEndpoint;

    const queue = [];
    const comments = [];
    const seen = new Set();
    let total = null;
    let pending = sortEndpoint ? null : first; // 정렬 메뉴가 없으면 첫 응답부터 바로 사용
    if (sortEndpoint) queue.push(sortEndpoint);

    while ((pending || queue.length) && comments.length < max && !cancelled) {
      const resp = pending || (await callNext(queue.shift(), cfg));
      pending = null;
      const r = WV.parseInnertubeComments(resp, doc.id, { includeReplies });
      if (r.error && !comments.length) throw new Error(r.error);
      if (r.total) total = r.total;
      for (const c of r.comments) {
        if (seen.has(c.id) || comments.length >= max) continue;
        seen.add(c.id);
        comments.push(c);
      }
      queue.unshift(...r.replies); // 답글을 먼저 받아 스레드를 붙여서 수집
      queue.push(...r.next);
      progress(comments.length, total);
      await WV.sleep(120); // 서버 부담 줄이기
    }
    doc.meta.totalComments = total;
    doc.meta.collection = { method: "innertube", sort, includeReplies, cancelled, complete: !queue.length && !cancelled };
    return { doc, comments };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!/youtube\.com\/watch/.test(location.href)) {
      sendResponse({ ok: false, error: "YouTube 영상 페이지(/watch)에서 실행하세요." });
      return;
    }
    if (msg.type === "WV_FOCUS") {
      const link = msg.id && document.querySelector(`ytd-comments a[href*="lc=${CSS.escape(msg.id)}"]`);
      const el = link?.closest(SEL.comment);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.transition = "outline-color .3s";
        el.style.outline = "3px solid #4c6ef5";
        el.style.outlineOffset = "4px";
        setTimeout(() => (el.style.outline = "3px solid transparent"), 1800);
      }
      if (!el && msg.id) {
        // 아직 페이지에 로드되지 않은 댓글 → lc 파라미터로 열면 YouTube가 맨 위에 고정해 보여준다
        const u = new URL(location.href);
        u.searchParams.set("lc", msg.id);
        location.href = u.toString();
      }
      sendResponse({ ok: !!el, navigated: !el });
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
  });
})();
