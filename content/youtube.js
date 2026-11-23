// YouTube 어댑터: DOM → 공통 스키마(Doc, Comment[])
// 선택자는 YouTube 개편 시 깨질 수 있으므로 이 파일에만 모아둔다.
(function () {
  if (globalThis.__WV_YT_LOADED__) return; // 재주입 시 리스너 중복 방지
  globalThis.__WV_YT_LOADED__ = true;
  const SEL = {
    title: "ytd-watch-metadata h1, h1.ytd-watch-metadata, #title h1",
    channel: "ytd-watch-metadata #channel-name a, #owner #channel-name a",
    description: "ytd-watch-metadata #description-inline-expander, #description",
    commentsSection: "ytd-comments#comments, #comments",
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
    const id = videoId();
    const doc = {
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

  async function loadMore({ max = 300, idleRounds = 3 } = {}) {
    const section = document.querySelector(SEL.commentsSection);
    if (section) section.scrollIntoView();
    await WV.sleep(1500);
    let last = -1, idle = 0;
    while (idle < idleRounds) {
      const n = document.querySelectorAll(SEL.thread).length;
      if (n >= max) break;
      idle = n === last ? idle + 1 : 0;
      last = n;
      window.scrollTo(0, document.documentElement.scrollHeight);
      await WV.sleep(1500);
    }
    return document.querySelectorAll(SEL.thread).length;
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
      sendResponse({ ok: !!el });
    } else if (msg.type === "WV_EXTRACT") {
      try { sendResponse({ ok: true, data: extract() }); }
      catch (e) { sendResponse({ ok: false, error: String(e) }); }
    } else if (msg.type === "WV_LOAD_MORE") {
      loadMore(msg.options).then(
        (count) => sendResponse({ ok: true, data: extract(), threadCount: count }),
        (e) => sendResponse({ ok: false, error: String(e) })
      );
      return true; // 비동기 응답
    }
  });
})();
