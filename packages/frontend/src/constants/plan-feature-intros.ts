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
    // ★ 2026-09-27 만들기 개편 — 입구 이름 "만들기" · 결과 화면(고칠 곳만 채우고 보내기)
    id: 'quick-campaign', path: '/quick-campaign', title: '만들기', icon: Wand2, gradient: 'from-amber-400 to-fuchsia-500',
    summary: '사진·글·홈페이지 주소 중 가진 것만 넣으면 모바일 DM이나 이메일 완성본이 결과 화면에 열립니다.',
    steps: [
      { icon: ImagePlus, title: '재료 넣기', text: '사진·글·홈페이지 주소·몰 상품 중 가진 것을 넣습니다.' },
      { icon: Wand2, title: '버튼 하나', text: '구성과 문구를 만들어 받는 사람이 볼 모습 그대로 보여 줍니다.' },
      { icon: Send, title: '고칠 곳만 채우고 보내기', text: '누른 곳만 고치고 바로 보냅니다.' },
    ],
    costs: [
      { label: '모바일 DM', source: 'dm-ai-generate', credits: 5 },
      { label: '이메일', source: 'email-ai-generate', credits: 3 },
      { label: '사진 글자 읽기', source: 'event-image-extract', credits: 3 },
    ],
  },
  {
    id: 'image-studio', path: '/image-studio', title: '이미지 스튜디오', icon: ImagePlus, gradient: 'from-violet-400 to-fuchsia-500',
    summary: '템플릿을 고르고 문구만 적으면 행사·제품 포스터가 완성되고, 모바일 DM·이메일·인앱·문자에 바로 씁니다.',
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
    summary: 'AI가 우리 회사에 대해 배운 내용을 보고 직접 더합니다.',
    steps: [
      { icon: Eye, title: '배운 것 보기', text: '자주 참고하는 학습 내용을 순서대로 봅니다.' },
      { icon: Search, title: '물어보기', text: '"VIP 고객에게서 가장 뚜렷한 패턴은?"처럼 묻습니다.' },
      { icon: PenLine, title: '직접 가르치기', text: '꼭 알아야 할 사실을 넣고 오래된 것은 정리합니다.' },
    ],
    costs: [{ label: '질문', source: 'ai-memory-search', credits: 1 }],
  },
  {
    id: 'sns', path: '/sns', title: 'SNS 채널', icon: Share2, gradient: 'from-sky-400 to-violet-500',
    summary: '회사 SNS 계정을 연결해 사진·영상과 글을 올립니다.',
    steps: [
      { icon: Plug, title: '계정 연결', text: '채널 카드에서 연결을 누르면 그 채널 로그인 창이 열립니다.' },
      { icon: ImagePlus, title: '사진·영상 고르기', text: '사진은 채널 규격에 맞춰 준비되고, 영상은 그대로 올라갑니다.' },
      { icon: Send, title: '올리기', text: '지금 올리거나 시각을 정해 두면 그때 올라갑니다.' },
    ],
    costs: [],
    costNote: '계정 연결과 게시에는 크레딧이 들지 않습니다',
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
