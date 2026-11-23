# CLAUDE.md — web_visualizer

## 목표
웹 문서(YouTube, 구글 문서, 커뮤니티)와 댓글을 시각화해 문서 성격 파악 + 댓글 조작 의심 신호와 실제 반응 구분. 옵시디언 그래프 뷰의 웹 버전.

## 방향 (2026-11-24 결정)
- **저장하지 않는다.** 문서/댓글/임베딩은 사이드 패널 메모리에만. IndexedDB·storage 권한 쓰지 않음.
- **임베딩 우선, 속도 우선.** 임계값 변경 등 UI 조작은 임베딩 재계산 없이 캐시된 top-k 이웃으로 처리.
- **역할 분리 (v0.2)**: 문구 임베딩(n-gram 해싱) = 복붙·템플릿 의심 신호 / 의미 임베딩(EmbeddingGemma-300M q4, 256d MRL, `task: clustering` 프롬프트) = 그래프 배치·주제 묶음·본문 관련도. 의미 모델 실패 시 문구 임베딩으로 대체.
- 의미 유사도 임계값은 모델 분포에 맞춰 적응형(`adaptiveThreshold`)으로 기본값 설정.
- **설치는 릴리스 zip 하나로.** main 푸시 → GitHub Actions가 vendor 포함 zip을 `latest-build` 릴리스에 올림.

## 현재 마일스톤
- M0 ✅ MV3 확장, 사이드 패널, YouTube 댓글 추출
- M1 ✅ 임베딩 → top-k 이웃 → 유사 묶음 + 의심 신호 + force 그래프, 클릭 → 원문 이동
- M2 🔄 v0.2: EmbeddingGemma 적용, 역할 분리, 자동 zip 빌드 완료 / 남은 것: 실사용 검증, 묶음 주제 라벨링, Web Worker로 계산 분리
- M3 사이트 어댑터 추가 (네이버 뉴스, 커뮤니티 1곳, 일반 기사)

## 규칙
- 사이트별 코드는 `content/<site>.js` 어댑터에만. 출력은 공통 스키마(Doc, Comment[]).
- 분석/임베딩은 `lib/` 에서 사이트 무관하게. 새 함수에는 `tests/run.mjs`에 테스트 추가.
- "조작" 판정 문구 금지 → "의심 신호 점수 + 근거"로 표시.
- 원격 코드 로드 금지(MV3). 외부 라이브러리는 `vendor/`로 복사해 번들.
- 실제 사이트 대신 `fixtures/*.json` 으로 분석 개발.

## 공통 스키마
Doc { id, site, url, title, author, publishedAt, text, meta, extractedAt }
Comment { id, docId, parentId, author, authorId, text, likes, createdAtRaw, createdAtApprox, edited, meta }
