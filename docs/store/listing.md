# 크롬 웹 스토어 등록 정보 초안

대시보드 칸마다 그대로 붙여 넣을 수 있게 나눴습니다. 따라 하기 순서는 [SUBMIT.md](SUBMIT.md)에 있습니다.

> 문구 원칙: "조작 판정", "봇 잡기" 같은 말을 쓰지 않습니다(결과는 판정이 아니라 살펴볼 순서, `docs/objectivity.md`). YouTube는 사실을 적을 때만 쓰고 이름·아이콘에는 쓰지 않습니다. 다른 회사·서비스의 이름이나 로고를 제휴·보증처럼 보이게 쓰지 않습니다.

---

## 1. 기본 정보

| 칸 | 값 |
|---|---|
| 이름 | Web Visualizer (`manifest.json`의 `name`) |
| 요약(최대 132자) | `manifest.json`의 `description`이 쓰입니다. 0.12.1 뒤로 아래 2절 한국어 문구와 같습니다. |
| 카테고리 | **생산성 › 도구 (Productivity › Tools)** (대안: 생산성 › 교육) |
| 가격 | **무료, 결제·광고 없음** (결제·광고를 묻는 칸은 모두 '없음/아니요') |
| 공개 범위 | **공개 (Public)** |
| 언어 | 한국어 (영어 설명은 '언어 추가'로 함께 넣음) |
| 홈페이지 | https://github.com/Spruce-tone/web_visualizer |
| 지원 사이트 | https://github.com/Spruce-tone/web_visualizer/issues |
| 개인정보처리방침 URL | https://github.com/Spruce-tone/web_visualizer/blob/main/docs/privacy.md |
| 아이콘 | `icons/icon-128.png` (zip 안에도 있음) |
| 스크린샷(1280×800) | `docs/store/screenshots/1-map.png`, `2-signals.png`, `3-panel-popup.png`, `4-authors.png` |
| 작은 홍보 타일(440×280) | `docs/store/promo-440x280.png` |

스크린샷은 합성 댓글(예시 요리 영상)로 찍었습니다. 실제 사람의 댓글·이름은 없습니다. 다시 만드는 법: `scripts/store-shots/`.

## 2. 요약 (132자 이내)

**한국어 (86자)**
```
YouTube 영상 댓글을 기기 안에서 분석해 주제 지도로 보여 주고, 문구가 거의 같은 댓글 같은 신호를 근거와 함께 표시합니다. 댓글 저장·전송 없음.
```

**English (131 chars)**
```
See YouTube comments as an on-device topic map, with signals like shared wording and the evidence. Comments are not stored or sent.
```

> 요약은 매니페스트의 `description`에서 옵니다(위 한국어 문구로 바꿔 둠). 영어 요약을 따로 보이게 하려면 `_locales/ko`, `_locales/en`과 `default_locale`이 필요합니다(선택, Spruce 결정).

## 3. 자세한 설명

### 한국어
```
Web Visualizer는 YouTube 영상의 댓글을 모아 기기 안에서 분석하고, 비슷한 이야기끼리 모인 지도로 보여 주는 확장 프로그램입니다.

■ 할 수 있는 일
• 댓글 모아서 분석: 스크롤하지 않아도 댓글과 답글을 모읍니다. 기본은 '고르게 무작위'라서 좋아요 많은 댓글로만 치우치지 않습니다.
• 주제 지도: 뜻이 비슷한 댓글이 가까이 모이고, 주제마다 색과 키워드가 붙습니다. 키워드를 끌면 그 주제가 함께 움직입니다. 여러 주제에 걸친 댓글은 따로 표시합니다.
• 주제별 댓글 목록: 지도의 점을 누르면 목록에서, 목록을 누르면 지도에서 그 댓글을 찾아 줍니다.
• 행동 신호와 근거: 여러 계정이 거의 같은 문구를 짧은 시간에 쓴 묶음, 한 댓글에 비슷한 답글이 몰린 곳, 함께 나타나는 작성자 등을 점수와 항목별 근거로 보여 줍니다.
• 페이지에서 이 댓글 보기: 영상을 멈추지 않고 그 댓글을 페이지에 띄웁니다.
• 옆 패널 또는 아이콘 아래 창: 원하는 방식으로 엽니다. 창을 닫아도 분석은 끝까지 이어지고, 다시 열면 지도와 분류가 그대로 돌아옵니다. '크게 보기'로 새 탭에서 넓게 볼 수도 있습니다.
• 내 분류: 댓글을 골라 1~9개 분류에 담아 둘 수 있습니다.

■ 판정하지 않습니다
점수는 문구 겹침, 작성자 수, 시간 몰림 같은 행동·구조만으로 계산하고, 무슨 주장인지·누구를 향했는지는 보지 않습니다. 흔한 인사나 짧은 반응 같은 자연스러운 반복은 먼저 거르고, 근거가 부족하면 '판단 보류'로 둡니다. 결과는 "조작이다"라는 판정이 아니라 사람이 살펴볼 순서입니다. 작성자 이름은 기본으로 가립니다.

■ 개인정보
• 댓글과 분석 결과는 기기 밖으로 보내지 않고, 저장하지 않습니다. 탭을 닫으면 사라집니다.
• 의미 분석 모델(공개 모델)은 처음 한 번 Hugging Face에서 내려받아 브라우저에 캐시합니다.
• GPU(WebGPU)가 있으면 GPU로, 없으면 CPU로 계산합니다.

지금은 YouTube 영상 페이지에서 동작합니다.
무료이며 결제나 광고가 없습니다.
소스 코드: https://github.com/Spruce-tone/web_visualizer
```

### English
```
Web Visualizer collects the comments of a YouTube video, analyzes them on your device, and shows them as a map where similar comments sit together.

■ What it does
• Collect and analyze: gathers comments and replies without scrolling. By default it samples evenly at random, so the result is not skewed toward the most-liked comments.
• Topic map: comments with similar meaning cluster together, each topic gets a color and keywords. Drag a keyword to move its topic. Comments that belong to several topics are marked.
• Comment list by topic: click a dot to find it in the list, or a list row to find it on the map.
• Behavioral signals with evidence: groups of near-identical wording from many accounts in a short time, replies piling onto one comment, authors who appear together, each with a score broken down item by item.
• Show this comment on the page: brings the comment up on the YouTube page without stopping the video.
• Side panel or toolbar popup: open it the way you like. Closing the popup does not stop the analysis; reopen it and the map and your tags are back. "Wide view" opens it in a full tab.
• Your own tags: put selected comments into up to 9 groups.

■ It does not judge
Scores use behavior and structure only (shared wording, number of authors, timing), never what a comment claims or whom it is about. Natural repetition such as greetings and short reactions is filtered first, and thin evidence is left as "not enough evidence". Results are an order for a person to look at, not a verdict of manipulation. Author names are masked by default.

■ Privacy
• Comments and results never leave your device and are not stored. They are gone when you close the tab.
• The semantic model (a public model) is downloaded once from Hugging Face and cached by the browser.
• Runs on your GPU (WebGPU) when available, otherwise on the CPU.

Works on YouTube video pages for now. The interface is in Korean.
Free, with no payments or ads.
Source code: https://github.com/Spruce-tone/web_visualizer
```

## 4. 단일 목적 (Single purpose)
```
YouTube 영상 페이지의 공개 댓글을 사용자의 기기 안에서 분석해, 주제 지도와 댓글 목록, 행동 신호(문구 겹침·시간 몰림 등)와 그 근거를 보여 줍니다.
```
English:
```
Analyze the public comments of a YouTube video page on the user's device and show them as a topic map and list, with behavioral signals (shared wording, timing) and their evidence.
```

## 5. 권한 사유 (대시보드 '권한 사유' 칸)

| 권한 | 사유 (한국어) | Justification (English) |
|---|---|---|
| `sidePanel` | 분석 화면을 브라우저 옆 패널로 엽니다. 사용자가 '아이콘을 누르면'에서 옆 패널을 고르면 아이콘 클릭에 패널이 열리고, 팝업에서 '옆 패널로 열기'를 누를 때도 씁니다. | Opens the analysis UI in the browser side panel, either on icon click (when the user picks that mode) or from the popup's "Open in side panel" button. |
| `scripting` | YouTube 영상 탭에 댓글 읽기 스크립트가 없을 때(확장 업데이트 직후 등) 다시 넣고, 사용자가 '페이지에서 이 댓글 보기'를 누르면 페이지 안에서 그 댓글 영역을 다시 불러옵니다. YouTube 페이지에만 씁니다. | Re-injects the comment reader into the YouTube video tab when it is missing (e.g. right after an update) and, when the user clicks "Show this comment on the page", reloads the comment section in the page. Used on YouTube pages only. |
| `offscreen` | 툴바 팝업은 페이지를 누르면 닫히고 그 안의 계산도 사라집니다. 화면 없는 문서(이유 WORKERS)에서 Web Worker로 임베딩·지도 계산을 끝까지 돌리고, 그 탭이 열려 있는 동안 결과를 메모리에만 둡니다. 탭이 닫히거나 다른 영상으로 가면 지우고, 맡은 결과가 없으면 문서를 닫습니다. | The toolbar popup closes as soon as the page is clicked, taking its computation with it. An offscreen document (reason WORKERS) runs the embedding/map computation in a Web Worker to completion and keeps results in memory only while that tab is open; they are dropped when the tab closes or leaves the video, and the document closes when it holds nothing. |
| 호스트 `https://www.youtube.com/*` | 사용자가 보는 YouTube 영상 페이지의 공개 댓글을 읽고(페이지가 쓰는 것과 같은 요청으로 더 불러옴), 고른 댓글 위치로 이동합니다. 다른 사이트에는 접근하지 않습니다. | Reads the public comments of the YouTube video the user is viewing (loading more with the same requests the page uses) and scrolls to a chosen comment. No other sites are accessed. |

## 6. 원격 코드 (Remote code)
- 답: **아니요, 원격 코드를 쓰지 않습니다 (No, I am not using remote code).**
- 설명(필요하면): 모든 JavaScript와 WebAssembly(Transformers.js, ONNX Runtime Web)는 패키지 안 `vendor/`에 들어 있습니다. 처음 실행 때 Hugging Face에서 받는 것은 공개 임베딩 모델의 가중치 파일(ONNX, 데이터)이며, 실행 코드가 아닙니다. 확장의 CSP는 `script-src 'self' 'wasm-unsafe-eval'`입니다.
- English: All JavaScript and WebAssembly (Transformers.js, ONNX Runtime Web) ship inside the package under `vendor/`. What is fetched from Hugging Face on first use are weight files of public embedding models (ONNX, data), not executable code. The CSP is `script-src 'self' 'wasm-unsafe-eval'`.

## 7. 개인정보 보호 관행 (Privacy practices) 답변 초안

**수집하는 데이터 유형** — 확장은 데이터를 기기 밖으로 보내지 않습니다. 다만 페이지 내용(공개 댓글)을 읽어 처리하므로 아래처럼 체크하기를 권합니다(보수적으로 밝힘).

| 항목 | 체크 | 이유 |
|---|---|---|
| 개인 식별 정보 (이름, 주소, 이메일 등) | 안 함 | 사용자의 정보를 다루지 않음. 공개 댓글 작성자 표시 이름은 '웹사이트 콘텐츠'의 일부로 기기 안에서만 처리 |
| 건강 정보 | 안 함 | |
| 금융·결제 정보 | 안 함 | |
| 인증 정보 | 안 함 | |
| 개인 커뮤니케이션 | 안 함 | |
| 위치 | 안 함 | |
| 웹 기록 | 안 함 | 방문 기록을 모으지 않음 (지금 탭이 YouTube 영상인지만 확인) |
| 사용자 활동 (클릭, 키 입력 등) | 안 함 | 화면 조작은 화면을 그리는 데만 쓰고 기록하지 않음 |
| **웹사이트 콘텐츠** | **체크** | 사용자가 분석을 누른 YouTube 영상 페이지의 제목·설명·공개 댓글을 읽어 기기 안에서 분석 |

**확인 문구 (세 칸 모두 체크)**
- [x] 승인된 사용 사례 외의 목적으로 제3자에게 사용자 데이터를 판매하거나 이전하지 않습니다. (I do not sell or transfer user data to third parties, outside of the approved use cases.)
- [x] 항목의 단일 목적과 관련 없는 목적으로 사용자 데이터를 사용하거나 이전하지 않습니다. (I do not use or transfer user data for purposes that are unrelated to my item's single purpose.)
- [x] 신용도 판단이나 대출 목적으로 사용자 데이터를 사용하거나 이전하지 않습니다. (I do not use or transfer user data to determine creditworthiness or for lending purposes.)

> 판단이 갈리는 점: 기기 안에서만 처리하고 전송하지 않는 데이터는 '수집'에 넣지 않아도 된다는 해석도 있습니다. 위 표는 심사에서 설명과 실제 동작이 어긋나 보이지 않도록 '웹사이트 콘텐츠'만 밝히는 쪽입니다. 최종 선택은 Spruce.

## 8. 심사자에게 남길 말 (Test instructions, 선택)
```
1. Open any YouTube video page (e.g. https://www.youtube.com/watch?v=jNQXAC9IVRw) and click the toolbar icon. The side panel opens (the popup mode can be chosen in "아이콘을 누르면").
2. Click "댓글 모아서 분석" (Collect and analyze). The first run downloads a public embedding model (~234 MB) from Hugging Face; later runs reuse the browser cache.
3. The map, topic list and signal tabs appear. Nothing is stored or sent; closing the tab discards the result.
No account or login is needed.
```

## 9. 버전
스토어 첫 제출은 **1.0.0** (Spruce 결정).
