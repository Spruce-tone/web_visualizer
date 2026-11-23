# Web Visualizer

웹 문서와 댓글을 **임베딩 → 유사도 그래프**로 시각화하는 크롬 확장 프로토타입.
문서의 성격, 그리고 댓글의 유사 묶음(복붙·템플릿 댓글 등 **의심 신호**)과 자연스러운 반응을 구분해 보는 것이 목표입니다.

- **저장 없음**: 추출한 문서/댓글과 임베딩은 사이드 패널 메모리에만 있고, 패널을 닫으면 사라집니다.
- **빠름**: 기본 임베딩(문자 n-gram 해싱)은 모델 다운로드가 없고, 댓글 1,500개 기준 약 0.6초에 처리됩니다.
- 현재 지원: YouTube 영상 페이지

## 설치 (빌드 없음)
1. `git clone https://github.com/Spruce-tone/web_visualizer`
2. Chrome → `chrome://extensions` → **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드** → 이 폴더 선택
4. YouTube 영상에서 확장 아이콘 클릭 → 사이드 패널

업데이트: `git pull` → `chrome://extensions`에서 ↻ → YouTube 탭 새로고침

## 사용
- **보이는 댓글 분석** / **더 불러와 분석**(자동 스크롤, 최대 스레드 수 지정)
- **유사도 슬라이더**: 임베딩을 다시 계산하지 않고 간선·묶음만 즉시 다시 계산
- **그래프**: 노드 = 댓글(크기 = 좋아요, 색 = 유사 묶음), 가운데 = 본문. 드래그 이동, 휠 확대, 클릭하면 페이지에서 해당 댓글로 스크롤
- **유사 댓글 묶음**: 의심 신호 점수(0~100)와 근거. 판정이 아닌 참고 지표입니다. 클릭하면 그래프에서 강조

## 임베딩 방식
| 방식 | 특징 | 준비 |
|---|---|---|
| 빠름 · 문자 n-gram (기본) | 표현이 비슷한지 잡음. 복붙/템플릿 댓글 탐지에 강함. 즉시 실행 | 없음 |
| 의미 · multilingual-e5-small (실험적) | 의미가 비슷한지 잡음. 문서 성격·주제 분류에 유리. 브라우저 안에서 실행(서버 전송 없음) | 아래 참고 |

의미 임베딩 준비 (한 번만):
```bash
npm install
npm run vendor   # transformers.js + onnx wasm 을 vendor/ 로 복사 (MV3는 CDN 코드 금지)
```
첫 실행 때 모델 가중치(100MB대)를 Hugging Face에서 받아 브라우저 캐시에 둡니다. 이후에는 오프라인으로 동작합니다.

## 구조
```
manifest.json            MV3 설정
background.js            아이콘 클릭 → 사이드 패널
content/parse.js         공통 파싱 ("1.2천", "3일 전")
content/youtube.js       YouTube 어댑터 (DOM 선택자는 여기에만) + 댓글 포커스
lib/embed/hash.js        빠른 임베딩 (feature hashing TF-IDF)
lib/embed/semantic.js    의미 임베딩 (Transformers.js, 선택)
lib/vec.js               top-k 이웃, 간선, 클러스터(union-find), PCA
lib/layout.js            force-directed 레이아웃
lib/analyze.js           시간 분포, 클러스터 의심 신호
sidepanel/               UI (graph.js = 캔버스 렌더러)
tests/run.mjs            npm test
```

## 한계
- 작성 시각은 "3일 전" 같은 상대시간 기반 근사값
- 답글은 페이지에서 펼쳐진 것만 수집
- YouTube DOM 개편 시 `content/youtube.js`의 `SEL` 수정 필요
