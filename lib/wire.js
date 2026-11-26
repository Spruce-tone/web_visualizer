// 확장 메시지(chrome.runtime)는 JSON으로 오간다. Int32Array·Float32Array 같은 형식 배열은 JSON에서 깨지므로
// {__ta: 이름, b64} 로 바꿔 보내고 받는 쪽에서 되돌린다. Map·Set도 JSON에서 비므로 {__map}, {__set}으로.
// offscreen 문서 ↔ 패널 사이 분석 결과에 쓴다.
const TYPES = { Int8Array, Uint8Array, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array };

function b64(view) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function unb64(s, Type) {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Type(bytes.buffer);
}

export function toWire(v) {
  if (ArrayBuffer.isView(v) && TYPES[v.constructor.name]) return { __ta: v.constructor.name, b64: b64(v) };
  if (v instanceof Map) return { __map: [...v].map(([k, x]) => [toWire(k), toWire(x)]) };
  if (v instanceof Set) return { __set: [...v].map(toWire) };
  if (Array.isArray(v)) return v.map(toWire);
  if (v && typeof v === "object") { const o = {}; for (const k in v) o[k] = toWire(v[k]); return o; }
  return v;
}
export function fromWire(v) {
  if (Array.isArray(v)) return v.map(fromWire);
  if (v && typeof v === "object") {
    if (typeof v.__ta === "string" && TYPES[v.__ta]) return unb64(v.b64, TYPES[v.__ta]);
    if (Array.isArray(v.__map)) return new Map(v.__map.map(([k, x]) => [fromWire(k), fromWire(x)]));
    if (Array.isArray(v.__set)) return new Set(v.__set.map(fromWire));
    const o = {}; for (const k in v) o[k] = fromWire(v[k]); return o;
  }
  return v;
}
