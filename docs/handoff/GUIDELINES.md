# 지침 — web_visualizer (모든 에이전트 공통)

레포의 `CLAUDE.md`가 기준 문서다. 이 지침은 그 요약 + 인계 시점의 상태다. 충돌하면 `CLAUDE.md`를 따른다.

## 1. 기본 정보
- 레포: https://github.com/Spruce-tone/web_visualizer (main)
- 설치용 zip(항상 최신): https://github.com/Spruce-tone/web_visualizer/releases/latest/download/web-visualizer.zip
  - main에 push하면 GitHub Actions가 테스트 → Transformers.js·글꼴 vendor 복사 → zip → `latest-build` 릴리스에 올린다.
- 로컬 개발: `npm install --ignore-scripts && npm run vendor && npm test`
  - 이 폴더를 `chrome://extensions`(또는 `edge://extensions`) → 개발자 모드 → "압축해제된 확장 프로그램을 로드"로 바로 쓸 수 있다.
  - 코드를 바꾸면 확장 새로고침(↻) **그리고 YouTube 탭도 새로고침**해야 페이지 쪽 코드가 바뀐다.
- 현재 버전: v0.8.0

## 2. 절대 규칙
1. **저장하지 않는다.** 댓글·임베딩·분석 결과는 패널 메모리에만. storage 권한, IndexedDB 금지. (모델 가중치의 브라우저 캐시만 예외)
2. **객관성.** 의심 점수 항목은 행동·구조만(문구 겹침, 작성자 수, 반복, 시간 몰림). 어조·주장·대상은 점수와 지도 배치에 넣지 않는다. 평가 표현 사전에 인물·정당·국가 이름을 넣지 않는다. 새 신호는 점수 = `parts[]` 합, 근거 부족 시 "판단 보류", 자연 반복 고려, 바꿔 넣기 테스트 추가. 자세히: `docs/objectivity.md`
3. **"조작"이라고 판정하지 않는다.** "의심 신호 점수 + 근거"로만 표시.
4. **MV3: 원격 코드 금지.** 외부 라이브러리는 `vendor/`로 복사해 번들.
5. 작성자 이름은 기본 가림. 출신·국적·정치 성향 추정 금지.
6. 가중치를 특정 영상에 맞추지 않는다. 바꾸려면 `fixtures/` 검증 세트 + `npm run evaluate`.
7. 패널 스크립트를 고치면 `tests/panel-smoke.mjs` 통과 필수. lib 함수를 추가하면 `tests/run.mjs`에 테스트.

## 3. 구조
```
content/youtube.js       수집(무작위 추출 포함), 댓글 열기, 메시지 처리 (isolated world)
content/page-bridge.js   페이지(MAIN world) 다리: 댓글 영역만 다시 불러와 원하는 댓글을 띄움
content/parse.js         YouTube 응답·시간·숫자 파싱
lib/embed/hash.js        문구 임베딩 (복붙 신호용)
lib/embed/semantic.js    의미 임베딩 (Transformers.js: 자동 GPU→EmbeddingGemma, CPU→Bekko / 선택 Qwen3)
lib/vec.js               이웃 찾기, PCA, 평균 빼기
lib/umap.js              첫 배치 (UMAP 방식)
lib/community.js         SNN 그래프 + Louvain 주제 묶기
lib/layout.js            힘 배치 (이웃 선 + 주제 응집), 고정, 주제 통째 이동
lib/keywords.js          주제 키워드 (낱말+두 낱말, c-TF-IDF, 흔한 낱말 제외)
lib/signals.js, authors.js, patterns.js, tone.js, weights.js   의심 신호·작성자·패턴·평가표현(설명용)·가중치
sidepanel/               화면 (graph.js = 캔버스 그래프). 사이드 패널 겸 '크게 보기' 탭(?tab=<id>)
tests/                   run.mjs(계산·객관성), panel-smoke.mjs(패널 흐름, 가짜 DOM)
docs/                    objectivity.md, signals.md(참고 논문: KAIST USENIX Security 2026)
```

## 4. 실제 브라우저에서 확인된 사실 (Edge + Claude in Chrome, 2026-11-24)
- YouTube 내부 API로 댓글·답글 수집: 응답 구조 일치.
- **댓글 열기 기본 방식**(page-bridge `wv-show-comment`): `/youtubei/v1/next`에 `{videoId, params(댓글 id)}` → 댓글 섹션 토큰 → 정렬 버튼(yt-sort-filter-sub-menu-renderer)에 `yt-service-request`로 전달. 원댓글 약 1초, 답글 약 1.6초, 영상 계속 재생, 광고 없음. **단, 페이지에서 같은 코드를 직접 실행해 확인한 것이고 확장 안에서 끝까지 돈 적은 없다.**
- `yt-navigate`(예비): 새로고침은 없지만 영상이 처음부터 다시 재생되고 광고가 뜰 수 있다.
- 주소 변경 + popstate: 페이지 전체 새로고침 → 쓰지 않는다.
- Claude in Chrome은 Vivaldi에서 탭 그룹 문제로 동작하지 않고 Edge에서는 동작했다.

## 5. 확인 못 한 것 / 열린 문제 (우선순위 순)
1. **댓글 찾기가 사용자 환경(Vivaldi)에서 안 된다는 보고.** v0.8에서 원인 후보(업데이트 전 열린 탭에 page-bridge 없음)를 고쳤지만 확장 안에서 검증 안 됨. 실패 시 버튼 아래 문구와 `[코드]`(no-menu / no-config / no-token / timeout / error)를 받아 단계를 특정할 것.
2. **확장 화면(지도·주제·키워드) 실제 모습을 아무도 본 적 없다** (v0.6 이후). 사용자 스크린샷만 있음.
3. **의미 모델 경로(Transformers.js) 실제 로딩·속도 미검증.** WebGPU/WASM, 멀티스레드(COOP/COEP) 적용 여부, Bekko의 한국어 품질.
4. 주제 묶기·키워드 품질을 실제 한국어 댓글로 평가한 적 없음 (합성 데이터 테스트만). 사용자 불만: "같은 키워드(민주당)인데 둘로 갈림", "성향을 잘 대변하는 키워드".
5. 1,000개 이상에서 느림 → Web Worker 분리.
6. `fixtures/` 검증 세트(분류별 영상 5개씩) 수집과 `npm run evaluate` 미실시. 공개 데이터 보정(`npm run calibrate`) 미실시.

## 6. 보고 형식 (사용자에게)
- 한국어, 결론 먼저, 짧은 문장, 굵게는 핵심만.
- 반드시 구분: **바뀐 것 / 실제로 확인한 것 / 확인 못 한 것 / 사용자가 할 일**.
- 설치 안내가 필요하면: zip 받기 → 덮어쓰기 → 확장 새로고침(↻) → **YouTube 탭 새로고침**.

## 7. 커밋 규칙
- 한 커밋 = 한 목적. 영어 제목 한 줄 + 본문 요약.
- 버전은 `manifest.json`과 `package.json`을 함께 올린다.
- `CLAUDE.md`의 마일스톤 목록을 갱신한다.
