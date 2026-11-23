// 툴바 아이콘 클릭 시 사이드 패널 열기
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e) => console.error(e));

// 개발·점검용: YouTube 영상 주소 끝에 #wv-dev-open 을 붙이면 '크게 보기' 화면을 같은 탭 묶음의 새 탭으로 연다.
// (자동화 도구가 확장 화면을 직접 눌러 보며 점검할 수 있게 하는 용도. 평소 사용에는 영향이 없다.)
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "WV_DEV_OPEN" || !sender.tab) return;
  const { id, index, groupId, windowId } = sender.tab;
  chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel/sidepanel.html?tab=${id}`), index: index + 1, windowId, active: true }, (tab) => {
    if (groupId !== undefined && groupId !== -1) chrome.tabs.group({ tabIds: [tab.id], groupId }).catch(() => {});
  });
});
