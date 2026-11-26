// 스토어 스크린샷용 합성 댓글 (실제 사람·댓글 아님). 주제가 뚜렷한 요리·여행 영상 모양 + 복붙 묶음 + 짧은 반응 + 답글.
// 인물·정당·국가·브랜드 이름은 쓰지 않는다. 고정 시드라 매번 같다.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const TOPICS = {
  국물: ["국물 색이 진하고 맛있어 보여요", "육수 내는 법 따라 해 봤는데 국물이 깊어졌어요", "국물에 무를 넣으니 시원해요", "멸치 육수 대신 다시마만 써도 되나요", "국물 간은 국간장으로 하나요", "국물 맛 비결이 궁금합니다", "국물이 끓어오를 때 거품 걷는 거 꿀팁", "이 국물에 칼국수 넣어 먹고 싶다"],
  반죽: ["반죽 숙성 시간이 생각보다 길군요", "반죽이 자꾸 질어지는데 물을 줄일까요", "반죽 치대는 장면 보기만 해도 힘들다", "밀가루 종류 바꾸니 반죽이 쫄깃해졌어요", "반죽을 냉장고에 하룻밤 두면 더 좋나요", "반죽 두께가 일정해서 신기해요", "손반죽 대신 기계로 해도 될까요"],
  시장: ["시장 골목 풍경이 정겹네요", "시장 상인분들 인심이 좋아 보여요", "이 시장 주말에 가면 사람 많나요", "시장 구경하는 맛에 여행 가요", "시장 입구 국숫집 저도 가 봤어요", "새벽 시장 분위기 너무 좋다", "시장에서 산 채소로 바로 요리하는 거 멋져요"],
  음악: ["배경 음악 제목 알려주세요", "음악이 영상 분위기랑 잘 맞아요", "잔잔한 음악 덕분에 편하게 봤어요", "중간에 나오는 기타 음악 뭔가요", "음악 소리가 조금 커서 목소리가 묻혀요", "이 음악 들으면서 요리하고 싶다"],
  편집: ["편집 깔끔해서 끝까지 봤어요", "자막 글씨체가 보기 편해요", "컷 넘어가는 편집 감각 좋네요", "편집이 빨라서 지루할 틈이 없어요", "카메라 각도가 바뀌는 편집이 멋져요", "화면 색감 보정 어떻게 하셨나요"],
};
const MORE = {
  국물: ["뼈 육수는 몇 시간 끓이시나요", "국물 한 숟갈 뜨는 장면에서 침 넘어감", "간을 마지막에 맞추는 이유가 있군요", "대파를 듬뿍 넣으니 국물이 달아요", "국물 졸아들면 물을 더 붓나요", "황태 넣은 국물도 맛있을 것 같아요", "국물 위에 뜬 기름은 걷어 내시나요", "고추기름 살짝 넣어도 어울리겠네요"],
  반죽: ["반죽에 소금은 얼마나 넣나요", "밀대로 미는 손놀림이 예술이네요", "면 써는 칼질 소리 듣기 좋아요", "덧가루를 넉넉히 뿌려야 안 붙는군요", "면이 고르게 썰려서 놀랐어요", "쫄깃한 면 비결이 숙성이었네요", "반죽이 갈라지면 물을 조금 더 넣나요", "통밀가루로 해도 괜찮을까요"],
  시장: ["골목마다 다른 가게 구경하는 재미", "떡집 앞에 줄 선 모습이 정겹다", "시장 사람들 표정이 다 밝아 보여요", "어릴 때 할머니랑 가던 장터 생각나요", "반찬 가게 진열이 정갈하네요", "장바구니 들고 걷는 장면 좋아요", "생선 가게 아저씨 말투 재밌어요", "시장 근처에 주차할 곳 있나요"],
  음악: ["음악 끝나는 타이밍이 장면이랑 딱 맞아요", "피아노 소리가 아침 분위기랑 어울려요", "음악 목록 고정 댓글로 달아 주세요", "음악 없이 요리 소리만 나오는 부분도 좋아요", "이런 음악 어디서 찾으시나요", "음악 때문에 계속 돌려 봤어요", "노래 가사 없는 곡이라 집중이 잘 돼요"],
  편집: ["자막 색이 화면이랑 잘 어울려요", "손 클로즈업 장면이 선명하네요", "느린 화면 넣은 부분 감성 있어요", "편집 프로그램 뭐 쓰시는지 궁금해요", "장면 전환이 부드러워요", "영상 길이가 딱 적당해요", "썸네일이랑 영상 색감이 같아서 좋아요"],
};
for (const k of Object.keys(TOPICS)) TOPICS[k].push(...MORE[k]);
const ENDS = ["", "!", "ㅎㅎ", " 감사합니다", " 다음 영상도 기대할게요", "요", " 최고"];
const SHORT = ["와", "ㅋㅋㅋ", "대박", "굿", "👍", "최고", "맛있겠다", "ㅎㅎ"];
const SPAM = "제 채널에도 비슷한 요리 영상 올렸어요 구경 오세요";

export function demoFixture({ n = 330, seed = 7 } = {}) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const now = Date.parse("2026-11-20T12:00:00Z");
  const comments = [];
  let k = 0;
  const add = (text, extra = {}) => {
    const id = "demo" + k++;
    const ago = Math.floor(r() * 9 * 86400e3);
    comments.push({ id, docId: "youtube:DEMO", parentId: null, author: "사용자" + Math.floor(r() * 900), authorId: "@user" + Math.floor(r() * 900), text, likes: Math.floor(r() ** 3 * 400), createdAtRaw: `${Math.max(1, Math.round(ago / 86400e3))}일 전`, createdAtApprox: new Date(now - ago).toISOString(), edited: false, meta: {}, ...extra });
    return id;
  };
  const names = Object.keys(TOPICS);
  // 문장을 통째로 되풀이하면 복붙처럼 보이므로, 앞말·주제 문장·뒷말을 섞는다
  const OPEN = ["", "", "오늘 영상 보니까 ", "저는 ", "솔직히 ", "어제 따라 해 봤는데 ", "엄마랑 같이 봤어요 ", "퇴근하고 보는데 ", "와 진짜 ", "처음 댓글 남겨요 ", "구독하고 봤어요 ", "주말마다 챙겨 봐요 "];
  const CLOSE = ["", "", "", " 다음에 또 올려 주세요", " 저도 해 볼게요", " 덕분에 배웠어요", " 혹시 재료 목록도 있나요", " 저희 동네랑 비슷해요", " 보면서 배고파졌어요", " 오래 기억날 것 같아요", " 친구한테 보여 줘야지"];
  const say = (t) => (pick(OPEN) + pick(TOPICS[t]) + pick(CLOSE) + pick(ENDS)).trim();
  while (comments.length < n - 40) {
    const t = pick(names);
    const id = add(say(t));
    if (r() < 0.12) for (let j = 0, m = 1 + Math.floor(r() * 3); j < m; j++) add(say(t), { parentId: id });
  }
  for (let i = 0; i < 24; i++) add(pick(SHORT));
  // 같은 문구를 여러 계정이 짧은 시간에 (복붙 의심 신호가 보이게)
  for (let i = 0; i < 9; i++) add(SPAM + (i % 3 ? "" : "!"), { author: "홍보" + i, authorId: "@promo" + i, likes: 0, createdAtRaw: "2시간 전", createdAtApprox: new Date(now - 2 * 3600e3 - i * 60e3).toISOString() });
  const doc = { id: "youtube:DEMO", site: "youtube", url: "https://www.youtube.com/watch?v=DEMO", title: "시장에서 장 보고 손칼국수 끓이기 (예시 영상)", author: "예시 요리 채널", publishedAt: null, text: "시장 구경, 반죽, 육수 내기", meta: { videoId: "DEMO", totalComments: 2400, collection: { sort: "random", complete: false, pool: { size: 1260, limit: 1260, complete: false } } }, extractedAt: new Date(now).toISOString() };
  return { doc, comments };
}
