// 패널 분석을 화면과 다른 스레드에서 돌리는 Worker (module). 패널이 같은 확장 안의 이 파일로 만든다(원격 코드 없음).
// 처리 내용은 lib/worker-core.js, 계산은 lib/pipeline.js.
import { createHandler } from "./worker-core.js";

const handle = createHandler();
self.onmessage = (e) => handle(e.data, (m, transfer) => self.postMessage(m, transfer || []));
