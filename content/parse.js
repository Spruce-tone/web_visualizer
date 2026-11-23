// 공통 파싱 유틸 (content script 전역). 사이트 어댑터들이 공유한다.
var WV = (globalThis.WV = globalThis.WV || {});

/** "1.2천", "3.4만", "1.2K", "3M", "" → 숫자 */
WV.parseCount = function (raw) {
  if (!raw) return 0;
  const s = String(raw).replace(/[,\s]/g, "").trim();
  if (!s) return 0;
  const m = s.match(/^([\d.]+)(천|만|억|K|M|B)?/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const mult = { "천": 1e3, "만": 1e4, "억": 1e8, k: 1e3, m: 1e6, b: 1e9 }[
    (m[2] || "").toLowerCase()
  ] || 1;
  return Math.round(n * mult);
};

/**
 * 상대 시간("3일 전", "2 hours ago (edited)") → 추정 ISO 시각.
 * YouTube는 정확한 시각을 DOM에 주지 않으므로 근사값이다.
 */
WV.parseRelativeTime = function (raw, now = Date.now()) {
  if (!raw) return { approx: null, edited: false };
  const s = String(raw).trim();
  const edited = /수정됨|edited/i.test(s);
  const units = [
    [/(\d+)\s*(초|seconds?)/i, 1e3],
    [/(\d+)\s*(분|minutes?)/i, 60e3],
    [/(\d+)\s*(시간|hours?)/i, 3600e3],
    [/(\d+)\s*(일|days?)/i, 86400e3],
    [/(\d+)\s*(주|weeks?)/i, 7 * 86400e3],
    [/(\d+)\s*(개월|달|months?)/i, 30 * 86400e3],
    [/(\d+)\s*(년|years?)/i, 365 * 86400e3],
  ];
  for (const [re, ms] of units) {
    const m = s.match(re);
    if (m) return { approx: new Date(now - parseInt(m[1], 10) * ms).toISOString(), edited, unitMs: ms };
  }
  return { approx: null, edited };
};

/** 중첩 객체/배열에서 key 를 가진 값을 모두 찾는다 (YouTube 응답 구조가 자주 바뀌어 경로 대신 키로 탐색) */
WV.searchDict = function* (obj, key) {
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (Array.isArray(cur)) { for (let i = cur.length - 1; i >= 0; i--) stack.push(cur[i]); continue; }
    if (cur && typeof cur === "object") {
      const vals = [];
      for (const [k, v] of Object.entries(cur)) {
        if (k === key) yield v;
        else vals.push(v);
      }
      for (let i = vals.length - 1; i >= 0; i--) stack.push(vals[i]);
    }
  }
};
WV.first = (obj, key) => { for (const v of WV.searchDict(obj, key)) return v; return undefined; };

/**
 * YouTube 내부 API(youtubei/v1/next) 댓글 응답 파싱.
 * @returns {{comments, next, replies, total, error}}
 *   next: 다음 페이지 endpoint[], replies: 답글 스레드 endpoint[]
 */
WV.parseInnertubeComments = function (response, docId, { includeReplies = true, now = Date.now() } = {}) {
  const out = { comments: [], next: [], replies: [], total: null, error: null };
  out.error = WV.first(response, "externalErrorMessage") || null;

  const header = WV.first(response, "commentsHeaderRenderer");
  if (header?.countText) {
    const t = (header.countText.runs || []).map((r) => r.text).join("") || header.countText.simpleText || "";
    out.total = WV.parseCount((t.match(/[\d.,]+\s*(천|만|K|M)?/i) || [""])[0]);
  }

  const actions = [...WV.searchDict(response, "reloadContinuationItemsCommand"), ...WV.searchDict(response, "appendContinuationItemsAction")];
  for (const action of actions) {
    const target = action.targetId || "";
    for (const item of action.continuationItems || []) {
      if (/comments-section/.test(target)) {
        if (item.continuationItemRenderer) out.next.push(...WV.searchDict(item.continuationItemRenderer, "continuationEndpoint"));
        else if (includeReplies && item.commentThreadRenderer?.replies) out.replies.push(...WV.searchDict(item.commentThreadRenderer.replies, "continuationEndpoint"));
      } else if (includeReplies && target.startsWith("comment-replies-item") && item.continuationItemRenderer) {
        const btn = WV.first(item.continuationItemRenderer, "buttonRenderer");
        if (btn?.command) out.replies.push(btn.command);
        else out.replies.push(...WV.searchDict(item.continuationItemRenderer, "continuationEndpoint"));
      }
    }
  }

  const toolbarStates = new Map();
  for (const p of WV.searchDict(response, "engagementToolbarStateEntityPayload")) toolbarStates.set(p.key, p);

  for (const c of WV.searchDict(response, "commentEntityPayload")) {
    const p = c.properties || {}, a = c.author || {}, tb = c.toolbar || {};
    const cid = p.commentId;
    if (!cid) continue;
    const timeRaw = p.publishedTime || "";
    const t = WV.parseRelativeTime(timeRaw, now);
    const state = toolbarStates.get(p.toolbarStateKey) || {};
    out.comments.push({
      id: cid,
      docId,
      parentId: cid.includes(".") ? cid.split(".")[0] : null,
      author: a.displayName || "",
      authorId: a.channelId || null,
      text: p.content?.content || "",
      likes: WV.parseCount((tb.likeCountNotliked || "").trim()),
      createdAtRaw: timeRaw,
      createdAtApprox: t.approx,
      edited: t.edited,
      meta: {
        replyCount: WV.parseCount(tb.replyCount || ""),
        isCreator: !!a.isCreator,
        hearted: state.heartState === "TOOLBAR_HEART_STATE_HEARTED",
      },
    });
  }
  return out;
};

/** watch 페이지 HTML에서 ytcfg / ytInitialData 추출 */
WV.parseWatchHtml = function (html) {
  const cfg = {};
  for (const m of html.matchAll(/ytcfg\.set\s*\(\s*(\{.+?\})\s*\)\s*;/gs)) {
    try { Object.assign(cfg, JSON.parse(m[1])); } catch { /* 일부 블록은 JSON이 아님 */ }
  }
  let data = null;
  const m = html.match(/(?:window\s*\[\s*["']ytInitialData["']\s*\]|ytInitialData)\s*=\s*(\{.+?\})\s*;\s*(?:var\s+meta|<\/script|\n)/s);
  if (m) { try { data = JSON.parse(m[1]); } catch { data = null; } }
  return { cfg, data };
};

WV.text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
WV.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
