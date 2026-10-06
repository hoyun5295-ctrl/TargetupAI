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
  MessageSquare, PenLine, Plug, Search, Send, Share2, ShieldCheck, Smartphone, Sparkles, Target, Upload, Users, Wand2, Workflow,
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
  /** costs가 비었을 때 보여줄 한 줄(★2026-10-06 영상 창에서는 크레딧 표 아래에도 보인다) */
  costNote?: string;
  /**
   * ★ 2026-10-06 예시 영상(세로 9:16 · 무음 반복 · 끝 안내 장면 없음) — 있으면 창이 왼쪽 영상 · 오른쪽 설명 두 단이 된다.
   *   파일 = frontend/public/videos/plan-feature/<id>.mp4 · .jpg(build:safe 가 함께 싣는다). 설계 = docs/2026-10-06-plan-feature-video-modal-design.md
   */
  video?: { src: string; poster: string };
  /** ★ 2026-10-06 직접 정할 수 있는 것 — 설정 화면에 실제로 있는 항목만(없는 설정을 적지 않는다) */
  options?: { title: string; text: string; chips?: string[]; wide?: boolean }[];
  /** ★ 2026-10-06 알아서 지켜 주는 것 — 코드에 있는 안전장치만 */
  safeguards?: { title: string; text: string }[];
  /**
   * ★ 2026-10-07 공개 소개 페이지(`/about`) 카드 한 줄 — 위 summary · steps 문장을 줄인 말만(새 사실 0).
   *   공개 페이지에 싣는 기능만 채운다(`constants/about-page.ts` · 계약 = about-page-1007.test.ts).
   */
  tagline?: string;
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
    summary: '가입·구매·생일 같은 일이 생긴 고객에게, 정해 둔 순서대로 메시지가 자동으로 나갑니다.',
    tagline: '가입부터 재구매까지 순서대로',
    video: { src: '/videos/plan-feature/journeys.mp4', poster: '/videos/plan-feature/journeys.jpg' },
    steps: [
      { icon: Target, title: '시작 사건 고르기', text: '준비된 여정을 고르거나 한 줄 목표로 시작합니다. 문장으로 답하면 AI가 초안을 만듭니다.' },
      { icon: ListChecks, title: '단계 설계', text: 'AI가 메시지·대기·조건 단계를 짜 줍니다. 고칠 점을 말로 적으면 그대로 고쳐 줍니다.' },
      { icon: Send, title: '켜 두면 자동', text: '켠 뒤에 해당하는 고객부터 순서대로 받습니다. 여정 지도에서 가입부터 재구매까지 한 화면으로 봅니다.' },
    ],
    options: [
      {
        title: '시작 사건', wide: true,
        text: '우리 회사 데이터로 가능한 사건만 열립니다. 조건으로 고른 고객에게 한 번 보내는 여정도 만들 수 있습니다.',
        chips: ['신규 가입', '첫 구매', '재구매', '휴면', '휴면 복귀', '구매 주기 이탈', '등급 상승', '생일', '포인트 소멸', '장바구니 이탈', '배송', '조회 후 미구매'],
      },
      { title: '시작 조건 세부', text: '휴면 기준 일수·생일 며칠 전·장바구니 방치 시간·가입 후 몇 시간 안·포인트 소멸 기준' },
      { title: '단계와 채널', text: '단계마다 SMS·LMS·MMS를 고르고, 단계 사이 기다릴 기간을 정합니다.' },
      { title: '목표 달성 시 종료', text: '구매·링크 클릭·몰 방문·포인트 사용·같은 상품 재구매가 확인되면 그 고객은 여정을 마칩니다.' },
      { title: '상한과 예산', text: '한 번에 들어오는 인원 상한·월 예산·단계당 비용 한도' },
      { title: '다시 들어오기', text: '같은 고객이 다시 들어오기까지 기다릴 일수를 정합니다.' },
      { title: '대조군', text: '0~30% 고객에게는 보내지 않고 남겨 두어, 보낸 고객과 결과를 비교합니다.' },
      { title: '발송 시각 개인화', text: '시각을 정한 단계를 고객이 반응했던 시간대(최근 90일)로 맞춥니다.' },
    ],
    safeguards: [
      { title: '발송 2시간 전 스팸 검사', text: '단계마다 보내기 2시간 전에 검사합니다. 걸리면 AI가 한 번 고쳐 다시 검사하고, 그래도 걸리면 여정을 멈추고 담당자에게 알립니다. 통과 알림은 단계별로 켜고 끌 수 있습니다(기본은 첫 단계와 마지막 단계).' },
      { title: '지난 일로는 시작하지 않음', text: '켜기 전에 있었던 구매·가입으로는 보내지 않습니다. 켠 뒤에 생긴 일부터 받습니다.' },
      { title: '멈춰도 손해 없음', text: '언제든 일시정지할 수 있고, 다시 켤 때는 활성화 크레딧이 다시 들지 않습니다.' },
    ],
    costs: [
      { label: '단계 설계(AI 만들기 한 번)', source: 'journey-ai-generate', credits: 3 },
      { label: '활성화(처음 한 번)', source: 'journey-activate', credits: 200 },
      { label: '발송하는 날(그날 여러 통이어도 한 번)', source: 'journey-operation', credits: 10 },
      { label: '스팸에 걸린 문안 AI 재작성', source: 'journey-ai-refine', credits: 1 },
    ],
    costNote: '문자 발송비는 크레딧과 별도로 요금표대로 나갑니다',
  },
  {
    id: 'auto-marketing', path: '/continuous-operator', title: '자동 마케팅', icon: Brain, gradient: 'from-indigo-400 to-violet-500',
    summary: '목표를 정해 두면 AI가 회차마다 대상과 문안을 만들고, 승인한 기간 동안 정해진 시각에 알아서 보냅니다.',
    tagline: '한 번 승인하면 7일 자동',
    video: { src: '/videos/plan-feature/auto-marketing.mp4', poster: '/videos/plan-feature/auto-marketing.jpg' },
    steps: [
      { icon: Target, title: '시작하기', text: '준비된 시나리오(VIP 재구매·휴면 회복·생일 축하·포인트 사용 유도 등 9가지)를 고르거나, 목표를 한 줄로 적습니다.' },
      { icon: Eye, title: '첫 제안 미리보기', text: '시작하기 전에 받을 고객 수·문안·발송 일정을 먼저 봅니다. 문안을 직접 쓰면 AI 문안 없이 대상만 확인합니다.' },
      { icon: Send, title: '기간 승인', text: '확인하고 승인하면 다음 회차부터 7일 동안 정해진 시각에 나갑니다. 기간이 끝나기 하루 전에 지난 회차 요약과 다음 승인 안내를 문자로 받습니다.' },
    ],
    options: [
      {
        title: '발송 대상', wide: true,
        text: '우리 회사 데이터로 가능한 대상만 열리고, 고르면 지금 기준 대상 수를 바로 보여 줍니다.',
        chips: ['전체', '휴면', '최근 구매', '상위 등급', '생일', '새로 등록', '등급 상승', '첫 구매', '다시 돌아온', '발길이 끊긴', '지난번보다 많이 산'],
      },
      { title: '보내는 주기', text: '매일·매주(요일)·매월(날짜)·매년(월·일)' },
      { title: '발송 시각', text: '오전 8시부터 밤 9시 전까지 원하는 시각, 또는 고객 반응이 높은 시각을 AI에게 맡기기' },
      { title: '발송 채널', text: 'SMS·LMS·MMS(이미지 최대 3장 첨부)' },
      { title: '문안 느낌', text: '정중한·친근한·위트있는·짧고 강한' },
      { title: '문안 직접 쓰기', text: 'AI 문안 대신 직접 쓴 문안을 그대로 보냅니다. 스팸 검사를 통과한 문안만 나갑니다.' },
      { title: '혜택 내용', text: '적어 두면 문안의 혜택 자리에 그대로 들어갑니다. AI가 할인율을 지어내지 않습니다.' },
      { title: '예산', text: '월 예산·하루 한도·알림 기준(기본 80%). 예산을 넘으면 새 제안을 멈춥니다.' },
      { title: '미반응 고객 리마인드', text: '1차 문자를 실제로 받고 링크를 누르지 않은 고객에게만, 1~30일 뒤 한 번 더 보냅니다.' },
      { title: '담당자 알림', text: '담당자 최대 3명과 휴가 대비 백업 담당자. 안내는 문자로 갑니다.' },
      { title: '준비 시간', text: '발송 몇 분 전에 문안을 만들고 검사할지 정합니다(기본 120분 전).' },
    ],
    safeguards: [
      { title: '보내기 전 스팸 검사', text: 'AI 문안은 회차마다 통신사 3곳 테스트폰으로 실제 수신을 확인하고, 추천 문안 3안을 차례로 검사해 통과한 문안으로 보냅니다. 직접 쓴 문안은 같은 문안이 한 번 통과했으면 그 결과를 쓰고, 문안이나 발신번호가 바뀌면 다시 검사합니다.' },
      { title: '통과 못 하면 멈춤', text: '보내지 않고 자동 마케팅을 멈춘 뒤 담당자에게 알립니다. 화면에서 다른 안을 고르거나 고쳐 다시 검사할 수 있습니다(제안마다 5회 무료).' },
      { title: '발송 전 미리 알림', text: '회차마다 보내기 전에 담당자에게 실제 문안과 발송 정보를 문자로 알립니다.' },
      { title: '대상 없는 날은 쉼', text: '보낼 고객이 없는 날은 보내지 않고 크레딧도 쓰지 않습니다.' },
      { title: '광고 규정 자동', text: '(광고) 표기와 무료수신거부 번호를 붙이고, 밤 9시부터 다음 날 오전 8시까지는 보내지 않습니다.' },
      { title: '언제든 정지', text: '실행 중 목록에서 일시 중지하거나 예약된 회차의 자동 발송을 멈출 수 있습니다.' },
    ],
    costs: [
      { label: '첫 제안 미리보기(문안 직접 쓰면 무료)', source: 'ai-operator-propose', credits: 5 },
      { label: '시작(처음 한 번)', source: 'continuous-operator', credits: 200 },
      { label: '발송하는 회차마다', source: 'continuous-operator-send', credits: 10 },
    ],
    costNote: '문자 발송비는 크레딧과 별도로 요금표대로 나갑니다',
  },
  {
    id: 'marketing-planner', path: '/marketing-planner', title: '마케팅 플래너', icon: CalendarDays, gradient: 'from-violet-400 to-fuchsia-500',
    summary: '한 달 행사를 달력에 담으면 문자·모바일 DM·이메일 완성본을 AI가 만들고, 행사마다 한 번 승인하면 예정일에 나갑니다.',
    tagline: '행사만 담으면 완성본까지',
    video: { src: '/videos/plan-feature/marketing-planner.mp4', poster: '/videos/plan-feature/marketing-planner.jpg' },
    steps: [
      { icon: CalendarDays, title: '행사 담기', text: '행사명·기간·혜택 문구, 보낼 채널과 날짜를 달력에 넣습니다.' },
      { icon: ImagePlus, title: '재료 넣기', text: '사진·글·연동 몰 상품을 넣으면 AI가 모바일 DM·이메일 완성본을 만듭니다. 문자 문안은 미리 만들어 스팸 검사까지 해 둡니다.' },
      { icon: Smartphone, title: '휴대폰으로 확인·승인', text: '첫 발송 3일 전 담당자 휴대폰으로 확인 링크가 갑니다. 문안·DM·이메일 실물과 받는 사람 수·비용을 보고 행사마다 한 번 승인합니다.' },
      { icon: Send, title: '예정일에 자동 발송', text: '그날 오전 8시부터 스팸 검사를 한 번 더 하고 승인한 그대로 보냅니다. 결과는 행사 상세와 이달 결과에서 봅니다.' },
    ],
    options: [
      { title: '행사', text: '이름·기간·혜택 문구. 혜택은 적은 그대로 들어갑니다.' },
      { title: '채널과 날짜', text: '행사마다 문자·모바일 DM·이메일 중 고르고, 채널마다 보낼 날을 정합니다.' },
      { title: '재료', text: '사진·글·연동 몰 상품. 다시 만들기를 누르면 새로 만듭니다.' },
      { title: '받는 사람', text: '실제 고객 데이터로 센 인원을 승인 전에 보여 줍니다.' },
      { title: '막힌 채널 안내', text: '우리 회사 데이터나 설정으로 아직 못 쓰는 채널은 이유와 함께 잠겨 보입니다.', wide: true },
    ],
    safeguards: [
      { title: '승인 전에는 아무것도 안 나감', text: '승인하지 않은 행사는 보내지도, 대행료를 쓰지도 않습니다.' },
      { title: '승인한 그대로만', text: '승인한 내용과 나갈 내용을 맞춰 보고, 달라졌으면 보내지 않고 다시 확인을 요청합니다.' },
      { title: '크레딧이 모자라면', text: '그 발송만 멈추고 바로 알립니다. 충전한 뒤 다시 시작할 수 있습니다.' },
      { title: '취소 환불', text: '그 달 발송 처리가 시작되기 전에 취소하면 대행료를 전액 돌려드립니다.' },
    ],
    costs: [
      { label: '월간 대행(그 달 첫 승인 때 한 번)', source: 'planner-monthly-agency', credits: 1000 },
      { label: '모바일 DM 만들기', source: 'dm-ai-generate', credits: 5 },
      { label: '모바일 DM 발행', source: 'dm-builder', credits: 100 },
      { label: '룰렛·추첨·설문 같은 참여 칸이 있는 DM 발행', source: 'dm-interaction-publish', credits: 120 },
      { label: '이메일 만들기', source: 'email-ai-generate', credits: 3 },
      { label: '이메일 완성', source: 'email-campaign-complete', credits: 50 },
      { label: '발송하는 날 문자 문안', source: 'planner-touchpoint-send', credits: 10 },
    ],
    costNote: '문자 발송비는 크레딧과 별도로 요금표대로 나갑니다',
  },
  {
    id: 'mobile-dm', path: '/dm-builder', title: '모바일 DM', icon: Smartphone, gradient: 'from-amber-400 to-yellow-500',
    summary: '사진·버튼·참여 이벤트가 담긴 모바일 페이지를 만들어 문자 링크로 보내고, 누가 보고 눌렀는지 확인합니다.',
    tagline: '문자 링크로 여는 모바일 페이지',
    video: { src: '/videos/plan-feature/mobile-dm.mp4', poster: '/videos/plan-feature/mobile-dm.jpg' },
    steps: [
      { icon: Wand2, title: '만들기', text: '사진·글·홈페이지 주소 중 가진 것을 넣으면 AI가 완성본을 만듭니다. 블록으로 직접 만들기·카탈로그 DM·한 줄로 만들기·저장한 소재로도 시작합니다.' },
      { icon: ListChecks, title: '고칠 곳만 채우기', text: '결과 화면 왼쪽 「고칠 곳」만 채우면 됩니다. 휴대폰 화면에서 블록을 누르면 그 자리만 고칩니다.' },
      { icon: PenLine, title: '자세히 꾸미기', text: '블록마다 구도·배경·색·글자 크기를, 전체는 테마·브랜드 색·서체를 바꿉니다. 휴대폰·PC 미리보기가 바로 바뀝니다.' },
      { icon: Send, title: '보내고 보기', text: '받는 사람·문자 문안·보낼 때를 정해 보냅니다. 상세 창에서 성과와 받은 사람별 반응을 보고 다시 보낼 수 있습니다.' },
    ],
    options: [
      { title: '만드는 방법', text: '재료(사진·글·홈페이지 주소)로 만들기·블록으로 직접·카탈로그 DM(쪽 사진을 슬라이드로)·한 줄 자동·질문 몇 개(오토설계 크레딧 별도)·저장한 소재' },
      { title: '블록 꾸미기', text: '블록마다 구도·배경·색·글자 크기' },
      { title: '전체 설정', text: '테마·브랜드 색·서체·보기 방식·버전 기록' },
      { title: '보내기', text: '받는 사람·문자 문안·바로 또는 예약. 「링크만 받기」로 주소만 받아 다른 곳에 쓸 수도 있습니다.' },
      {
        title: '참여 칸', wide: true,
        text: '받는 사람이 그 자리에서 참여하는 칸을 넣을 수 있습니다.',
        chips: ['투표', '설문', '룰렛 이벤트', '추첨 이벤트', '이메일 수집', '참여 보상'],
      },
      { title: 'A/B 테스트', text: '두세 가지 안을 비율을 정해 나눠 보내고 성과를 비교합니다.' },
      { title: '다시 보내기', text: '상세 창에서 받은 사람별 반응을 보고 다시 보냅니다.' },
    ],
    safeguards: [
      { title: '빈 자리 확인', text: '버튼 주소나 채워야 할 자리가 비어 있으면 보내지 않고 고칠 곳으로 안내합니다.' },
      { title: '혜택은 직접', text: 'AI는 할인율 같은 혜택을 지어내지 않습니다. 혜택 자리는 직접 채웁니다.' },
      { title: '발행 크레딧은 한 번', text: '처음 발행할 때 한 번만 듭니다(「링크만 받기」로 주소만 받을 때도 발행입니다). 같은 DM을 다시 보내도 다시 들지 않습니다.' },
    ],
    costs: [
      { label: '만들기', source: 'dm-ai-generate', credits: 5 },
      { label: '질문 몇 개로 만들기(오토설계 · 한 번)', source: 'one-step-interview', credits: 50 },
      { label: '카탈로그 DM 만들기', source: 'catalog-dm-build', credits: 10 },
      { label: '발행(처음 발행할 때 한 번 · 링크만 받기 포함)', source: 'dm-builder', credits: 100 },
      { label: '참여 칸이 있는 DM 발행', source: 'dm-interaction-publish', credits: 120 },
    ],
    costNote: '문자 발송비는 크레딧과 별도로 요금표대로 나갑니다',
  },
  {
    id: 'email-campaign', path: '/email-campaigns', title: '이메일 마케팅', icon: Mail, gradient: 'from-blue-400 to-cyan-500',
    summary: '이메일을 만들어 회사 메일로 보내고, 누가 열고 무엇을 눌렀는지 봅니다.',
    tagline: '보내고, 누가 열었는지까지',
    video: { src: '/videos/plan-feature/email-campaign.mp4', poster: '/videos/plan-feature/email-campaign.jpg' },
    steps: [
      { icon: Wand2, title: '만들기', text: '사진·글·홈페이지 주소를 넣거나 템플릿을 골라 만듭니다. 모바일 DM과 같은 재료로 이메일도 나란히 만들 수 있습니다.' },
      { icon: PenLine, title: '다듬기', text: '받은편지함에 보이는 제목과 미리보기 글을 적고 블록을 골라 고칩니다. 휴대폰과 PC 화면이 함께 보이고 고친 내용은 자동 저장됩니다.' },
      { icon: Plug, title: '회사 메일 연결', text: '쓰는 메일을 한 번 연결하고 「연결 점검」으로 내 메일에 도착하는지 확인합니다. 만들기와 미리보기는 연결 없이도 됩니다.' },
      { icon: Eye, title: '보내고 보기', text: '받는 사람과 보낼 때를 고르고 보냅니다. 오픈·클릭·많이 누른 링크를 보고, 안 연 사람에게 한 번 더 보낼 수 있습니다.' },
    ],
    options: [
      { title: '만드는 방법', text: '재료로 만들기·템플릿·블록으로 직접·한 줄 자동·저장한 소재' },
      { title: '받은편지함 글', text: '제목과 미리보기 글' },
      { title: '보낼 때', text: '바로 보내기 또는 예약' },
      { title: '테스트 발송', text: '완성한 이메일을 최대 3개 주소로 먼저 받아 봅니다.' },
      { title: 'HTML 저장', text: '완성한 이메일을 HTML로 받아 다른 곳에서 씁니다.' },
      { title: '다시 보내기', text: '안 연 사람에게만 한 번 더 보냅니다.' },
    ],
    safeguards: [
      { title: '광고 표기 자동', text: '광고 메일이면 (광고) 표기와 수신거부 안내가 자동으로 붙습니다.' },
      { title: '혜택은 직접', text: 'AI는 혜택을 정하지 않습니다. 직접 채워야 하는 자리가 남아 있으면 보내지 않습니다.' },
      { title: '완성 크레딧은 한 번', text: '처음 완성할 때 한 번만 듭니다(보내지 않고 완성만 해도 완성입니다). 다시 보내도 다시 들지 않습니다.' },
    ],
    costs: [
      { label: '만들기', source: 'email-ai-generate', credits: 3 },
      { label: '완성(처음 완성할 때 한 번)', source: 'email-campaign-complete', credits: 50 },
    ],
  },
  {
    id: 'inapp-message', path: '/inapp-messages', title: '인앱메시지', icon: MessageSquare, gradient: 'from-rose-400 to-pink-500',
    summary: '자사몰이나 앱을 쓰는 고객에게 정한 순간에 팝업·배너를 띄웁니다.',
    tagline: '정한 순간에 팝업 · 배너',
    video: { src: '/videos/plan-feature/inapp-message.mp4', poster: '/videos/plan-feature/inapp-message.jpg' },
    steps: [
      { icon: Target, title: '빠른 시작', text: '시나리오를 고르면 AI가 제목·본문·띄울 시점까지 만듭니다. 웹 자사몰 팝업이나 모바일 앱 인앱을 직접 만들 수도 있습니다.' },
      { icon: PenLine, title: '모양 정하기', text: '형태와 강조색을 고르고 미리보기로 확인합니다. 웹과 앱은 고를 수 있는 형태가 다릅니다.' },
      { icon: Filter, title: '띄울 조건', text: '웹 자사몰은 장바구니에 담았을 때, 나가려 할 때 같은 순간에, 모바일 앱은 앱을 열 때 띄웁니다. 볼 사람과 빈도도 정합니다.' },
      { icon: Eye, title: '보고 고치기', text: '목록에서 표시·클릭·닫힘을 보고, A/B 변형으로 문안을 비교합니다.' },
    ],
    options: [
      { title: '형태', text: '웹 = 모달·슬라이드·토스트·플로팅·포스터형 · 앱 = 중앙 모달·바텀 시트·포스터형' },
      {
        title: '띄우는 순간(웹 자사몰)', wide: true,
        text: '고객이 이 행동을 할 때 띄웁니다. 모바일 앱은 앱을 열 때 띄웁니다.',
        chips: ['페이지 열 때', '장바구니 담음', '장바구니 페이지', '장바구니 금액', '결제 시작', '스크롤 도달', '페이지 체류', '이탈 의도'],
      },
      { title: '빈도와 시간', text: '세션당 1회 같은 빈도와 표시 시간대' },
      { title: '볼 사람', text: '등급·지역 또는 문장으로 쓴 조건으로 좁힙니다.' },
      { title: '어디에', text: '웹 자사몰은 몰 연동과 설치 스크립트가, 모바일 앱은 앱에 한줄로 연동 코드가 들어가 있어야 뜹니다(네이버 스마트스토어는 표시하지 않습니다).' },
      { title: 'A/B 변형', text: '문안을 달리한 변형을 켜서 비교합니다.' },
    ],
    safeguards: [
      { title: '혜택은 직접', text: 'AI는 혜택을 정하지 않습니다. 초안은 저장되지만 혜택 자리가 비어 있으면 게시되지 않습니다.' },
      { title: '게시 중에는 그대로', text: '게시 중인 메시지는 고쳐도 [반영]을 누르기 전까지 고객 화면이 바뀌지 않습니다.' },
      { title: '관리자만', text: '인앱메시지는 회사 관리자 계정에서만 만들고 게시합니다.' },
    ],
    costs: [
      { label: '만들기', source: 'inapp-ai-generator', credits: 3 },
      { label: '게시', source: 'inapp-publish', credits: 100 },
    ],
  },
  {
    // ★ 2026-09-27 만들기 개편 — 입구 이름 "만들기" · 결과 화면(고칠 곳만 채우고 보내기)
    id: 'quick-campaign', path: '/quick-campaign', title: '만들기', icon: Wand2, gradient: 'from-amber-400 to-fuchsia-500',
    summary: '사진·글·홈페이지 주소 중 가진 것만 넣으면 모바일 DM·이메일·카탈로그 DM 완성본이 결과 화면에 열립니다.',
    tagline: '재료만 넣으면 완성본',
    video: { src: '/videos/plan-feature/quick-campaign.mp4', poster: '/videos/plan-feature/quick-campaign.jpg' },
    steps: [
      { icon: ImagePlus, title: '재료 넣기', text: '홈페이지·행사 페이지 주소를 붙이면 문구·사진·로고를 읽어 옵니다. 사진을 끌어놓거나 행사 내용을 적고, 연동한 몰 상품은 누르기만 하면 담깁니다.' },
      { icon: Wand2, title: '만들기 한 번', text: '드는 크레딧을 확인하고 누르면 받는 사람이 볼 모습 그대로 완성본이 열립니다.' },
      { icon: Send, title: '고칠 곳만 채우고 보내기', text: '왼쪽 「고칠 곳」만 채우고 보냅니다. 같은 재료로 이메일도 나란히 만들 수 있습니다.' },
    ],
    options: [
      { title: '재료', text: '홈페이지·행사 페이지 주소·사진·글·연동 몰 상품. 연동 전이면 상품명과 가격을 붙여 넣으면 글로 실립니다. 빼고 싶은 것은 X로 뺍니다.' },
      { title: '문구 그대로 쓰기', text: '켜 두면 할인율·기간이 적은 그대로 실립니다.' },
      { title: '만들 것', text: '모바일 DM·이메일·카탈로그 DM(쪽 사진 2장 이상 · 휴대폰은 슬라이드, PC는 책처럼 펼쳐 보임)' },
      { title: '다시 만들기', text: '같은 재료로 새 초안을 만듭니다.' },
    ],
    safeguards: [
      { title: '상품 정보 다시 확인', text: '몰 상품의 가격·링크는 만들 때 몰에서 다시 확인합니다. 몰 확인에 실패하면 담아 둔 정보를 쓰니, 보내기 전에 가격·링크를 한 번 보세요.' },
      { title: '누르기 전에 금액 확인', text: '만들기를 누르면 드는 크레딧을 먼저 보여 주고, 확인한 뒤에만 만듭니다.' },
    ],
    costs: [
      { label: '모바일 DM', source: 'dm-ai-generate', credits: 5 },
      { label: '이메일', source: 'email-ai-generate', credits: 3 },
      { label: '카탈로그 DM', source: 'catalog-dm-build', credits: 10 },
      { label: '사진 글자 읽기(글 없이 사진만 넣었을 때)', source: 'event-image-extract', credits: 3 },
    ],
    costNote: '보낼 때 드는 발행·완성 크레딧은 모바일 DM·이메일과 같습니다',
  },
  {
    id: 'image-studio', path: '/image-studio', title: '이미지 스튜디오', icon: ImagePlus, gradient: 'from-violet-400 to-fuchsia-500',
    summary: '템플릿을 고르고 문구만 적으면 행사·제품 포스터가 완성되고, 모바일 DM·이메일·인앱·문자에 바로 씁니다.',
    tagline: '문구만 쓰면 포스터',
    video: { src: '/videos/plan-feature/image-studio.mp4', poster: '/videos/plan-feature/image-studio.jpg' },
    steps: [
      { icon: Search, title: '템플릿 고르기', text: '뷰티·패션·외식·카페 등 16개 분류의 템플릿 502가지. 세부 분류·검색(예: 오픈)·제품/행사 표시로 빨리 찾습니다.' },
      { icon: ImagePlus, title: '제품과 문구 넣기', text: '제품 포스터는 사진을 올리거나 연동 몰 상품을 불러오면 배경을 자동으로 지웁니다. 문구는 적은 그대로 넣고, 행사 포스터는 문구 위치도 고릅니다.' },
      { icon: Wand2, title: '완성·다듬기', text: '포스터가 완성되면 바꾸고 싶은 점을 말로 적어 AI로 고칩니다.' },
      { icon: Share2, title: '채널에 쓰기', text: '라이브러리에 저장하고, 누르면 모바일 DM·이메일·인앱으로 바로 만들거나 문자(MMS) 규격으로 자동 변환합니다.' },
    ],
    options: [
      { title: '템플릿', text: '제품 포스터 329가지·행사 포스터 173가지(세일·오픈·클래스·신메뉴·시즌·멤버십 등)' },
      { title: '문구와 위치', text: '행사명·안내 문구를 적습니다. 행사 포스터는 위·가운데·아래 중 문구 위치도 고릅니다.' },
      { title: '제품 사진', text: '직접 올리기 또는 연동 몰 상품 불러오기. 배경은 자동으로 지웁니다.' },
      { title: 'AI로 고치기', text: '배경·분위기 같은 바꾸고 싶은 점을 말로 적어 고칩니다.' },
      { title: '채널별 크기', text: '모바일 DM·이메일·인앱은 바로 넣고, 문자(MMS)는 보낼 때 규격에 맞춰 자동으로 줄입니다. 인앱은 회사 관리자만 씁니다.', wide: true },
    ],
    safeguards: [
      { title: '적은 문구만', text: '적은 문구 외 글자·가격·로고는 넣지 않습니다. 할인율 같은 혜택은 직접 적은 경우에만 들어갑니다.' },
      { title: '색·모양 그대로', text: '채널 크기를 맞출 때 그림을 다시 그리지 않고 자르고 맞추기만 해서 제품 색·모양이 바뀌지 않습니다.' },
      { title: '성공해야 차감', text: '포스터가 완성되어 저장된 뒤에만 크레딧이 나갑니다.' },
    ],
    costs: [
      { label: '포스터 만들기(한 장)', source: 'image-studio-generate', credits: 2 },
      { label: 'AI로 고치기', source: 'image-studio-edit', credits: 1 },
    ],
    costNote: '배경 지우기·채널 크기 변환은 크레딧이 들지 않습니다',
  },
  {
    id: 'ai-memory', path: '/ai-memory', title: 'AI 메모리', icon: Brain, gradient: 'from-emerald-400 to-teal-500',
    summary: 'AI가 우리 회사에 대해 배운 것을 보고, 꼭 알아야 할 사실을 직접 더하거나 낡은 것을 지웁니다.',
    tagline: 'AI가 배운 우리 회사, 직접 고치기',
    video: { src: '/videos/plan-feature/ai-memory.mp4', poster: '/videos/plan-feature/ai-memory.jpg' },
    steps: [
      { icon: Eye, title: '배운 것 보기', text: 'AI 자율 진단, 학습 종류별 분포, 가장 자주 참고하는 학습 10가지를 봅니다.' },
      { icon: Search, title: '물어보기', text: '「지난 30일 VIP에서 가장 강한 패턴은?」처럼 문장으로 묻습니다.' },
      { icon: PenLine, title: '직접 가르치기', text: '회사 관리자는 AI가 꼭 알아야 할 사실을 중요도와 함께 넣고, 오래된 학습을 정리합니다.' },
    ],
    options: [
      { title: '직접 학습 추가', text: 'AI가 꼭 알아야 할 사실과 중요도' },
      { title: '오래된 학습 정리', text: '낡은 학습을 골라 지웁니다.' },
      { title: '질문', text: '쌓인 학습에 문장으로 묻고 답을 받습니다.' },
    ],
    safeguards: [
      { title: '관리자만 바꿈', text: '학습 추가·정리·삭제는 회사 관리자만 할 수 있습니다.' },
    ],
    costs: [{ label: '질문', source: 'ai-memory-search', credits: 1 }],
  },
  {
    id: 'sns', path: '/sns', title: 'SNS 채널', icon: Share2, gradient: 'from-sky-400 to-violet-500',
    summary: '사진·영상과 글을 한 번 쓰면, 연결한 SNS 채널마다 그 채널 규격에 맞춰 올리거나 예약합니다.',
    video: { src: '/videos/plan-feature/sns.mp4', poster: '/videos/plan-feature/sns.jpg' },
    steps: [
      { icon: Plug, title: '계정 연결', text: '회사 SNS 계정을 공식 로그인으로 연결합니다. 비밀번호는 저장하지 않습니다.' },
      { icon: PenLine, title: '한 번 쓰기', text: '사진·영상과 글을 쓰고 채널별로 글을 다듬습니다. 사진을 보고 AI가 글 초안을 쓰고, 맞춤법도 봅니다.' },
      { icon: Send, title: '올리기·예약', text: '지금 올리거나 시각을 정해 예약합니다. 예약한 글은 시각을 바꾸거나 고칠 수 있습니다.' },
    ],
    options: [
      { title: '연결할 채널', text: '우리 회사에 열린 채널만 연결할 수 있습니다. 열린 채널은 SNS 화면에서 확인합니다.' },
      { title: '채널별 글', text: '채널마다 글을 따로 다듬습니다.' },
      { title: '자주 쓰는 태그', text: '회사 태그 모음을 만들어 두면 AI는 그 안에서만 고릅니다.' },
      { title: '예약 관리', text: '예약 시각 바꾸기·글 고치기·끊긴 계정 다시 연결' },
    ],
    safeguards: [
      { title: '올라간 것만 성공', text: '플랫폼에서 실제로 올라간 것을 다시 확인한 뒤에만 성공으로 표시합니다.' },
      { title: '두 번 올라가지 않음', text: '같은 글이 같은 계정에 두 번 올라가지 않게 막습니다.' },
      { title: '원본 그대로', text: '사진을 멋대로 자르지 않고, 글이 채널 글자 수를 넘으면 자르지 않고 알려 드립니다.' },
      { title: '내 글은 그대로', text: 'AI는 내가 쓴 글의 링크·금액·혜택을 바꾸지 않습니다.' },
    ],
    costs: [],
    costNote: '계정 연결·게시·AI 글 초안·맞춤법 검사에는 크레딧이 들지 않습니다',
  },
  {
    id: 'connect-shop', path: '/cdp-settings', title: '자사몰 연동', icon: Workflow, gradient: 'from-emerald-400 to-teal-500',
    summary: '쓰는 쇼핑몰을 연결하면 주문·회원과 방문·장바구니 같은 행동이 고객 정보에 자동으로 들어옵니다.',
    tagline: '주문 · 회원 · 행동이 자동으로',
    video: { src: '/videos/plan-feature/connect-shop.mp4', poster: '/videos/plan-feature/connect-shop.jpg' },
    steps: [
      { icon: Plug, title: '몰 연결', text: '카페24·아임웹은 쇼핑몰 ID를 넣고 로그인·동의하면 끝납니다. 네이버·고도몰·메이크샵·우커머스는 그 몰에서 만든 키를 넣습니다. 직접 만든 몰은 한줄로가 발급한 키로 몰 서버가 주문을 보내 주도록 개발해야 합니다.' },
      { icon: Eye, title: '행동 수집', text: '수집할 몰 주소를 등록하고 설치 스크립트를 몰에 붙이면 방문·장바구니 같은 행동이 들어옵니다.' },
      { icon: ListChecks, title: '확인하고 쓰기', text: '연결 확인으로 주문이 들어오는지 봅니다. 이후 고객 이력·여정·인앱메시지에 바로 씁니다.' },
    ],
    options: [
      {
        title: '연결할 몰', wide: true,
        text: '목록에 없는 몰이나 직접 만든 몰도 연결할 수 있습니다(개발자가 몰 서버에 연동을 붙여야 합니다).',
        chips: ['카페24', '네이버 스마트스토어', '고도몰', '아임웹', '메이크샵', '우커머스(워드프레스)', '자체 몰·그 외'],
      },
      { title: '몰마다 가져오는 것', text: '카페24·고도몰·우커머스 = 주문·회원 · 네이버 = 주문·구매 고객 · 아임웹·메이크샵 = 주문·회원·수신동의' },
      { title: '행동 수집', text: '설치 스크립트와 수집 허용 주소로 방문·장바구니 같은 행동을 모읍니다.' },
      { title: '몰 여러 개', text: '우커머스는 몰 여러 개를 함께 연결합니다.' },
    ],
    safeguards: [
      { title: '등록한 주소에서만', text: '수집 허용 주소로 등록한 몰에서만 행동을 받습니다.' },
      { title: '관리자만 발급', text: '연결 등록과 키 발급은 회사 관리자만 하고, 발급한 키는 그 자리에서 한 번만 보여 줍니다.' },
      { title: '지난 주문으로 시작 안 함', text: '연결 전에 있던 주문으로는 여정 메시지가 시작되지 않습니다.' },
    ],
    costs: [],
    costNote: '연동 자체에는 크레딧이 들지 않습니다',
  },
  {
    id: 'performance', path: '/performance', title: '성과리포트', icon: LineChart, gradient: 'from-fuchsia-400 to-pink-500',
    summary: '최근 30일 발송 성과를 보고, AI가 원인을 진단해 다음에 할 캠페인을 설계해 줍니다.',
    tagline: '지난 30일 성과와 다음 캠페인',
    video: { src: '/videos/plan-feature/performance.mp4', poster: '/videos/plan-feature/performance.jpg' },
    steps: [
      { icon: BarChart3, title: '요약 보기', text: '발송 캠페인·지출과 잘 된 캠페인을 한눈에 봅니다. 구매 데이터(자사몰 연동 등)가 들어와 있으면 발송 후 7일 구매와 귀속 매출도 봅니다.' },
      { icon: Sparkles, title: 'AI 진단', text: '최근 30일 성과의 원인과 1순위 권장을 받습니다.' },
      { icon: Wand2, title: '바로 실행', text: '추천 카드를 누르면 그 제안대로 캠페인이 설계되고, 검토한 뒤에 보냅니다.' },
      { icon: FileSpreadsheet, title: '풀분석 보고서', text: '기간과 초점을 정해 회사 보고용 보고서를 받습니다. 1~3분 걸리고 창을 닫아도 진행됩니다.' },
    ],
    options: [
      {
        title: '바로 실행 카드', wide: true,
        text: '누르면 그 방향으로 캠페인을 설계합니다.',
        chips: ['채널 ROI 회복', '시간대 최적화', '최고 성과 복제'],
      },
      { title: '풀분석 기간·초점', text: '보고서의 기간과 볼 초점을 정하고 PDF로 받습니다.' },
      { title: '매출 귀속', text: '구매 데이터가 들어와 있으면 발송 후 7일 안의 구매를 그 캠페인 성과로 봅니다.' },
    ],
    safeguards: [
      { title: '검토 뒤 발송', text: '바로 실행으로 설계된 캠페인도 검토하고 보내기를 눌러야 나갑니다.' },
    ],
    costs: [
      { label: 'AI 진단', source: 'performance-explainer', credits: 5 },
      { label: '풀분석 보고서', source: 'orchestrate', credits: 300 },
    ],
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
