# 크롬 웹 스토어 제출 따라 하기

붙여 넣을 문구는 모두 [listing.md](listing.md)에 있습니다. 개발자 등록(1회 등록비)은 끝났다고 보고 그다음부터 적습니다.

## 0. 제출 전에 (Spruce 결정)
- [ ] 버전: 0.12.1 그대로 낼지, **1.0.0**으로 올릴지 (제안: 1.0.0). 올리면 `manifest.json`·`package.json`의 `version`을 고쳐 커밋 → push.
- [ ] 영어 요약을 따로 보일지(`_locales` 추가 여부). 안 하면 요약은 한국어 하나.
- [ ] 개인정보 관행에서 '웹사이트 콘텐츠'를 밝힐지(권장, listing.md 7절).
- [ ] 공개 범위: 공개 / 링크가 있는 사람만(비공개 목록, unlisted) / 비공개(지정한 사람만).

## 1. 올릴 zip 준비
manifest.json이 **zip 맨 위**에 있어야 합니다(폴더로 감싸면 거부됨).
- 가장 쉬운 길: main에 push하면 GitHub Actions가 Releases(`latest-build`)에 **`web-visualizer-store.zip`**을 함께 올립니다. 그것을 받습니다.
  `https://github.com/Spruce-tone/web_visualizer/releases/latest/download/web-visualizer-store.zip`
- 로컬에서 만든 것(0.12.1 기준): `D:\side_project\web_visualizer\dist\web-visualizer-store-0.12.1.zip` (약 10MB, 파일 49개: manifest.json, background.js, content/, icons/, lib/, offscreen/, sidepanel/, vendor/). 테스트·qa·fixtures·docs·scripts는 들어 있지 않습니다.
- 버전을 바꿨다면 zip도 새로 받아야 합니다(스토어는 같은 버전 번호를 두 번 받지 않음).

## 2. 새 항목 만들기
1. https://chrome.google.com/webstore/devconsole 에 개발자 계정으로 들어갑니다.
2. 계정(Account) 탭에서 먼저 확인: 연락 이메일 인증, 2단계 인증 켜짐, 판매자(trader) 여부 선언(개인 무료 배포면 보통 '판매자 아님').
3. **새 항목(New item)** → 1단계 zip 업로드.
4. 업로드가 끝나면 초안이 생기고 왼쪽에 탭이 보입니다: 패키지 / 스토어 등록정보 / 개인정보 보호 / 배포 / (테스트 안내).

## 3. 스토어 등록정보 (Store listing)
- 설명: listing.md 3절 한국어 붙여 넣기. 언어 추가(English) → 3절 English 붙여 넣기.
- 카테고리: 생산성 › 도구.
- 언어: 한국어.
- 그림: 아이콘 `icons/icon-128.png`, 스크린샷 `docs/store/screenshots/` 4장(1280×800), 작은 홍보 타일 `docs/store/promo-440x280.png`. (큰 홍보 타일·마키는 선택)
- 홈페이지·지원 URL: listing.md 1절.

## 4. 개인정보 보호 (Privacy)
- 단일 목적: listing.md 4절.
- 권한 사유: listing.md 5절 표의 칸마다(sidePanel, scripting, offscreen, 호스트 권한).
- 원격 코드: **아니요** (listing.md 6절).
- 데이터 사용: listing.md 7절대로 체크하고 확인 문구 세 개 체크.
- 개인정보처리방침 URL: `https://github.com/Spruce-tone/web_visualizer/blob/main/docs/privacy.md`
  - push한 뒤 이 주소가 열리는지 먼저 확인합니다(저장소가 공개여야 함).
  - 깔끔한 주소가 필요하면 GitHub Pages를 켤 수 있습니다: 저장소 Settings → Pages → Source를 `main` / `/docs`로 → 몇 분 뒤 `https://spruce-tone.github.io/web_visualizer/privacy.html`(또는 `/privacy`). 이 작업은 아직 하지 않았습니다.

## 5. 배포 (Distribution)
- 공개 범위: 0절에서 고른 것.
- 지역: 모든 지역(기본).
- 처음에는 '비공개 목록(unlisted)'으로 올려 링크로만 써 보고, 괜찮으면 공개로 바꾸는 방법도 있습니다(바꿀 때 다시 심사하지 않을 수도, 할 수도 있음).

## 6. 테스트 안내 (선택)
listing.md 8절 영어 문구를 붙여 넣습니다. 로그인이 필요 없는 확장이라 계정 정보는 주지 않아도 됩니다.

## 7. 검토 제출
- 오른쪽 위 **검토를 위해 제출(Submit for review)**.
- '검토 통과 후 자동 게시'를 끄면 통과 뒤 직접 게시 단추를 눌러야 합니다.
- **예상 기간**: 보통 며칠 안(대부분 사흘 안팎). 처음 내는 항목, 호스트 권한이 있는 항목, `offscreen`처럼 설명이 필요한 권한이 있으면 더 걸릴 수 있고, 길면 몇 주. 상태는 대시보드와 메일로 옵니다.
- 반려되면 메일에 이유(정책 번호)가 옵니다. 고친 뒤 **버전을 올려** 다시 올립니다.

## 8. 통과 뒤
- 스토어 주소를 README의 설치 칸(지금 '나중에 채울 자리')에 넣습니다.
- 다음 버전부터: `version`을 올리고 push → `web-visualizer-store.zip` 받기 → 대시보드 패키지 탭에서 새 zip 업로드 → 제출.
- 사용자 설치본은 스토어가 자동 업데이트합니다. 옆 패널/팝업 선택은 업데이트 뒤에도 남습니다(확장 다시 불러오기로 확인, `qa/2026-12-02/REPORT.md`).

## 참고: 심사에서 볼 만한 점과 이미 맞춘 것
| 볼 만한 점 | 상태 |
|---|---|
| 원격 코드 금지(MV3) | 모든 JS·WASM은 `vendor/`에. 모델 가중치만 내려받음(데이터) |
| 최소 권한 | `activeTab` 뺌(0.12.1). 호스트 권한은 www.youtube.com 하나 |
| offscreen 사유 일치 | 이유 WORKERS, 실제로 Web Worker에서 계산(0.12.1) |
| 설치 경고 | "www.youtube.com에서 사용자의 데이터 읽기 및 변경" 하나(offscreen은 경고 없음) |
| 상표 | 이름·아이콘에 YouTube 등 다른 상표 없음. 설명에서 사실로만 씀 |
| 개인정보처리방침 | `docs/privacy.md` (한/영) |
| 사용자 데이터 | 기기 밖으로 안 보냄, 저장 안 함 |
