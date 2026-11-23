# Web Visualizer (M0)

웹 문서와 댓글을 수집·시각화해서 문서의 성격과 댓글 반응(조작 의심 신호 vs 실제 반응)을 파악하는 크롬 확장 프로토타입.

## 설치 (빌드 없음)
1. 이 폴더를 압축 해제
2. Chrome → `chrome://extensions` → 우측 상단 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드** → 이 폴더(`manifest.json`이 있는 곳) 선택
4. 툴바의 확장 아이콘 클릭 → 사이드 패널이 열림

코드를 고친 뒤에는 `chrome://extensions`에서 새로고침(↻) 버튼, 그리고 YouTube 탭도 새로고침.

## 사용 (M0)
- YouTube 영상 페이지(`/watch`)에서
  - **현재 보이는 댓글 추출**: 지금 로드된 댓글만
  - **자동 스크롤로 더 불러오기**: 지정한 스레드 수까지 스크롤하며 로드
  - **JSON 저장**: 추출 결과를 `fixtures/`에 넣어 분석 개발용 샘플로 사용
- 표시: 댓글 수 / 고유 작성자 / 작성 시각 분포 / 좋아요 상위 / 동일 문구 반복

## 구조
```
manifest.json          MV3 설정
background.js          아이콘 클릭 → 사이드 패널
content/parse.js       공통 파싱 (숫자 "1.2천", 상대시간 "3일 전")
content/youtube.js     YouTube 어댑터 (DOM 선택자는 여기에만)
lib/analyze.js         사이트 무관 분석 (히스토그램, 중복 문구 …)
sidepanel/             UI
tests/run.mjs          `npm test`
```

## 한계 (M0)
- 작성 시각은 "3일 전" 같은 상대시간 기반 **근사값**
- 답글은 페이지에서 펼쳐진 것만 수집
- YouTube DOM 개편 시 `content/youtube.js`의 `SEL` 수정 필요
