# CLAUDE.md — web_visualizer

## 목표
웹 문서(YouTube, 구글 문서, 커뮤니티)와 댓글을 시각화해 문서 성격 파악 + 댓글 조작 의심 신호와 실제 반응 구분. 옵시디언 그래프 뷰의 웹 버전.

## 방향 (2026-11-24 결정)
- **저장하지 않는다.** 문서/댓글/임베딩은 사이드 패널 메모리에만. IndexedDB·storage 권한 쓰지 않음.
- **임베딩 우선, 속도 우선.** 임계값 변경 등 UI 조작은 임베딩 재계산 없이 캐시된 top-k 이웃으로 처리.
- **역할 분리 (v0.2)**: 문구 임베딩(n-gram 해싱) = 복붙·템플릿 의심 신호 / 의미 임베딩(자동: GPU → EmbeddingGemma-300M, CPU → Bekko a25m / 선택 Qwen3-Embedding-0.6B) = 지도 배치·주제 묶음. 의미 모델 실패 시 문구 임베딩으로 대체.
- 의미 유사도 임계값은 모델 분포에 맞춰 적응형(`adaptiveThreshold`)으로 기본값 설정.
- **설치는 릴리스 zip 하나로.** main 푸시 → GitHub Actions가 vendor 포함 zip을 `latest-build` 릴리스에 올림.

## 현재 마일스톤
- M0 ✅ MV3 확장, 사이드 패널, YouTube 댓글 추출
- M1 ✅ 임베딩 → top-k 이웃 → 유사 묶음 + 의심 신호 + force 그래프, 클릭 → 원문 이동
- M2 ✅ v0.2: 의미 임베딩, 역할 분리, 자동 zip 빌드
- M2.5 ✅ v0.3: 전체 댓글 자동 수집(InnerTube), Qwen3-Embedding 기본, 옵시디언식 수동 배치·분류(고정/다중선택/분류 1~4), 근거에 공통 표현, 작성자 활동
- v0.4 ✅ CPU용 경량 모델(Bekko)+wasm 멀티스레드(COOP/COEP), UI 재디자인(Pretendard, 어두운 지도, 탭, 크게 보기 탭), 주제 키워드, 추천 기준값·주제 수 맞추기, 댓글 상세 카드·실제 위치로 이동, 분류 1~9개 추가/삭제, 댓글/답글 구분(고리·점선·필터)
- v0.5 ✅ 객관성 기준(docs/objectivity.md) 적용: 점수는 행동·구조만, 자연 반복 거르기, 판단 보류, 점수 분해, 바꿔 넣기 테스트 / 작성자 지도·작성자 신호 / 다른 패턴(같은 주장 다른 표현, 몰림, 함께 쓴 작성자, 영상 간 교차) / 평가 표현(설명용) / 점수 기준 프로필(기본·공개 데이터 보정 선택) / 새로고침 없는 댓글 이동(자동 펼침) / 밝은 지도 / 영상 전환 안내
- v0.6~0.7 ✅ 고르게 무작위 추출 / 댓글 열기: 페이지 쪽 다리(page-bridge.js)가 댓글 영역만 다시 불러옴(실제 페이지에서 검증: 1~2초, 영상 계속 재생) / 연속 지도(lib/umap.js) + 커뮤니티 주제(lib/community.js), 가르는 키워드, 같은 키워드 묶음 합치기 / 지도 그리기 최적화, 키워드 끌기 / 보기 설정 메뉴
- v0.8 ✅ 보기를 옵시디언식 연결 그래프로 되돌림(UMAP 첫 배치 + 힘 배치 + 주제 응집, v0.7의 번짐 지도·보기 설정 메뉴 폐기) / 주제: SNN 그래프 + Louvain / 키워드: 두 낱말 묶음, 흔한 낱말 제외 / 댓글 열기 전 페이지 다리를 매번 주입(업데이트 전 열린 탭 대응)
- v0.8.1 ✅ 댓글 열기 실제 확인(Edge, 확장 안에서 끝까지): 숨은 댓글 패널(engagement panel) 토큰 대신 영상 아래 댓글(`comments-section`) 토큰을 쓰고, 화면에 보이는 댓글만 찾음(거짓 성공 방지). 다리 이벤트 이름에 판(v2)을 붙여 업데이트 전 열린 탭의 옛 다리가 답하지 않게 함
- v0.9 ✅ 주제별 댓글 목록(오른쪽 열 위, 보이는 줄만 그림) ↔ 지도 점 서로 이동(점 클릭 → 목록 스크롤·강조, 목록 클릭 → 지도 가운데로) / 겹침 분류: 주 주제는 그대로, SNN 이웃 연결만으로 보조 주제 최대 2개(`lib/community.js` overlapTopics). 목록 칩·지도 점선 테. 키워드는 주 주제 기준 유지
- v0.9.1 ✅ 키워드 품질: 큰 주제도 키워드(최소 빈도 16개 이하 2번, 그 위 max(3, 3%) + 초기하 z≥1.96 + 2배 이상 또는 쏠림 0.4, z 순), 근거 없는 주제는 이름을 비움("주제 N"), 흔한 어미·복수 떼기, 답글 @아이디 제외 / 같은 키워드 주제 합치기를 `lib/community.js` `mergeSameKeywordTopics`로(앞 두 키워드 같으면, 첫 키워드만 같으면 SNN 연결비 ≥ 세밀도×0.5), 겹침은 합친 뒤 계산 / 합성 한국어 댓글 자료 `tests/ko-topics.mjs`
- 다음: fixtures 검증 세트 수집 후 `npm run evaluate`, 실제 공개 데이터로 보정 실행, Web Worker 분리
- M3 사이트 어댑터 추가 (네이버 뉴스, 커뮤니티 1곳, 일반 기사)

## 참고
- 댓글 열기 순서: 화면에 있음 → `wv-show-comment`(댓글 영역만 다시 불러오기, 기본) → `wv-navigate`(YouTube 내부 이동, 광고 위험) → 패널의 MAIN world 실행 → 스크롤 탐색. 주소를 바꿔 popstate를 쏘는 방법은 전체 새로고침이 되므로 쓰지 않는다.
- 개발·점검: 영상 주소 끝에 `#wv-dev-open` 을 붙이면 '크게 보기'가 같은 탭 묶음에 열린다 (자동화 도구로 화면 점검용).
- 주제는 k-평균(lib/cluster.js)에서 커뮤니티로 바꿨다. k-평균은 이웃 찾기의 구역 나누기에만 쓴다.
- 객관성 기준: `docs/objectivity.md` / 신호 계산·참고 연구: `docs/signals.md`
- 로컬 오케스트레이터 인계 자료: `docs/handoff/` (SOUL.md, GUIDELINES.md, FIRST_PROMPT.md)
- YouTube 전체 수집: `content/youtube.js` `collectAll` (watch HTML의 ytcfg/ytInitialData → youtubei/v1/next continuation). 응답 파서는 `content/parse.js` `parseInnertubeComments` (테스트 있음)

## 객관성 (가장 우선하는 규칙)
- 의심 점수 항목에 어조·주장·대상을 넣지 않는다. 행동·구조만 (`lib/weights.js`).
- 평가 표현 사전(`lib/tone.js`)에는 인물·정당·국가 이름이나 특정 대상 전용 멸칭을 넣지 않는다.
- 새 신호를 만들면: 점수는 `parts[]`의 합, 근거 부족 시 보류, 자연 반복 고려, 바꿔 넣기 테스트 추가.
- 가중치를 특정 영상에 맞추지 않는다. 바꾸려면 fixtures 검증 세트로.
- 작성자 이름은 기본 가림, 출신·성향 추정 금지.

## UI 원칙
- 패널은 밝고 조용하게. 지도는 밝은 배경 기본(어둡게 전환 가능). 글꼴 Pretendard(OFL, vendor/fonts). 색·간격 토큰은 `sidepanel.css` `:root`.
- 문구는 사용자 입장의 쉬운 말. 버튼 이름은 누르면 일어나는 일 그대로.
- `sidepanel.html`은 사이드 패널과 '크게 보기' 탭(`?tab=<id>`) 겸용. 820px 이상이면 지도 | 목록 2단.

## 규칙
- 사이트별 코드는 `content/<site>.js` 어댑터에만. 출력은 공통 스키마(Doc, Comment[]).
- 분석/임베딩은 `lib/` 에서 사이트 무관하게. 새 함수에는 `tests/run.mjs`에 테스트 추가. 패널 스크립트를 고치면 `tests/panel-smoke.mjs`가 통과해야 한다.
- "조작" 판정 문구 금지 → "의심 신호 점수 + 근거"로 표시.
- 원격 코드 로드 금지(MV3). 외부 라이브러리는 `vendor/`로 복사해 번들.
- 실제 사이트 대신 `fixtures/*.json` 으로 분석 개발.

## 공통 스키마
Doc { id, site, url, title, author, publishedAt, text, meta, extractedAt }
Comment { id, docId, parentId, author, authorId, text, likes, createdAtRaw, createdAtApprox, edited, meta }
