/**
 * plan-feature-intros.ts — 요금제 공통 안내 창(PlanFeatureModal)의 기능 설명 원장 (★ 2026-09-15 Harold 지시 · 목업 승인)
 *
 * 한 기능 = 한 항목. 창에 나오는 이름·한 줄 설명·"이렇게 씁니다" 3단계·크레딧을 여기서만 쓴다.
 *
 * ⛔ 집필 규약 (`backend/src/utils/__tests__/plan-feature-modal-contract.test.ts`가 빌드를 막는다)
 *   1. `credits`는 백엔드 `CREDIT_COST_MAP[source]`와 같아야 한다. 숫자를 문장 안에 쓰지 않는다(칩으로만).
 *   2. 모델명·이모지·줄표·"Modal"·내부 코드명을 쓰지 않는다. 고객이 읽는 문장이다.
 *   3. 효과를 장담하는 수치(몇 % 상승 등)를 쓰지 않는다. 기능이 실제로 하는 일만 적는다.
 *   4. AI Operator 허브 카드(`ai-operator-modules.ts`)마다 `path`가 같은 항목이 하나 있어야 한다.
 *
 * 최소 요금제 = 스타터. 근거 = `backend/utils/plan-guard.ts` 종량제 전환(AI 기능은 미가입만 막고 전 유료 요금제 개방)
 *   · `constants/credit.ts COMMON_SERVICE_LINE`("스타터부터 AI 전 기능").
 */
import {
  BarChart3, Brain, CalendarDays, Eye, FileSpreadsheet, Filter, ImagePlus, LineChart, ListChecks, Mail,
  MessageSquare, PenLine, Plug, Search, Send, ShieldCheck, Smartphone, Sparkles, Target, Upload, Users, Wand2, Workflow,
  type LucideIcon,
} from 'lucide-react';

export const PLAN_FEATURE_MIN_PLAN = '스타터';

export interface PlanFeatureIntro {
  id: string;
  title: string;
  /** 한 줄 설명(무엇이 끝나는가) */
  summary: string;
  icon: LucideIcon;
  /** 아이콘 타일 그라데이션(tailwind from-/to-) */
  gradient: string;
  /** AI Operator 허브 카드와 연결되는 경로. 허브 밖 기능은 없다 */
  path?: string;
  steps: { icon: LucideIcon; title: string; text: string }[];
  /** 드는 크레딧. credits = 백엔드 CREDIT_COST_MAP[source] */
  costs: { label: string; source: string; credits: number }[];
  /** costs가 비었을 때 보여줄 한 줄 */
  costNote?: string;
}

export const PLAN_FEATURE_INTROS: PlanFeatureIntro[] = [
  // ───────── AI Operator 허브 ─────────
  {
    id: 'ai-operator', title: '한 줄로 캠페인 맡기기', icon: Sparkles, gradient: 'from-amber-400 to-fuchsia-500',
    summary: '목표를 한 줄 적으면 대상·문안·발송 시점을 AI가 정해 제안합니다.',
    steps: [
      { icon: Target, title: '목표 한 줄', text: '"한 달 동안 구매가 없는 VIP에게 재구매 안내"처럼 적습니다.' },
      { icon: ListChecks, title: '제안서 확인', text: '대상 인원, 문안 후보, 추천 발송 시점이 한 장으로 나옵니다.' },
      { icon: Send, title: '승인하면 발송', text: '마음에 들지 않으면 고칠 점을 한 줄로 적어 다시 받습니다.' },
    ],
    costs: [{ label: '제안 받기', source: 'ai-operator-propose', credits: 5 }],
  },
  {
    id: 'journeys', path: '/ai-journeys', title: '여정 자동화', icon: Workflow, gradient: 'from-fuchsia-400 to-purple-500',
    summary: '가입·구매 같은 일이 생기면 정해 둔 순서대로 메시지가 나갑니다.',
    steps: [
      { icon: Target, title: '목적 고르기', text: '재구매·휴면·생일 같은 준비된 여정이나 한 줄 목표로 시작합니다.' },
      { icon: ListChecks, title: '단계 설계', text: '메시지·대기·조건 단계를 AI가 짜고, 말로 고칠 수 있습니다.' },
      { icon: Send, title: '켜 두면 자동', text: '켠 뒤에 생기는 고객부터 순서대로 받습니다.' },
    ],
    costs: [
      { label: '설계', source: 'journey-ai-generate', credits: 3 },
      { label: '활성화(처음 한 번)', source: 'journey-activate', credits: 200 },
      { label: '발송하는 날', source: 'journey-operation', credits: 10 },
    ],
  },
  {
    id: 'auto-marketing', path: '/continuous-operator', title: '자동 마케팅', icon: Brain, gradient: 'from-indigo-400 to-violet-500',
    summary: 'AI가 매일 고객 상태를 보고 캠페인을 제안하고, 승인한 것만 나갑니다.',
    steps: [
      { icon: Target, title: '시나리오 고르기', text: '준비된 시나리오를 고르거나 목표를 한 줄 적습니다.' },
      { icon: ListChecks, title: '매일 제안', text: '보낼 대상과 문안이 매일 올라옵니다.' },
      { icon: Send, title: '승인해야 발송', text: '승인하지 않으면 아무것도 나가지 않습니다.' },
    ],
    costs: [
      { label: '시작(처음 한 번)', source: 'continuous-operator', credits: 200 },
      { label: '발송 문안', source: 'continuous-operator-send', credits: 10 },
    ],
  },
  {
    id: 'marketing-planner', path: '/marketing-planner', title: '마케팅 플래너', icon: CalendarDays, gradient: 'from-violet-400 to-fuchsia-500',
    summary: '한 달 행사 계획을 담아 두면 채널별 발송까지 AI가 대신 챙깁니다.',
    steps: [
      { icon: CalendarDays, title: '행사 담기', text: '행사명·기간·혜택 문구를 캘린더에 넣습니다.' },
      { icon: ListChecks, title: '채널과 시점', text: '문자·DM·이메일 중 채널과 보낼 날을 고릅니다.' },
      { icon: Eye, title: '실행 예정 확인', text: '나갈 문안과 대상을 미리 보고 그대로 진행합니다.' },
    ],
    costs: [
      { label: '월간 대행', source: 'planner-monthly-agency', credits: 1000 },
      { label: '당일 문안', source: 'planner-touchpoint-send', credits: 10 },
    ],
  },
  {
    id: 'mobile-dm', path: '/dm-builder', title: '모바일 DM', icon: Smartphone, gradient: 'from-amber-400 to-yellow-500',
    summary: '사진과 버튼이 있는 모바일 페이지를 만들어 문자 링크로 보냅니다.',
    steps: [
      { icon: PenLine, title: '한 줄 또는 시나리오', text: '만들 내용을 적거나 빠른 시작 카드를 누릅니다.' },
      { icon: ImagePlus, title: '카드 단위 편집', text: '문구·이미지·버튼을 카드마다 고칩니다.' },
      { icon: Send, title: '발행하고 보내기', text: '링크가 생기고, 원하는 고객에게 바로 문자로 보냅니다.' },
    ],
    costs: [
      { label: '만들기', source: 'dm-ai-generate', credits: 5 },
      { label: '발행', source: 'dm-builder', credits: 100 },
    ],
  },
  {
    id: 'email-campaign', path: '/email-campaigns', title: 'Email 캠페인', icon: Mail, gradient: 'from-blue-400 to-cyan-500',
    summary: '이메일을 만들어 보내고 누가 열고 눌렀는지 봅니다.',
    steps: [
      { icon: Plug, title: '발신 메일 등록', text: '쓰는 메일 서버를 한 번만 등록합니다.' },
      { icon: PenLine, title: '한 줄로 만들기', text: '제목과 본문이 만들어지고 편집기에서 다듬습니다.' },
      { icon: Eye, title: '보내고 확인', text: '열람·클릭·반송을 보고, 안 연 사람에게 다시 보냅니다.' },
    ],
    costs: [
      { label: '만들기', source: 'email-ai-generate', credits: 3 },
      { label: '완성 저장', source: 'email-campaign-complete', credits: 50 },
    ],
  },
  {
    id: 'inapp-message', path: '/inapp-messages', title: '인앱메시지', icon: MessageSquare, gradient: 'from-rose-400 to-pink-500',
    summary: '자사몰 방문자에게 배너나 팝업을 조건에 맞춰 띄웁니다.',
    steps: [
      { icon: Target, title: '시나리오 고르기', text: '제목·본문·띄울 시점까지 AI가 만듭니다.' },
      { icon: Filter, title: '조건 정하기', text: '장바구니에 담았을 때, 나가려 할 때 같은 순간과 볼 사람을 고릅니다.' },
      { icon: Eye, title: '표시와 반응', text: '표시·클릭·닫힘 수를 목록에서 봅니다.' },
    ],
    costs: [
      { label: '만들기', source: 'inapp-ai-generator', credits: 3 },
      { label: '게시', source: 'inapp-publish', credits: 100 },
    ],
  },
  {
    id: 'quick-campaign', path: '/quick-campaign', title: 'AI 자동제작', icon: Wand2, gradient: 'from-amber-400 to-fuchsia-500',
    summary: '행사 내용과 사진만 넣으면 모바일 DM이나 이메일 완성본이 편집기에 열립니다.',
    steps: [
      { icon: ImagePlus, title: '재료 넣기', text: '행사 내용, 사진, 연동몰 상품을 넣습니다.' },
      { icon: Wand2, title: '버튼 하나', text: '구성과 문구를 만들어 초안으로 저장합니다.' },
      { icon: Send, title: '편집기에서 마무리', text: '바로 고치고 발행합니다.' },
    ],
    costs: [
      { label: '모바일 DM', source: 'dm-ai-generate', credits: 5 },
      { label: '이메일', source: 'email-ai-generate', credits: 3 },
      { label: '사진 글자 읽기', source: 'event-image-extract', credits: 3 },
    ],
  },
  {
    id: 'image-studio', path: '/image-studio', title: '이미지 스튜디오', icon: ImagePlus, gradient: 'from-violet-400 to-fuchsia-500',
    summary: '상품 사진으로 포스터와 배경 소재를 만듭니다.',
    steps: [
      { icon: ListChecks, title: '템플릿 고르기', text: '제품 포스터와 행사 포스터 중에서 고릅니다.' },
      { icon: ImagePlus, title: '문구와 사진', text: '들어갈 문구를 적고 상품 사진을 올리면 배경이 정리됩니다.' },
      { icon: Send, title: '바로 활용', text: '라이브러리에 저장하고 DM·이메일·MMS에 씁니다.' },
    ],
    costs: [
      { label: '생성(후보 2장)', source: 'image-studio-generate', credits: 2 },
      { label: '4K로 받기', source: 'image-studio-4k', credits: 2 },
      { label: 'AI 수정', source: 'image-studio-edit', credits: 1 },
    ],
  },
  {
    id: 'ai-memory', path: '/ai-memory', title: 'AI 메모리', icon: Brain, gradient: 'from-emerald-400 to-teal-500',
    summary: 'AI가 우리 회사에 대해 배운 내용을 보고 직접 더합니다.',
    steps: [
      { icon: Eye, title: '배운 것 보기', text: '자주 참고하는 학습 내용을 순서대로 봅니다.' },
      { icon: Search, title: '물어보기', text: '"VIP 고객에게서 가장 뚜렷한 패턴은?"처럼 묻습니다.' },
      { icon: PenLine, title: '직접 가르치기', text: '꼭 알아야 할 사실을 넣고 오래된 것은 정리합니다.' },
    ],
    costs: [{ label: '질문', source: 'ai-memory-search', credits: 1 }],
  },
  {
    id: 'connect-shop', path: '/cdp-settings', title: '자사몰 연동', icon: Workflow, gradient: 'from-emerald-400 to-teal-500',
    summary: '자사몰 주문과 방문 기록이 고객 정보에 자동으로 들어옵니다.',
    steps: [
      { icon: Plug, title: '몰 고르기', text: '카페24·네이버·고도몰 같은 쓰는 몰을 연결합니다.' },
      { icon: ListChecks, title: '들어오는지 확인', text: '확인 버튼으로 주문이 들어오는지 봅니다.' },
      { icon: Users, title: '고객 이력', text: '구매와 행동이 고객마다 쌓입니다.' },
    ],
    costs: [],
    costNote: '연동하면 고객 수에 맞춰 매일 분석 크레딧이 듭니다',
  },
  {
    id: 'performance', path: '/performance', title: '성과리포트', icon: LineChart, gradient: 'from-fuchsia-400 to-pink-500',
    summary: '최근 30일 성과를 보고 다음에 할 캠페인을 추천받습니다.',
    steps: [
      { icon: BarChart3, title: '요약 보기', text: '발송·지출·발송 뒤 구매와 매출을 한 화면에서 봅니다.' },
      { icon: Search, title: '원인 진단', text: '잘 되고 안 된 이유와 먼저 할 일이 나옵니다.' },
      { icon: Send, title: '제안대로 실행', text: '추천 캠페인을 검토하고 보냅니다.' },
    ],
    costs: [{ label: 'AI 진단', source: 'performance-explainer', credits: 5 }],
  },
  {
    id: 'predictive', path: '/predictive', title: 'AI 자율 예측', icon: Brain, gradient: 'from-violet-400 to-fuchsia-500',
    summary: '떠날 것 같은 고객과 살 것 같은 고객을 매일 점수로 알려 줍니다.',
    steps: [
      { icon: Users, title: '그룹 보기', text: '주의할 그룹과 기회가 있는 그룹이 자동으로 나옵니다.' },
      { icon: Target, title: '고객별 점수', text: '이탈 가능성·구매 가능성·선호 채널을 봅니다.' },
      { icon: Send, title: '캠페인으로', text: '그 그룹 그대로 캠페인을 시작합니다.' },
    ],
    costs: [{ label: '매일 분석', source: 'predictive-daily', credits: 3 }],
  },

  // ───────── 대시보드·발송 화면 ─────────
  {
    id: 'send-target', title: '직접 타겟 발송', icon: Send, gradient: 'from-emerald-500 to-teal-500',
    summary: '조건으로 고객을 골라 그 사람들에게만 문자를 보냅니다.',
    steps: [
      { icon: Filter, title: '조건 고르기', text: '등급·지역·구매 이력 같은 조건을 조합합니다.' },
      { icon: Users, title: '대상 미리 보기', text: '보내기 전에 인원과 대상자 일부를 확인합니다.' },
      { icon: Send, title: '보내기', text: '문안을 넣고 바로 보내거나 예약합니다.' },
    ],
    costs: [],
    costNote: '크레딧은 들지 않고 문자 발송 요금만 나갑니다',
  },
  {
    id: 'upload-customers', title: '고객 DB 업로드', icon: Upload, gradient: 'from-amber-500 to-orange-500',
    summary: '엑셀이나 CSV로 고객 명단을 한 번에 올려 관리합니다.',
    steps: [
      { icon: FileSpreadsheet, title: '파일 올리기', text: '엑셀이나 CSV 파일을 올립니다.' },
      { icon: ListChecks, title: '항목 맞추기', text: '이름·번호·등급 같은 항목을 AI가 알아서 맞춥니다.' },
      { icon: Users, title: '바로 쓰기', text: '올린 명단으로 조건 발송과 캠페인을 시작합니다.' },
    ],
    costs: [{ label: 'AI 항목 맞추기', source: 'ai-column-mapper', credits: 1 }],
  },
  {
    id: 'view-customer', title: '고객 DB', icon: Users, gradient: 'from-sky-400 to-indigo-500',
    summary: '올린 고객 명단을 찾아보고 한 사람의 이력을 확인합니다.',
    steps: [
      { icon: Search, title: '찾기', text: '이름·번호·등급으로 고객을 찾습니다.' },
      { icon: Eye, title: '한 사람 이력', text: '구매·발송·반응 기록을 한 화면에서 봅니다.' },
      { icon: Send, title: '이어서 보내기', text: '찾은 고객에게 바로 메시지를 보냅니다.' },
    ],
    costs: [],
    costNote: '크레딧은 들지 않습니다',
  },
  {
    id: 'write-copy-ai', title: 'AI 문구 추천', icon: Sparkles, gradient: 'from-violet-500 to-fuchsia-500',
    summary: '보낼 내용을 몇 단어로 적으면 문자 문안 후보를 만들어 줍니다.',
    steps: [
      { icon: PenLine, title: '내용 적기', text: '"봄 신상품 입고 안내"처럼 몇 단어만 적습니다.' },
      { icon: ListChecks, title: '후보 고르기', text: '길이와 광고 표기를 맞춘 후보 중에서 고릅니다.' },
      { icon: Send, title: '고쳐서 보내기', text: '고른 문안을 자유롭게 고쳐서 보냅니다.' },
    ],
    costs: [{ label: '문구 추천', source: 'generate-messages', credits: 5 }],
  },
  {
    id: 'ai-decorate', title: 'AI 꾸미기', icon: Wand2, gradient: 'from-violet-500 to-fuchsia-500',
    summary: '본문에 넣은 고객 이름·등급 같은 항목을 문장에 자연스럽게 녹입니다.',
    steps: [
      { icon: PenLine, title: '항목 넣기', text: '본문에 %이름% 같은 고객 항목을 넣습니다.' },
      { icon: Wand2, title: '꾸미기', text: '항목이 어색하지 않게 문장을 다시 씁니다.' },
      { icon: Eye, title: '확인하고 보내기', text: '바뀐 문장을 보고 그대로 쓰거나 되돌립니다.' },
    ],
    costs: [{ label: '꾸미기', source: 'ai-operator-decorate', credits: 3 }],
  },
  {
    id: 'ai-refine', title: 'AI 문안 다듬기', icon: PenLine, gradient: 'from-violet-500 to-fuchsia-500',
    summary: '직접 쓴 문안의 톤과 길이를 정리하고 스팸으로 걸릴 표현을 피합니다.',
    steps: [
      { icon: PenLine, title: '문안 쓰기', text: '평소처럼 문안을 씁니다.' },
      { icon: Wand2, title: '다듬기', text: '톤·길이·광고 표기를 맞춘 문안이 나옵니다.' },
      { icon: Send, title: '골라서 보내기', text: '마음에 드는 것을 골라 그대로 보냅니다.' },
    ],
    costs: [{ label: '다듬기', source: 'refine-direct', credits: 1 }],
  },
  {
    id: 'check-spam', title: '스팸필터 테스트', icon: ShieldCheck, gradient: 'from-amber-400 to-orange-500',
    summary: '보내기 전에 통신사 3사에서 스팸으로 막히는지 확인합니다.',
    steps: [
      { icon: PenLine, title: '문안 준비', text: '보낼 문안을 그대로 둡니다.' },
      { icon: ShieldCheck, title: '테스트', text: 'SKT·KT·LG U+ 번호로 실제 도착 여부를 봅니다.' },
      { icon: Wand2, title: '막히면 고치기', text: '걸린 표현을 고친 뒤 다시 확인하고 보냅니다.' },
    ],
    costs: [],
    costNote: '크레딧은 들지 않고, 테스트 문자는 발송 요금으로 청구됩니다',
  },
  {
    id: 'ai-target', title: 'AI 타겟추출', icon: Target, gradient: 'from-violet-500 to-indigo-500',
    summary: '보낼 대상을 말로 적으면 조건으로 바꿔 고객을 골라 줍니다.',
    steps: [
      { icon: PenLine, title: '말로 적기', text: '"최근 3개월 안에 두 번 이상 산 30대"처럼 적습니다.' },
      { icon: Filter, title: '조건 확인', text: 'AI가 만든 조건과 해당 인원을 확인합니다.' },
      { icon: Send, title: '그대로 보내기', text: '고른 고객에게 바로 보냅니다.' },
    ],
    costs: [{ label: '대상 추출', source: 'ai-segment-generator', credits: 1 }],
  },
];

const BY_ID = new Map(PLAN_FEATURE_INTROS.map((f) => [f.id, f]));
const BY_PATH = new Map(PLAN_FEATURE_INTROS.filter((f) => f.path).map((f) => [f.path as string, f]));

export function findPlanFeatureIntro(id: string): PlanFeatureIntro | null {
  return BY_ID.get(id) || null;
}

/** 허브 카드 경로 → 안내 항목 id. 없으면 null(호출부는 안내 없이 이동하지 않는다) */
export function planFeatureIdForPath(path: string): string | null {
  return BY_PATH.get(path)?.id || null;
}
