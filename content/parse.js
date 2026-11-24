// 공통 파싱 유틸. 사이트 어댑터들이 공유한다.
// 전역에는 __wvParse 하나만 둔다: 이 파일은 페이지(메인 월드)에도 들어가므로(page-bridge.js가 findCommentToken을 씀)
// 페이지 자체 코드의 전역(예: WV)과 부딪히지 않게 이름을 드물게 하고, 나머지는 함수 안에 가둔다.
(() => {
const WV = (globalThis.__wvParse = globalThis.__wvParse || {});

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
  const out = { comments: [], next: [], replies: [], threads: [], total: null, error: null };
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
        else if (item.commentThreadRenderer) {
          const tr = item.commentThreadRenderer;
          const eps = includeReplies && tr.replies ? [...WV.searchDict(tr.replies, "continuationEndpoint")] : [];
          out.replies.push(...eps);
          // 스레드별 답글 주소 (무작위 추출 때 뽑힌 스레드의 답글만 받으려고)
          out.threads.push({ id: WV.first(tr.commentViewModel || tr, "commentId") || null, endpoints: eps });
        }
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

/** 씨앗 문자열로 정해지는 섞기 (같은 영상·같은 후보면 항상 같은 표본 → 결과 재현 가능) */
WV.seededShuffle = function (arr, seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  let a = h >>> 0;
  const rand = () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
};

/** 무작위 추출 후보 수: 뽑을 수의 3배(최소 600, 최대 20,000). 후보 안에서는 균등 추출이다. */
WV.poolLimit = (max) => Math.min(20000, Math.max(max * 3, 600));

/** 다시 시도할 만한 실패인가: 요청 제한(429)·서버 오류(5xx)·네트워크 오류(상태 없음) */
WV.retryable = (e) => !e?.status || e.status === 429 || e.status >= 500;

/**
 * 실패하면 물러났다가(0.8초, 1.6초, 3.2초) 다시 시도한다. 다시 시도할 수 없는 실패(예: 403)는 바로 던진다.
 * stop()이 참이면(중지, 다른 요청이 끝내 막힘) 다시 시도하지 않고 던진다 — 쉬는 동안 참이 되어도 깨어나서 보내지 않는다.
 * @param {() => Promise<any>} fn
 * @param {{tries?: number, baseMs?: number, sleep?: (ms:number)=>Promise<void>, onRetry?: (e:any)=>void, stop?: () => boolean}} [o]
 */
WV.withBackoff = async function (fn, { tries = 4, baseMs = 800, sleep = WV.sleep, onRetry, stop = () => false } = {}) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (i >= tries - 1 || !WV.retryable(e) || stop()) throw e;
      onRetry?.(e);
      await sleep(baseMs * 2 ** i);
      if (stop()) throw e;
    }
  }
};

/**
 * 고르게 무작위 추출 (사이트 요청은 page가 한다 → 테스트에서는 가짜 page로 돌린다).
 * 1) 최신순(좋아요와 무관한 순서)으로 원댓글 후보를 poolLimit개까지 훑는다. 다음 쪽 주소가 앞 쪽 응답에 있으므로 이 사슬은 차례로만 받을 수 있다.
 * 2) 씨앗이 정해진 섞기로 후보 순서를 정하고, 그 순서대로 원댓글과 답글을 max개까지 담는다.
 *    답글은 스레드마다 따로 받으므로 동시에 concurrency개까지 받는다. 담는 순서는 섞은 순서 그대로라 결과는 동시 요청과 상관없이 같다.
 * - 서버 부담: 모든 요청의 시작 간격을 minGapMs 이상으로 둔다. 다시 시도할 실패(429·5xx)가 한 번이라도 나면 동시 요청을 1개로 줄이고 물러난다.
 *   물러났다 다시 해도 끝내 막히면(limited) 남은 요청을 모두 멈추고 그때까지 담은 것으로 끝낸다(다음 스레드에서 또 두드리지 않게).
 * @param {object} o
 * @param {any} o.start 최신순 정렬의 첫 endpoint
 * @param {(endpoint:any, replies:boolean) => Promise<{comments:any[], next:any[], replies:any[], threads:{id:string,endpoints:any[]}[], total:number|null, error:string|null}>} o.page
 * @param {number} o.max
 * @param {string} o.seed
 * @param {boolean} [o.includeReplies]
 * @param {number} [o.concurrency] 답글 동시 요청 수 (2~3 권장)
 * @param {number} [o.minGapMs] 요청 시작 사이 최소 간격
 * @param {(count:number, total:number|null, phase:string)=>void} [o.onProgress]
 * @param {() => boolean} [o.isCancelled]
 * @param {(ms:number)=>Promise<void>} [o.sleep]
 * @param {{tries?: number, baseMs?: number}} [o.backoff]
 */
WV.sampleRandom = async function ({ start, page, max, seed, includeReplies = true, concurrency = 3, minGapMs = 100, onProgress, isCancelled = () => false, sleep = WV.sleep, backoff = {} }) {
  let lanes = Math.max(1, concurrency);
  // 시작 간격 맞추기: 기다리는 요청들을 한 줄로 세워, 앞 요청이 실제로 나간 시각에서 minGapMs를 잰다(타이머가 한꺼번에 깨어나도 몰리지 않게)
  let gate = Promise.resolve(), last = -Infinity;
  const spaced = () => (gate = gate.then(async () => {
    const w = last + minGapMs - Date.now();
    if (w > 0) await sleep(w);
    last = Date.now();
  }));
  // 막힘 판단은 모든 요청이 함께 센다: 성공 없이 다시 시도할 실패가 tries번 이어지면 limited → 더 보내지 않는다
  // (동시에 나간 요청들이 저마다 4번씩 두드리지 않게. 막힌 뒤 나가는 요청은 이미 나가 있던 lanes-1개뿐)
  const tries = backoff.tries ?? 4;
  let limited = false, strikes = 0;
  const call = (ep, replies) => WV.withBackoff(async () => {
    await spaced();
    if (limited || isCancelled()) throw Object.assign(new Error("멈춤"), { status: 0, stopped: true });
    try { const r = await page(ep, replies); strikes = 0; return r; }
    catch (e) { if (WV.retryable(e) && ++strikes >= tries) limited = true; throw e; }
  }, { ...backoff, sleep, onRetry: () => { lanes = 1; }, stop: () => limited || isCancelled() });

  const limit = WV.poolLimit(max);
  const cand = [], seenTop = new Set(), threadEps = new Map();
  let total = null, scanOk = true;
  const queue = [start];
  while (queue.length && cand.length < limit && !isCancelled()) {
    let r;
    try { r = await call(queue.shift(), false); }
    catch (e) { if (!cand.length && !e.stopped) throw e; scanOk = false; break; } // 후보가 있으면 거기까지로 뽑는다(막힘이면 call이 limited를 켰다)
    if (r.error && !cand.length) throw new Error(r.error);
    if (r.total) total = r.total;
    for (const c of r.comments) if (!c.parentId && !seenTop.has(c.id)) { seenTop.add(c.id); cand.push(c); }
    for (const t of r.threads) if (t.id && t.endpoints.length) threadEps.set(t.id, t.endpoints);
    queue.push(...r.next);
    onProgress?.(cand.length, total, "후보 확인");
  }
  const pool = { size: cand.length, limit, complete: scanOk && !queue.length && !isCancelled() };

  // 후보를 훑다 막혔으면(limited) 더 요청하지 않고 모은 후보 안에서 원댓글만 담는다(답글 없이). 답글을 받다 막히면 그 자리에서 멈춘다.
  const scanLimited = limited;
  const withReplies = includeReplies && !scanLimited;
  const order = WV.seededShuffle(cand, seed);
  const comments = [], seen = new Set();
  let repliesOk = true, filled = false;
  // 한 스레드의 답글: 그 스레드 안에서는 '답글 더보기'가 사슬이라 차례로 받는다. budget개를 넘으면 멈춘다.
  const fetchThread = async (eps, budget) => {
    const rq = [...eps], out = [];
    try {
      while (rq.length && out.length < budget && !filled && !limited && !isCancelled()) {
        const r = await call(rq.shift(), true);
        for (const c of r.comments) if (c.parentId) out.push(c);
        rq.push(...r.replies);
      }
    } catch {
      repliesOk = false; // 403 같은 실패면 이 스레드의 답글만 빠진다. 막힘(limited)은 call이 켜고, 그러면 아래에서 모두 멈춘다
    }
    return out;
  };
  const jobs = new Map(); // 섞은 순서 위치 → 답글 Promise
  let ahead = 0;
  const launch = (k) => {
    // 앞으로 담을 스레드의 답글을 미리 받는다. 담기 전 것만 lanes개까지 → 끝에서 버리는 요청은 lanes-1개 이하
    ahead = Math.max(ahead, k);
    while (jobs.size < lanes && ahead < order.length) {
      const eps = withReplies ? threadEps.get(order[ahead].id) : null;
      if (eps) jobs.set(ahead, fetchThread(eps, max - comments.length));
      ahead++;
    }
  };
  for (let k = 0; k < order.length && comments.length < max && !(limited && !scanLimited) && !isCancelled(); k++) {
    launch(k);
    const top = order[k];
    if (!seen.has(top.id)) { seen.add(top.id); comments.push(top); }
    if (jobs.has(k)) {
      const replies = await jobs.get(k);
      jobs.delete(k);
      for (const c of replies) if (!seen.has(c.id) && comments.length < max) { seen.add(c.id); comments.push(c); }
      onProgress?.(comments.length, total, "답글 받는 중");
    }
  }
  filled = true; // 다 담았으면 미리 받던 답글 사슬은 지금 요청까지만
  // 답글을 받다 limited가 되면 막힌 스레드(받은 답글까지)에서 멈추고 그 뒤 원댓글은 담지 않는다 — 답글 없는 원댓글만 이어 붙여 답글 비율이 틀어지지 않게
  // noReplies: 답글을 원했지만 후보 단계에서 막혀 답글을 하나도 받지 않았다 (패널이 그렇다고 알려 준다)
  return { comments, total, pool, limited, noReplies: includeReplies && scanLimited, complete: pool.complete && repliesOk && !limited && !isCancelled() };
};

/** YouTube가 '하이라이트 댓글'로 이동할 때 쓰는 params: protobuf { 15: 댓글 id, 36: { 24: 0 } } 를 base64 → URL 인코딩 (실제 페이지 값과 일치 확인) */
WV.linkedCommentParams = function (id) {
  const bytes = [122, id.length, ...[...id].map((c) => c.charCodeAt(0)), 162, 2, 3, 192, 1, 0];
  return encodeURIComponent(btoa(String.fromCharCode(...bytes)));
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

/** watch 페이지 HTML에서 제목·채널·설명 (화면의 DOM은 영상을 옮긴 직후 이전 영상 값이 남아 있을 수 있어 HTML을 우선한다) */
WV.parseWatchMeta = function (html) {
  const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const meta = (name) => { const m = html.match(new RegExp(`<meta name="${name}" content="([^"]*)"`)); return m ? unesc(m[1]) : null; };
  let description = null;
  const d = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
  if (d) { try { description = JSON.parse(`"${d[1]}"`); } catch { description = null; } }
  const ch = html.match(/<link itemprop="name" content="([^"]*)"/);
  return { title: meta("title"), channel: ch ? unesc(ch[1]) : null, description: description ?? meta("description") };
};

/**
 * /youtubei/v1/next 응답에서 댓글 목록 이어보기 토큰을 고른다 (page-bridge.js가 메인 월드에서 쓴다).
 * 응답에는 토큰이 둘 있다: 영상 아래 댓글(itemSectionRenderer.targetId "comments-section", 하이라이트할 댓글 id가 들어 있음)과
 * 넓은 화면에서 숨어 있는 댓글 패널(engagement-panel-comments-section 안의 sectionIdentifier "comment-item-section").
 * 숨은 패널 토큰을 쓰면 결과가 안 보이는 곳에 그려지므로 앞의 것을 우선하고, 없을 때만 뒤의 것을 쓴다.
 */
WV.findCommentToken = function (obj) {
  const found = [];
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (Array.isArray(cur)) { for (const x of cur) stack.push(x); continue; }
    if (!cur || typeof cur !== "object") continue;
    const sec = cur.itemSectionRenderer;
    if (sec && (sec.sectionIdentifier === "comment-item-section" || sec.targetId === "comments-section")) {
      const inner = [sec];
      while (inner.length) {
        const c = inner.pop();
        if (Array.isArray(c)) { for (const x of c) inner.push(x); continue; }
        if (!c || typeof c !== "object") continue;
        const t = c.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
        if (t) { found.push({ t, main: sec.targetId === "comments-section" }); break; }
        for (const v of Object.values(c)) inner.push(v);
      }
    }
    for (const v of Object.values(cur)) stack.push(v);
  }
  return (found.find((f) => f.main) || found[0])?.t || null;
};

WV.text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
WV.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
})();
