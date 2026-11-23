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
2. **댓글 모아서 분석**: 스크롤 없이 댓글과 답글을 자동으로 모읍니다. 기본은 인기순과 최신순을 반반 섞어, 좋아요 많은 댓글 쪽으로만 치우치지 않게 합니다.
3. 처음 의미 분석을 할 때만 모델을 내려받습니다.
4. **크게 보기**: 새 탭에 넓은 화면으로 열리고, 지도 옆에 목록이 나란히 보입니다.
5. 다른 영상으로 넘어가면 패널 위에 안내가 뜨고, **이 영상 분석**을 누르면 새로 분석합니다.

### 지도
- **댓글 지도**: 점 = 댓글, 고리 = 답글, 점선 = 답글과 원댓글, **크기 = 좋아요(그 영상 안에서 상대 크기)**, 색 = 주제, 주황 테 = 복붙 의심
- **작성자 지도**: 점 = 작성자, 크기 = 댓글 수. 행동이 비슷한 작성자끼리 모입니다
- 밝은 배경이 기본이고 "어둡게"로 바꿀 수 있습니다
- 점을 누르면 내용이 열리고, **페이지에서 이 댓글 보기**로 실제 위치로 갑니다. 페이지를 다시 열지 않고, 아직 안 불러온 댓글은 댓글 영역을 내려가며 찾고, 접힌 답글과 긴 댓글은 자동으로 펼칩니다
- 점을 끌면 그 자리에 고정, 더블클릭하면 풀림. Shift+드래그로 영역 선택

### 주제를 얼마나 잘게 나눌지
추천값 4단계, 슬라이더, 주제 수로 맞추기(− / +)

### 내 분류
1~9개까지 추가·삭제·이름 변경. 점을 고르고 분류 버튼이나 숫자키를 누르면 담깁니다

### 목록 (탭)
- **주제**: 키워드, 대표 댓글
- **복붙 의심**: 점수와 항목별 내역. 자연스러운 반복과 판단 보류는 점수 없이 따로 표시
- **다른 패턴**: 같은 주장 다른 표현, 한 댓글에 비슷한 답글이 몰림, 같은 시간대에 함께 쓴 작성자
- **작성자**: 행동만으로 계산한 점수와 내역
- **평가 표현**: 비난·칭찬 표현 분포 (설명용. 점수에 쓰지 않음)
- **영상 간**: 창을 연 동안 분석한 영상들에 함께 나타난 작성자
- **시간**: 작성 시각 분포

## 객관성
점수는 **행동과 구조만**으로 계산하고, 무슨 주장인지·누구를 향했는지는 보지 않습니다. 자연스러운 반복은 먼저 거르고, 근거가 부족하면 점수를 내지 않습니다. 작성자 이름은 기본으로 가립니다. 기준 전체는 [docs/objectivity.md](docs/objectivity.md), 점수 계산은 [docs/signals.md](docs/signals.md)에 있습니다.

**점수 기준**은 기본 규칙과 공개 데이터 보정 중에 고를 수 있습니다. 보정은 선택 사항이고 따로 만들어야 합니다([calibration/README.md](calibration/README.md)).

## 어떻게 분석하나

| 역할 | 방법 |
|---|---|
| 복붙 의심 신호 | 문자 n-gram 해싱 (모델 없음, 즉시) |
| 지도 배치 · 주제 묶음 · 같은 주장 다른 표현 | 의미 임베딩 모델. 평균 벡터를 빼서 댓글 사이 차이를 벌림 |
| 주제 키워드 | 묶음별 c-TF-IDF |

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
npm test          # 계산 로직 + 객관성 기준 + 패널 흐름 점검
npm run evaluate  # fixtures/ 검증 세트로 치우침 점검
```
이 폴더를 바로 "압축해제된 확장 프로그램"으로 로드해 개발할 수 있습니다.
`main`에 푸시하면 GitHub Actions가 테스트 → 번들 → zip을 만들어 Releases(`latest-build`)에 올립니다.

```
manifest.json            MV3 설정
content/youtube.js       YouTube 어댑터: 전체 수집, 댓글 위치 찾기
content/parse.js         응답·시간·숫자 파싱
lib/embed/               문구 임베딩(hash.js), 의미 임베딩(semantic.js)
lib/vec.js, layout.js    이웃·묶음·PCA·평균 빼기, 지도 배치
lib/signals.js           복붙 의심 신호 (자연 반복 거르기, 판단 보류, 점수 분해)
lib/authors.js           작성자 특징·신호·작성자 지도
lib/patterns.js          같은 주장 다른 표현, 몰림, 함께 쓴 작성자, 영상 간 교차
lib/tone.js              평가 표현 (설명용)
lib/weights.js           점수 기준 프로필 / lib/calibrate.js 보정 계산
lib/keywords.js          주제 키워드
sidepanel/               화면 (graph.js = 지도). 사이드 패널 겸 '크게 보기' 탭
tests/                   run.mjs(계산·객관성), panel-smoke.mjs(패널 흐름)
fixtures/, calibration/  검증 세트, 보정 결과(선택)
```

## 한계
- 작성 시각은 "3일 전" 같은 상대시간 기반 근사값
- 답글은 페이지에서 펼쳐진 것만 수집
- YouTube DOM 개편 시 `content/youtube.js`의 `SEL` 수정 필요
