/**
 * about-page.ts — 소개 페이지(`/about` · hoyun 전용) 구성 · ★ 2026-10-07 화면 코드에서 서버로 옮김(허용 계정에만 응답에 싣는다)
 * (★ 2026-10-07 대개편 · 설계서 docs/2026-10-07-about-page-redesign-design.md)
 *
 * 기능 이름 · 요약 · 단계 · 정할 것 · 지켜 주는 것 · 영상 · 카드 한 줄(tagline)은 전부 `plan-feature-intros.ts`(앱 기능 안내 창과 같은 원장)가 소유한다.
 * 여기는 「어느 기능을 어느 묶음에 어떤 순서로」만 기능 id 로 가리킨다(문장을 다시 쓰지 않는다).
 *
 * ⛔ 규약(`backend/src/utils/__tests__/about-page-1007.test.ts`가 지킨다)
 *   1. 묶음의 id 는 원장에 있고 영상과 tagline 이 있어야 한다.
 *   2. 미출시 기능은 넣지 않는다 — SNS 는 요금제 사용자에게도 아직 안내만이라 뺐다(열 때 넣는다).
 *   3. 「지키는 것」의 title 은 그 기능 원장 safeguards 의 title 과 글자 그대로 같아야 한다. line 은 그 문장을 줄인 말만.
 *   4. 줄표 · 모델명 · 내부 식별자 · 효과 장담 수치 0. 크레딧 숫자를 싣지 않는다(가격은 요금제 화면 한 곳).
 */

export interface AboutGroup { key: string; no: string; title: string; sub: string; ids: string[] }

export const ABOUT_GROUPS: AboutGroup[] = [
  { key: 'make', no: '01', title: '만들기', sub: '재료만 넣으면 완성본', ids: ['quick-campaign', 'mobile-dm', 'email-campaign', 'inapp-message', 'image-studio'] },
  { key: 'auto', no: '02', title: '자동으로', sub: '정해 두면 정해진 때에', ids: ['auto-marketing', 'journeys', 'marketing-planner'] },
  { key: 'know', no: '03', title: '알기', sub: '보낸 뒤를 보고 다음을 정하기', ids: ['performance', 'ai-memory'] },
  { key: 'connect', no: '04', title: '연결', sub: '쓰던 쇼핑몰 그대로', ids: ['connect-shop'] },
];

/** 첫 화면 휴대폰 3대 — 가운데 한 편만 재생하고 양옆은 정지 그림(영상이 동시에 돌면 정신없다 · Harold 1007) */
export const ABOUT_HERO = { center: 'auto-marketing', left: 'marketing-planner', right: 'mobile-dm' } as const;

/** 첫 화면 `한줄로 [빈칸]` 에 차례로 들어가는 기능 이름 */
export const ABOUT_SLOT_IDS = ['auto-marketing', 'journeys', 'marketing-planner', 'mobile-dm', 'image-studio'];

/** 「보내기 전에, 한줄로가 지키는 것」 — title = 원장 safeguards 제목 그대로 · line = 그 문장을 줄인 말 */
export const ABOUT_GUARDS: { id: string; title: string; line: string }[] = [
  { id: 'auto-marketing', title: '보내기 전 스팸 검사', line: '통신사 3곳 테스트폰으로 먼저 확인' },
  { id: 'marketing-planner', title: '승인 전에는 아무것도 안 나감', line: '승인한 그대로만 나갑니다' },
  { id: 'auto-marketing', title: '광고 규정 자동', line: '(광고) 표기 · 수신거부 · 야간 발송 금지' },
  { id: 'auto-marketing', title: '대상 없는 날은 쉼', line: '보낼 고객이 없으면 크레딧도 쓰지 않음' },
];

