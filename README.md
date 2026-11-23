# Web Visualizer

웹 문서와 댓글을 **임베딩 → 유사도 그래프**로 시각화하는 크롬 확장입니다.
문서의 성격과 댓글의 주제 분포를 보고, 복붙·템플릿 댓글 같은 **의심 신호**와 자연스러운 반응을 구분해 볼 수 있습니다.

- **저장 없음**: 문서/댓글/임베딩은 사이드 패널 메모리에만 있고, 패널을 닫으면 사라집니다.
- **브라우저 안에서만 계산**: 댓글이 외부 서버로 전송되지 않습니다.
- 현재 지원: YouTube 영상 페이지

## 설치 (3단계, 1분)

1. **[web-visualizer.zip 다운로드](https://github.com/Spruce-tone/web_visualizer/releases/latest/download/web-visualizer.zip)** → 압축 풀기
2. 크롬 주소창에 `chrome://extensions` → 오른쪽 위 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드** → 풀린 `web-visualizer` 폴더 선택

툴바의 퍼즐 아이콘에서 Web Visualizer를 **고정(📌)** 해두면 편합니다.

**업데이트**: 위 링크에서 zip을 다시 받아 **같은 폴더에 덮어쓰기** → `chrome://extensions`에서 ↻ 새로고침.
(패널 제목 옆에 현재 버전이 표시됩니다.)

## 사용

1. YouTube 영상을 열고 확장 아이콘을 누르면 오른쪽에 패널이 열립니다.
2. **댓글 모아서 분석**을 누르면 스크롤 없이 댓글과 답글을 자동으로 모읍니다 (최대 개수, 인기순/최신순, 답글 포함 여부 선택. 진행 상황이 보이고 중지할 수 있어요).
3. 처음 의미 분석을 할 때만 모델을 내려받습니다. 이후에는 브라우저 캐시로 바로 실행됩니다.
4. **크게 보기**를 누르면 새 탭에 넓은 화면으로 열리고, 지도 옆에 주제 키워드 목록이 나란히 보입니다. 패널의 분석 결과가 그대로 넘어갑니다.

### 댓글 지도
- 점 = 댓글, 고리(속이 빈 점) = 답글, 점선 = 답글과 원댓글 연결, 크기 = 좋아요, 색 = 주제, 주황 테 = 복붙 의심, 흰 점 = 영상 본문
- 주제 키워드가 지도 위 각 묶음 자리에 표시됩니다 ("키워드" 토글)
- "댓글+답글 / 댓글만 / 답글만"으로 골라 볼 수 있습니다
- **점 클릭**: 댓글 내용이 열립니다 → **페이지에서 이 댓글 보기**로 실제 위치로 이동 (아직 화면에 없는 댓글이면 그 댓글이 댓글 맨 위에 오도록 영상을 다시 엽니다) 또는 새 탭으로 열기
- **점 드래그**: 옮긴 자리에 고정, 이웃이 따라옴. 더블클릭하면 풀림. 기준값을 바꿔도 손으로 옮긴 배치는 유지됩니다
- **Shift+드래그**: 영역 선택, **Shift+클릭**: 하나씩 추가, **Esc**: 해제

### 주제를 얼마나 잘게 나눌지
- 추천값 4단계(넓게 / 보통 / 세밀하게 / 아주 세밀하게): 그 영상의 댓글 분포에 맞춰 자동 계산
- 슬라이더로 직접 조절하거나, **주제 수로 맞추기**(− / +)로 원하는 개수에 가깝게

### 내 분류
- 분류는 1~9개까지 추가·삭제·이름 변경 가능
- 점을 고르고 분류 버튼(또는 숫자키)을 누르면 담깁니다. 목록에서 주제·의심 묶음·작성자를 누르면 그 댓글들이 한꺼번에 선택됩니다
- 분류는 메모리에만 있고, JSON 내려받기에 함께 담깁니다

### 목록 (탭)
- **주제**: 키워드, 댓글·답글 수, 대표 댓글
- **복붙 의심**: 점수(0~100)와 근거. 판정 방식은 [docs/signals.md](docs/signals.md)
- **작성자**: 이 영상에 3개 이상 쓴 사람
- **시간**: 작성 시각 분포

## 어떻게 분석하나

| 역할 | 방법 |
|---|---|
| 복붙·템플릿 의심 신호 | 문자 n-gram 해싱 (모델 없음, 즉시). 글자가 그대로 겹치는지를 봐야 정확함 |
| 지도 배치 · 주제 묶음 | 의미 임베딩 모델 (아래) |
| 주제 키워드 | 묶음별 c-TF-IDF (조사는 말뭉치에 근거가 있을 때만 뗌) |

의미 모델은 브라우저 안에서만 돌고 댓글을 기기 밖으로 보내지 않습니다. GPU(WebGPU)가 있으면 GPU로, 없으면 CPU 멀티스레드로 실행합니다.

| 선택지 | 모델 | 특징 |
|---|---|---|
| 자동 (기본) | GPU 있음 → EmbeddingGemma, 없음 → Bekko | 기기에 맞게 고름 |
| 가벼움 | Bekko a25m (MIT) | CPU에서 빠름, 약 190MB |
| 균형 | EmbeddingGemma-300M | 정확도 높음, CPU에서도 동작 |
| 고성능 | Qwen3-Embedding-0.6B | GPU 권장 |
| 문구만 | 없음 | 즉시, 표현이 다른 같은 뜻은 못 묶음 |

글꼴은 [Pretendard](https://github.com/orioncactus/pretendard) (SIL Open Font License 1.1)를 zip에 함께 넣습니다.

## 개발

```bash
git clone https://github.com/Spruce-tone/web_visualizer
cd web_visualizer
npm install --ignore-scripts && npm run vendor   # 의미 모델용 Transformers.js 를 vendor/ 로 복사 (MV3는 CDN 코드 금지)
npm test
```
이 폴더를 바로 "압축해제된 확장 프로그램"으로 로드해 개발할 수 있습니다.
`main`에 푸시하면 GitHub Actions가 테스트 → 번들 → zip을 만들어 Releases(`latest-build`)에 올립니다.

```
manifest.json            MV3 설정
content/youtube.js       YouTube 어댑터 (DOM 선택자는 여기에만)
lib/embed/hash.js        문구 임베딩 (feature hashing TF-IDF)
lib/embed/semantic.js    의미 임베딩 (EmbeddingGemma)
lib/vec.js               top-k 이웃, 간선, 묶음, PCA, 적응형 임계값
lib/layout.js            force-directed 레이아웃
lib/analyze.js           의심 신호, 주제 요약, 시간 분포
lib/keywords.js          주제 키워드 (c-TF-IDF)
sidepanel/               UI (graph.js = 캔버스 지도). 사이드 패널 겸 '크게 보기' 탭
.github/workflows/       자동 zip 빌드
```

## 한계
- 작성 시각은 "3일 전" 같은 상대시간 기반 근사값
- 답글은 페이지에서 펼쳐진 것만 수집
- YouTube DOM 개편 시 `content/youtube.js`의 `SEL` 수정 필요
