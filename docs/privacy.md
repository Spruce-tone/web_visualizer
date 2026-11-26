# 개인정보처리방침 / Privacy Policy — Web Visualizer

시행일 / Effective date: 2026-12-02 · 적용 버전 / Applies to: 0.12.1 이상 / and later

[한국어](#한국어) · [English](#english)

---

## 한국어

Web Visualizer(이하 "확장")는 YouTube 영상의 댓글을 사용자의 기기 안에서 분석해 지도로 보여 주는 브라우저 확장입니다. 확장은 개발자나 다른 누구의 서버로도 데이터를 보내지 않습니다.

### 1. 확장이 다루는 정보
사용자가 YouTube 영상 페이지에서 **분석 단추를 누를 때만** 아래 정보를 그 페이지에서 읽습니다.
- 영상 정보: 제목, 채널 이름, 설명, 영상 주소
- 공개 댓글과 답글: 내용, 작성자 표시 이름·핸들, 좋아요 수, 작성 시각("3일 전" 같은 표시), 수정 여부

이 정보는 누구나 그 영상 페이지에서 볼 수 있는 공개 정보입니다. 확장은 사용자의 YouTube 계정 정보, 시청 기록, 다른 사이트의 내용, 입력한 글을 읽지 않습니다.

### 2. 쓰는 목적
읽은 정보는 그 자리에서 댓글을 주제별로 묶고, 지도로 그리고, 문구가 거의 같은 댓글 같은 행동 신호를 계산해 화면에 보여 주는 데만 씁니다. 광고, 프로필 만들기, 판매, 신용 평가에 쓰지 않습니다.

### 3. 저장하지 않습니다
- 분석 결과는 브라우저 메모리에만 있습니다(확장 화면과, 창을 닫아도 분석이 이어지도록 하는 화면 없는 분석 문서).
- 영상 탭을 닫거나, 그 탭이 다른 영상·다른 사이트로 가거나, 브라우저를 닫으면 사라집니다.
- 확장은 `storage` 권한과 IndexedDB를 쓰지 않습니다. 댓글을 디스크에 저장하지 않습니다.
- 예외: 사용자가 직접 '분석 결과를 JSON 파일로 내려받기'를 누르면 그 파일이 사용자의 컴퓨터에 저장됩니다.
- '아이콘을 누르면'(옆 패널 / 아이콘 아래 창) 선택은 브라우저가 확장 설정으로 기억합니다. 개인 정보가 아닙니다.

### 4. 외부로 보내지 않습니다
- 댓글과 분석 결과는 기기 밖으로 나가지 않습니다. 계산은 모두 브라우저 안(WebGPU 또는 CPU)에서 합니다.
- 확장이 연결하는 곳은 두 곳뿐입니다.
  1. **YouTube (www.youtube.com)**: 사용자가 보고 있는 영상의 댓글을 더 불러오기 위해, 그 페이지가 평소 쓰는 것과 같은 방식으로 요청합니다.
  2. **Hugging Face (huggingface.co와 그 파일 서버)**: 의미 분석 모델 파일(공개 모델 가중치)을 처음 한 번 내려받습니다. 이 요청에는 댓글이나 영상 정보가 들어가지 않습니다. Hugging Face는 일반 웹 요청처럼 IP 주소 등 접속 기록을 남길 수 있으며, 이는 [Hugging Face 개인정보처리방침](https://huggingface.co/privacy)을 따릅니다.
- 내려받은 모델 파일은 다음에 다시 받지 않도록 브라우저의 캐시 저장소(Cache Storage)에 남습니다. 모델 파일일 뿐 사용자 정보는 들어 있지 않습니다. 확장을 지우거나 브라우저의 사이트 데이터 지우기로 없앨 수 있습니다.
- 분석 도구, 광고, 추적 코드를 넣지 않았습니다.

### 5. 작성자 이름
작성자 이름은 기본으로 "작성자 1"처럼 가려서 보여 줍니다. 사용자가 끌 수 있습니다. 확장은 작성자의 출신, 성향, 개인 속성을 추정하지 않으며, "조작"이라고 판정하지 않습니다. 보여 주는 점수는 살펴볼 순서를 정하기 위한 행동·구조 신호입니다.

### 6. 권한
- `host_permissions: https://www.youtube.com/*`: YouTube 영상 페이지에서 댓글을 읽고 그 댓글 위치로 이동하기 위해
- `scripting`: 영상 페이지에 댓글 읽기 스크립트를 다시 넣기 위해(확장 업데이트 뒤 등)
- `sidePanel`: 옆 패널로 열기 위해
- `offscreen`: 창을 닫아도 분석 계산(Web Worker)이 끝까지 이어지도록, 화면 없는 문서를 쓰기 위해

### 7. 어린이
이 확장은 어린이를 대상으로 하지 않으며, 어린이의 정보를 따로 수집하지 않습니다.

### 8. 바뀌면
이 방침이 바뀌면 이 문서를 고치고 위의 시행일을 바꿉니다. 변경 내역은 GitHub 저장소의 기록에 남습니다.

### 9. 문의
GitHub 이슈: https://github.com/Spruce-tone/web_visualizer/issues

---

## English

Web Visualizer ("the extension") is a browser extension that analyzes the comments of a YouTube video on the user's own device and shows them as a map. The extension does not send data to the developer's servers or to anyone else's.

### 1. Information the extension handles
**Only when the user presses the analyze button** on a YouTube video page, the extension reads from that page:
- Video information: title, channel name, description, video URL
- Public comments and replies: text, author display name/handle, like count, posting time (as shown, e.g. "3 days ago"), edited flag

This is public information that anyone can see on that video page. The extension does not read the user's YouTube account details, watch history, content of other sites, or anything the user types.

### 2. Purpose
The information is used only to group comments by topic, draw them as a map, and compute behavioral signals such as near-identical wording across accounts, and to show these on screen. It is not used for advertising, profiling, sale, or credit decisions.

### 3. No storage
- Analysis results live only in browser memory (the extension's pages, and a page-less offscreen document that lets analysis finish after the popup closes).
- They are discarded when the video tab is closed, when that tab moves to another video or another site, or when the browser closes.
- The extension does not use the `storage` permission or IndexedDB, and does not write comments to disk.
- Exception: if the user clicks "Download analysis as JSON", that file is saved to the user's computer.
- The "When the icon is clicked" choice (side panel / popup) is kept by the browser as an extension setting. It is not personal data.

### 4. Nothing is sent out
- Comments and results never leave the device. All computation runs in the browser (WebGPU or CPU).
- The extension connects to only two places:
  1. **YouTube (www.youtube.com)**: to load more comments of the video the user is viewing, using the same requests the page itself makes.
  2. **Hugging Face (huggingface.co and its file servers)**: to download the semantic model files (public model weights) once. These requests contain no comments or video information. Like any web request, Hugging Face may log the IP address and similar access data under the [Hugging Face Privacy Policy](https://huggingface.co/privacy).
- Downloaded model files stay in the browser's Cache Storage so they are not downloaded again. They contain no user information and are removed by uninstalling the extension or clearing site data.
- The extension contains no analytics, advertising, or tracking code.

### 5. Author names
Author names are masked by default (e.g. "Author 1"); the user can turn this off. The extension does not infer an author's origin, leanings, or personal attributes, and does not declare anything "manipulated". Scores shown are behavioral/structural signals to decide what to look at first.

### 6. Permissions
- `host_permissions: https://www.youtube.com/*`: to read comments on YouTube video pages and scroll to a selected comment
- `scripting`: to re-inject the comment reader into the video page (e.g. after an extension update)
- `sidePanel`: to open in the browser side panel
- `offscreen`: to keep the analysis (a Web Worker) running to completion after the popup closes, using a page-less document

### 7. Children
The extension is not directed at children and does not knowingly collect children's information.

### 8. Changes
If this policy changes, this document and the effective date above will be updated. The history is kept in the GitHub repository.

### 9. Contact
GitHub issues: https://github.com/Spruce-tone/web_visualizer/issues
