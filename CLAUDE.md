# CLAUDE.md — web_visualizer

## 목표
웹 문서(YouTube, 구글 문서, 커뮤니티)와 댓글을 시각화해 문서 성격 파악 + 댓글 조작 의심 신호와 실제 반응 구분. 옵시디언 그래프 뷰의 웹 버전.

## 현재 마일스톤: M0 → M1
- M0 (완료): 빌드 없는 MV3 확장, 사이드 패널, YouTube 댓글 추출, 기본 통계, JSON 내보내기
- M1 (다음): 유사 댓글 클러스터(char n-gram / MinHash) + force graph, 시간 폭주 탐지, 노드 클릭 → 원문 이동

## 규칙
- 사이트별 코드는 `content/<site>.js` 어댑터에만. 출력은 공통 스키마(Doc, Comment[]).
- 분석은 `lib/` 에서 사이트 무관하게. 새 분석 함수에는 `tests/run.mjs`에 테스트 추가.
- "조작" 판정 문구 금지 → "의심 신호 점수 + 근거"로 표시.
- 실제 사이트 대신 `fixtures/*.json` 으로 분석 개발.
- 번들러 도입(WXT+TS)은 외부 라이브러리(그래프 등)가 필요해지는 시점에.

## 공통 스키마
Doc { id, site, url, title, author, publishedAt, text, meta, extractedAt }
Comment { id, docId, parentId, author, authorId, text, likes, createdAtRaw, createdAtApprox, edited, meta }
