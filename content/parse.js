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

WV.text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
WV.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
