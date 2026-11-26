// 분석 Worker의 처리 부분 (lib/analysis-worker.js가 감싼다). Worker 없이도 불러 쓸 수 있어 node 테스트에서 직접 부른다.
// 받는 메시지
//   {type:"analyze", run, doc, comments, useSemantic, mode, keep?}  → status* → done | error (keep:false면 세밀도용 입력을 남기지 않음)
//   {type:"topics", run, key, v, data?}                       → topics | error(code "no-input"이면 data를 붙여 다시 보내면 된다)
// 보내는 메시지: {type:"status", run, text} / {type:"done", run, result} / {type:"topics", run, part} / {type:"error", run, message, code?}
// done의 result.lexVecs는 {flat, dim, n} (flat.buffer를 transfer로 넘긴다. 받는 쪽은 lib/pipeline.js viewVectors)
import { analyzeComments, topicsAt, flattenVectors } from "./pipeline.js";

const KEEP = 2; // 세밀도 바꾸기에 쓸 최근 분석 입력 수

export function createHandler({ loadSemantic = () => import("./embed/semantic.js") } = {}) {
  let semantic = null;
  const inputs = new Map(); // key → {n, graphEdges, short, texts}
  const remember = (key, data) => { inputs.delete(key); inputs.set(key, data); while (inputs.size > KEEP) inputs.delete(inputs.keys().next().value); };

  return async function handle(msg, post) {
    const { run } = msg;
    try {
      if (msg.type === "analyze") {
        const embed = async (texts, onStatus) => {
          semantic ||= await loadSemantic();
          const r = await semantic.semanticEmbed(texts, { model: msg.mode, onStatus });
          return { vecs: r.vecs, where: r.where, modelName: semantic.MODELS[r.model].name };
        };
        const A = await analyzeComments(msg, { embed, onStatus: (text) => post({ type: "status", run, text }), pause: async () => {} });
        // 세밀도 바꾸기에 쓰려고 입력을 남겨 둔다. keep:false(offscreen 분석: 세밀도는 패널이 따로 계산)면 남기지 않는다
        if (msg.keep !== false) remember(run, { n: msg.comments.length, graphEdges: A.graphEdges, short: A.short, texts: msg.comments.map((c) => c.text) });
        const lex = flattenVectors(A.lexVecs);
        post({ type: "done", run, result: { ...A, lexVecs: lex } }, [lex.flat.buffer]);
      } else if (msg.type === "topics") {
        if (msg.data) remember(msg.key, msg.data);
        const data = inputs.get(msg.key);
        if (!data) { post({ type: "error", run, code: "no-input", message: "분석 입력이 없어요" }); return; }
        post({ type: "topics", run, part: topicsAt(data, msg.v) });
      } else {
        post({ type: "error", run, message: `모르는 요청 ${msg.type}` });
      }
    } catch (e) {
      post({ type: "error", run, message: String(e?.message || e) });
    }
  };
}
