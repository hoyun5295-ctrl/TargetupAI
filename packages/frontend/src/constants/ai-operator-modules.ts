/**
 * ai-operator-modules.ts — AI Operator sub-module 카드 매트릭스 (D210+ 2026-05-23)
 *
 * AiOperatorPage 카드 + AiOperatorWalkthroughModal STEP 6 메뉴 매트릭스 공통 사용.
 * no_inline_duplication 룰 정합 — 단일 source of truth.
 *
 * ★ D210+ Phase 1 (Harold 명시 2026-05-23): AiOperatorWalkthroughModal STEP 6 메뉴 매트릭스 추가 의무로
 *   AiOperatorPage 인라인 정의를 constants/ 모듈로 추출 — 사용처 2곳 공통 import.
 */

import {
  Brain,
  BrainCircuit,
  CalendarDays,
  ImagePlus,
  LineChart,
  Mail,
  MessageSquare,
  PlugZap,
  Share2,
  Smartphone,
  Wand2,
  Workflow,
} from 'lucide-react';

export interface SubModuleCard {
  icon: typeof Workflow;
  gradient: string;
  label: string;
  description: string;
  path: string;
  adminOnly?: boolean;
  /** ★ P4: 신규 기능 NEW 뱃지(4~6주 유효 — 지나면 제거). */
  badge?: string;
  /**
   * ★ 2026-09-20: 서버가 준 개방 플래그 축(`GET /api/ai/operator/access` 의 `features`).
   * **카드는 모든 회사에 보인다.** 이 값은 "눌렀을 때 들어가는가"만 가른다 —
   * 아직 안 열린 회사는 이동 대신 그 기능의 안내 창을 받는다(요금제 잠김과 같은 길).
   * ⛔ 숨기지 않는 이유 = 없는 메뉴는 물어볼 수도 없다. 순차 개방 중인 기능은 보이되 설명돼야 한다(Harold 확정).
   */
  flag?: 'sns';
  /** ★ 2026-09-30 AI 존 대개편: 메뉴 식별자(존 틀 · 탭 · 테스트가 이 값으로 찾는다) */
  id: ZoneModuleId;
  /**
   * ★ 2026-09-30 한 줄 입력 카드(Harold "한줄로 입력창은 자동화로 한정"). 있으면 그 메뉴 명령 카드가
   * 워드마크 + 밑줄 입력 + 버튼이 되고, 없으면 입력 없는 흰 카드다. 7메뉴 고정(zone-surface-invariants).
   */
  oneLine?: { placeholder: string; verb: string };
}

export type ZoneModuleId =
  | 'journeys' | 'auto-marketing' | 'planner' | 'dm' | 'email' | 'inapp'
  | 'make' | 'image-studio' | 'sns' | 'cdp' | 'performance' | 'ai-memory';

/**
 * 이 카드가 이 회사에 **열려 있는가**(= 누르면 화면으로 들어가는가).
 * 소비처가 같은 판정을 쓰도록 여기 한 곳이 소유한다. 플래그가 없는 카드는 언제나 열려 있다.
 * 조회 실패·필드 부재 = 닫힘으로 본다(모르면 열지 않는다).
 */
export function isCardOpen(card: SubModuleCard, features: Record<string, boolean> | null | undefined): boolean {
  if (!card.flag) return true;
  return !!features?.[card.flag];
}

// ★ D209+ (Harold 명시 2026-05-22): 모든 description 1줄 일관 매트릭스 — AI 자동 마케팅 ("매일 AI 캠페인 자동 제안" 12자) 기준.
//   카드 높이 정합성 의무 — AI 영역 신뢰 (정합 X = 사용자 의구심).
// ★ D210+ (Harold 명시 2026-05-23): constants/ 모듈 추출 — AiOperatorPage + AiOperatorWalkthroughModal STEP 6 공통 사용.
// ★ D212+ (2026-05-23 Harold 명시): "AI 영구운영" → "AI 자동 마케팅" 메뉴명 정정 — 마케팅팀 친화 본질 (ContinuousOperatorPage 정합)
// ★ 2026-07-18 (Harold 확정): 행 단위 정체성 재배열 — 1행 자동화·기반 / 2행 발송 채널 / 3행 제작 도구·AI 두뇌 / 4행 고객 이해·분석.
//   위저드가 아닌 진열장이므로 작업 순서가 아니라 가치 순서(자동화 우선). 3행 중앙(마케팅 캘린더)은 P4에서 이미지 스튜디오 카드로 교체 예정.
// ★ 2026-08-12 마케팅 플래너 메뉴 개편 (Harold 확정 — 설계서 docs/2026-08-12-ax-marketing-planner-design.md §6-3):
//   1행 3열 = 마케팅 플래너 신설(자사몰 연동 자리) — 1행이 자동화 3형제(여정=사건 / 자동마케팅=상태 / 플래너=달력)가 된다.
//   자사몰 연동 → 4행 1열(세그먼트 자리)로 이동. 세그먼트 타일 제거 — AI 메모리 헤더 서브메뉴로(라우트 /segments 유지, 비파괴).
export const SUB_MODULE_CARDS: SubModuleCard[] = [
  // 1행 — 자동화 3형제 (사건·상태·달력)
  { icon: Workflow,     gradient: 'from-fuchsia-400 to-purple-500', label: '여정 자동화',    description: 'AI 여정 7종 자동 설계',          path: '/ai-journeys', id: 'journeys',
    oneLine: { placeholder: '예: 가입하고 7일 안에 첫 구매가 없으면 쿠폰으로 이어서 보내줘', verb: '여정 만들기' } },
  { icon: Brain,        gradient: 'from-indigo-400 to-violet-500',  label: '자동 마케팅',    description: '매일 AI 캠페인 자동 제안',       path: '/continuous-operator', id: 'auto-marketing',
    oneLine: { placeholder: '예: 매월 초에 90일 넘게 안 산 고객을 다시 불러와줘', verb: '제안 받기' } },   // ★ 2026-10-05 매주 + 상태 조건 = 반복이라 막는다(신뢰 설계 Q9) → 매월 예시
  // ★ 2026-09-20 NEW 만료 제거(출시 08-12 · 라벨 3단 정책의 4~6주 기한 경과). 이미지 스튜디오(07-19)도 같이 내렸다.
  { icon: CalendarDays, gradient: 'from-violet-400 to-fuchsia-500', label: '마케팅 플래너',  description: '월간 행사 계획 → AI 대행',       path: '/marketing-planner', id: 'planner' },
  // 2행 — 발송 채널
  { icon: Smartphone,   gradient: 'from-amber-400 to-yellow-500',   label: '모바일 DM',      description: '카드형 미디어 메시지 빌더',      path: '/dm-builder', id: 'dm',
    oneLine: { placeholder: '예: 가을 신상 니트 3종, 이번 주말까지 첫 구매 10%', verb: 'DM 만들기' } },
  { icon: Mail,         gradient: 'from-blue-400 to-cyan-500',      label: '이메일 마케팅',  description: '이메일 발송 + 열람·클릭 확인',   path: '/email-campaigns', id: 'email',
    oneLine: { placeholder: '예: VIP 고객에게 가을 신상 사전 공개 초대 메일', verb: '이메일 만들기' } },
  { icon: MessageSquare,gradient: 'from-rose-400 to-pink-500',      label: '인앱메시지',     description: '자사몰 배너·모달 자동 표시',     path: '/inapp-messages',   adminOnly: true, id: 'inapp',
    oneLine: { placeholder: '예: 장바구니에 담고 1분 넘게 머물면 무료배송 안내 띄워줘', verb: '메시지 만들기' } },
  // 3행 — 제작 도구·AI 두뇌 (중앙 슬롯 = P4에서 이미지 스튜디오로 카드 교체)
  // ★ 2026-09-14 T6 "AI 자동제작" 승격(설계서 §3-3) — 같은 경로 · 신규 ENV 미개방 회사는 옛 화면(원클릭 캠페인)이 그대로 열린다
  // ★ 2026-09-27 만들기 개편 — 입구 이름 "만들기"(DM·이메일 첫 화면 맨 위 카드와 같은 이름 · 같은 경로)
  { icon: Wand2,        gradient: 'from-amber-400 to-fuchsia-500', label: '만들기',         description: '재료만 넣으면 DM·이메일 완성',   path: '/quick-campaign', badge: 'NEW', id: 'make',
    oneLine: { placeholder: '행사 주소를 붙여 넣거나, 행사를 한 줄로 적어 주세요', verb: '재료 읽기' } },
  // ★ 2026-07-19 P4: 3행 중앙 슬롯 = 마케팅 캘린더 → 이미지 스튜디오 교체 (라우트 /marketing-calendar는 유지, 카드 진입만 제거 — 비파괴).
  // ★ 2026-09-30 타일 유일화(AI 존 대개편 D9): 플래너와 같던 violet→fuchsia 를 orange→pink 로
  { icon: ImagePlus,    gradient: 'from-orange-400 to-pink-500',    label: '이미지 스튜디오', description: '상품→AI 배경 소재 완성',         path: '/image-studio', id: 'image-studio' },
  // ★ 2026-09-20 SNS 채널 신설(설계서 docs/2026-09-17-sns-publish-design.md §3-11 · Harold 확정).
  //   3행에 두는 이유 = 만들고(AI 자동제작) 다듬어서(이미지 스튜디오) 내보내는(SNS) 동선이 한 줄로 이어진다.
  //   `flag: 'sns'` = 서버가 준 개방 플래그로 거르는 축. 화면은 ENV 를 다시 계산하지 않는다(§2-16).
  { icon: Share2,       gradient: 'from-sky-400 to-violet-500',     label: 'SNS 채널',       description: '계정 연결 → 게시·예약',          path: '/sns', flag: 'sns', id: 'sns',
    oneLine: { placeholder: '예: 가을 신상 입고 소식, 사진 보고 채널별로 글 써줘', verb: '글 만들기' } },
  // 4행 — 고객 이해·분석
  // ★ 2026-09-30 타일 유일화(D9): 여정과 같던 Workflow 아이콘을 PlugZap 으로
  { icon: PlugZap,      gradient: 'from-emerald-400 to-teal-500',   label: '자사몰 연동',    description: '카페24·네이버 자동 연동',        path: '/cdp-settings', id: 'cdp' },
  { icon: LineChart,    gradient: 'from-fuchsia-400 to-pink-500',   label: '성과리포트',     description: '30일 성과 + 다음 추천',          path: '/performance', id: 'performance' },
  // ★ 2026-09-20 AI 메모리 이동(3행 3열 → 4행 3열). 4행이 "고객 이해·분석"이라 누적 학습이 이 줄에 더 맞다.
  // ★ 2026-09-30 타일 유일화(D9): 자동 마케팅과 같던 Brain · 자사몰과 같던 emerald→teal 을 BrainCircuit · teal→cyan 으로
  { icon: BrainCircuit, gradient: 'from-teal-400 to-cyan-500',      label: 'AI 메모리',      description: '회사별 누적 학습 정확도↑',       path: '/ai-memory', id: 'ai-memory' },
];
/**
 * ★ 2026-09-30 AI 존 대개편(허브 목업 1안): 허브 기능 카드의 행 이름표. 행 구성은 위 배열의 행 주석(0718·0812·0920 확정)을 그대로 이름 붙인 것이다.
 * 카드 순서·개수는 SUB_MODULE_CARDS 가 소유하고, 이 표는 "어느 행에 이름표를 붙이는가"만 가진다(카드는 여기서 빠지지 않는다 — 테스트가 12장 전부 한 행에 속하는지 본다).
 */
export const HUB_CARD_ROWS: { label: string; ids: ZoneModuleId[] }[] = [
  { label: '자동화', ids: ['journeys', 'auto-marketing', 'planner'] },
  { label: '발송 채널', ids: ['dm', 'email', 'inapp'] },
  { label: '제작 도구', ids: ['make', 'image-studio', 'sns'] },
  { label: '고객 이해 · 분석', ids: ['cdp', 'performance', 'ai-memory'] },
];

// ★ 2026-09-20 AI 자율 예측 타일 내림(Harold 확정) — **라우트 `/predictive` 와 화면·데이터는 그대로다.**
//   2026-08-12 세그먼트와 같은 방식(타일만 제거 · 비파괴). 진열장에서 내렸을 뿐이라 주소로는 그대로 들어간다.
//   되돌리기 = 이 주석 위 배열에 한 줄 복원. 합치지 않았으므로 페이지·안내 항목·요금제 축은 손대지 않았다.

/**
 * ★ 2026-09-30 AI 존 대개편: 주소 → 그 화면이 속한 메뉴(머리 타일·제목·뒤로가기 부모의 원천).
 * 허브 카드 경로가 아닌 화면(지도·상세·통계·결재서·1년 설계·예측·세그먼트·사용량·결과)은 부모 메뉴를 따른다.
 */
const ZONE_CHILD_PATHS: Array<[RegExp, ZoneModuleId]> = [
  [/^\/ai-journeys(\/|$)/, 'journeys'],
  [/^\/marketing-(planner|calendar)(\/|$)/, 'planner'],
  [/^\/quick-campaign(\/|$)/, 'make'],
  [/^\/(predictive|segments|ai-usage|ai-batches|ai-explain)(\/|$)/, 'ai-memory'],
];

export function zoneModule(id: ZoneModuleId): SubModuleCard {
  const m = SUB_MODULE_CARDS.find((c) => c.id === id);
  if (!m) throw new Error(`zone module not found: ${id}`);
  return m;
}

export function zoneModuleIdForPath(pathname: string): ZoneModuleId | null {
  const exact = SUB_MODULE_CARDS.find((c) => pathname === c.path || pathname.startsWith(`${c.path}/`));
  if (exact) return exact.id;
  const child = ZONE_CHILD_PATHS.find(([re]) => re.test(pathname));
  return child ? child[1] : null;
}
