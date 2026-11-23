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

1. YouTube 영상을 열고 확장 아이콘 클릭 → 오른쪽에 사이드 패널
2. **보이는 댓글 분석** 또는 **더 불러와 분석**(자동 스크롤)
3. 처음 의미 분석을 할 때만 모델(EmbeddingGemma)을 내려받습니다. 이후에는 브라우저 캐시로 바로 실행됩니다.

화면 보는 법:
- **그래프**: 점 = 댓글, 크기 = 좋아요, 색 = 주제 묶음, 주황 테두리 = 복붙 의심 신호, 가운데 = 본문. 드래그·휠로 이동/확대, 점 클릭 → 페이지의 해당 댓글로 스크롤
- **주제 묶음**: 의미가 비슷한 댓글 묶음과 대표 댓글, 본문 관련도
- **복붙·템플릿 의심 신호**: 문구가 겹치는 묶음의 점수(0~100)와 근거. 판정이 아닌 참고 지표입니다
- 두 슬라이더는 임베딩을 다시 계산하지 않고 즉시 반영됩니다

## 어떻게 분석하나

| 역할 | 임베딩 | 이유 |
|---|---|---|
| 복붙·템플릿 의심 신호 | 문자 n-gram 해싱 (모델 없음, 즉시) | 글자가 그대로 겹치는지를 봐야 정확함. 의미 모델은 칭찬 댓글을 전부 비슷하게 봐서 신호가 묻힘 |
| 그래프 배치 · 주제 묶음 · 본문 관련도 | EmbeddingGemma-300M (q4, 256차원) | 표현이 달라도 뜻이 같은 댓글을 묶음. WebGPU 있으면 GPU, 없으면 CPU |

의미 모델을 쓸 수 없으면 자동으로 문구 임베딩만으로 동작합니다. "분석 방식"에서 **문구만 (즉시)** 를 고르면 모델 없이 바로 결과가 나옵니다.

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
sidepanel/               UI (graph.js = 캔버스 렌더러)
.github/workflows/       자동 zip 빌드
```

## 한계
- 작성 시각은 "3일 전" 같은 상대시간 기반 근사값
- 답글은 페이지에서 펼쳐진 것만 수집
- YouTube DOM 개편 시 `content/youtube.js`의 `SEL` 수정 필요
