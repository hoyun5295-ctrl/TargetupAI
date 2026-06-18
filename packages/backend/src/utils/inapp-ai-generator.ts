/**
 * ★ CT-77: In-app Message AI Generator — D215+ (2026-05-25)
 *
 * 🎯 목적
 *   자연어 한 줄 → 완전 인앱 메시지 자동 생성. Journey Builder (CT-45) 정합 — 6 sub-agent 흐름.
 *   - 사용자 의도 추출 + 트리거 자동 추론 + 세그먼트 추론 + 8 templates 선택 + Copy 작성 + Variant 안내
 *   - AI Operator 영역 호출 (callAIWithFallback model: 'opus' — 모델명 UI 노출 X)
 *   - 빠른 시작 7 시나리오 SEED (장바구니 회복 / 신규 환영 / 휴면 회수 / 신상품 / VIP 감사 / 결제 이탈 / 재구매)
 *
 * 📋 사용 흐름
 *   1. 회사 admin이 자연어 입력 ("장바구니 24h 후 회복 메시지") 또는 빠른 시작 카드 선택
 *   2. generateInAppMessagePackage() 호출 → 완전 메시지 + 6 sub-agent 진행 응답
 *   3. 회사 admin이 검토 + 편집 (혜택 placeholder 직접 작성 의무)
 *   4. status='active' 변경 시 SDK가 표시 진입
 *
 * ⛔ 영구 원칙
 *   - AI는 메시지 흐름 / 구조 / 인사 / 시즌 감성 텍스트만 작성
 *   - 구체 혜택 (% / 원 / 무료 / 쿠폰 / 사은품) 절대 임의 작성 X
 *   - [혜택 안내 — 직접 작성해주세요] placeholder만 정확히 사용
 *   - 회사 격리 (company_id 의무)
 *   - 모델명 사용자 노출 X (시스템 프롬프트 안 모델명 0건 의무)
 *   - 0건 자동 완화 X (segment 0건이면 안내만)
 */

import { callAIWithFallback } from '../services/ai';
import { buildMemoryPromptContext } from './company-memory';
import { getCompanyDataProfile, formatProfileForAiPrompt } from './company-data-profile';
import { query } from '../config/database';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export type InAppTemplate =
  | 'top_banner'
  | 'bottom_banner'
  | 'center_modal'
  | 'full_screen'
  | 'slide_in'
  | 'inline_card'
  | 'toast'
  | 'floating_button';

export type QuickStartScenario =
  | 'cart_recovery'
  | 'new_welcome'
  | 'dormant_recovery'
  | 'new_product'
  | 'vip_appreciation'
  | 'checkout_abandon'
  | 'repeat_purchase';

export interface InAppButton {
  id: string;
  label: string;
  action_url: string | null;
  style: 'primary' | 'secondary' | 'tertiary';
  background_color: string;
  text_color: string;
}

export interface SegmentConditions {
  customer?: {
    grade?: string[];
    region?: string[];
    age_min?: number;
    age_max?: number;
    ltv_min?: number;
    cart_add_count_30d_min?: number;
    last_activity_days_ago_max?: number;
  };
  events?: {
    cart_add_within_days?: number;
    purchase_within_days?: number;
    page_view_within_days?: number;
  };
}

export interface TriggerConditions {
  event: 'page_load' | 'cart_add' | 'cart_view' | 'checkout_start' | 'scroll' | 'time_on_page' | 'exit_intent' | 'cart_value';
  scroll_percent?: number;
  time_on_page_seconds?: number;
  cart_value_min?: number;
}

export interface GeneratedInAppMessage {
  title: string;
  body: string;
  badge_text: string | null;
  template: InAppTemplate;
  image_url: string | null;
  buttons: InAppButton[];
  background_color: string;
  text_color: string;
  segment_conditions: SegmentConditions;
  trigger_conditions: TriggerConditions;
  personalization_vars: string[];
  display_frequency: 'once_per_session' | 'once_per_day' | 'always';
  auto_dismiss_seconds: number | null;
  max_displays_per_user: number | null;
  send_start_hour: number | null;
  send_end_hour: number | null;
  allowed_weekdays: number[];
  animation: 'fade' | 'slide' | 'bounce' | 'pulse';
  is_ad: boolean;
}

export interface SubAgentStep {
  name: string;
  status: 'completed';
  hint: string;
}

export interface InAppAIPackage {
  message: GeneratedInAppMessage;
  reasoning: string;
  progress_steps: SubAgentStep[];
}

export interface InAppAIGenerateInput {
  companyId: string;
  createdBy: string;
  objective?: string;
  templateHint?: QuickStartScenario;
}

// ════════════════════════════════════════════════════════════════════
// 빠른 시작 7 시나리오 SEED — Journey Builder 7 템플릿 정합
// ════════════════════════════════════════════════════════════════════

interface QuickStartSeed {
  objective: string;
  defaultTemplate: InAppTemplate;
  defaultTrigger: TriggerConditions['event'];
}

const QUICK_START_SEEDS: Record<QuickStartScenario, QuickStartSeed> = {
  cart_recovery: {
    objective: '장바구니에 상품을 24시간 이상 두고 결제하지 않은 회원에게 부드러운 회복 안내',
    defaultTemplate: 'slide_in',
    defaultTrigger: 'cart_view',
  },
  new_welcome: {
    objective: '신규 가입 24시간 안 첫 방문 시 환영 인사 + 자사몰 둘러보기 안내',
    defaultTemplate: 'center_modal',
    defaultTrigger: 'page_load',
  },
  dormant_recovery: {
    objective: '60일 이상 미접속 휴면 회원에게 오랜 안부 인사 + 새 소식 안내',
    defaultTemplate: 'center_modal',
    defaultTrigger: 'page_load',
  },
  new_product: {
    objective: '신상품 출시 첫 주 동안 전체 회원에게 부드러운 알림',
    defaultTemplate: 'center_modal',
    defaultTrigger: 'page_load',
  },
  vip_appreciation: {
    objective: 'VIP 등급 회원에게 진심 어린 감사 인사 + 우대 안내',
    defaultTemplate: 'slide_in',
    defaultTrigger: 'page_load',
  },
  checkout_abandon: {
    objective: '결제 페이지에서 30초 이상 머무르며 결제 X 회원에게 부드러운 진행 안내',
    defaultTemplate: 'center_modal',
    defaultTrigger: 'time_on_page',
  },
  repeat_purchase: {
    objective: '직전 구매 14일 후 재구매 유도 — 구매 회복 시점 부드러운 안내',
    defaultTemplate: 'center_modal',
    defaultTrigger: 'page_load',
  },
};

// 시나리오별 뱃지 + 추천 프리셋 색 (편집에서 8종 자유 변경 가능). 자연어 추론 시 AI가 직접 생성.
const SCENARIO_STYLE: Record<QuickStartScenario, { badge: string; background: string; textColor: string }> = {
  cart_recovery:    { badge: '장바구니',     background: 'linear-gradient(135deg, #fb7185 0%, #f97316 100%)', textColor: '#ffffff' },
  new_welcome:      { badge: 'WELCOME',      background: 'linear-gradient(135deg, #059669 0%, #0d9488 100%)', textColor: '#ffffff' },
  dormant_recovery: { badge: '오랜만이에요', background: 'linear-gradient(135deg, #0f172a 0%, #312e81 100%)', textColor: '#ffffff' },
  new_product:      { badge: 'NEW',          background: 'linear-gradient(135deg, #a855f7 0%, #ec4899 50%, #fb923c 100%)', textColor: '#ffffff' },
  vip_appreciation: { badge: 'VIP',          background: 'linear-gradient(135deg, #1c1917 0%, #44403c 100%)', textColor: '#fcd34d' },
  checkout_abandon: { badge: '거의 다 왔어요', background: 'linear-gradient(135deg, #fb7185 0%, #f97316 100%)', textColor: '#ffffff' },
  repeat_purchase:  { badge: '다시 만나요',   background: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)', textColor: '#ffffff' },
};

export interface QuickStartCardInfo {
  scenario: QuickStartScenario;
  label: string;
  hint: string;
  defaultTemplate: InAppTemplate;
}

export function listQuickStartCards(): QuickStartCardInfo[] {
  return [
    { scenario: 'cart_recovery',     label: '장바구니 회복',     hint: '24h 이상 결제 X 회원 부드러운 안내', defaultTemplate: 'slide_in' },
    { scenario: 'new_welcome',       label: '신규 가입 환영',    hint: '첫 방문 환영 + 자사몰 안내',         defaultTemplate: 'center_modal' },
    { scenario: 'dormant_recovery',  label: '휴면 회수',         hint: '60일+ 미접속 안부 인사',              defaultTemplate: 'center_modal' },
    { scenario: 'new_product',       label: '신상품 출시',       hint: '첫 주 전체 회원 알림',                defaultTemplate: 'center_modal' },
    { scenario: 'vip_appreciation',  label: 'VIP 감사',          hint: 'VIP 등급 진심 감사 인사',             defaultTemplate: 'slide_in' },
    { scenario: 'checkout_abandon',  label: '결제 이탈 방지',    hint: '결제 페이지 30초+ 머무름 안내',       defaultTemplate: 'center_modal' },
    { scenario: 'repeat_purchase',   label: '재구매 유도',       hint: '직전 구매 14일 후 회복',              defaultTemplate: 'center_modal' },
  ];
}

// ════════════════════════════════════════════════════════════════════
// 시즌 컨텍스트 (Journey Builder 정합)
// ════════════════════════════════════════════════════════════════════

const SEASON_BY_MONTH: Record<number, { season: string; keywords: string[] }> = {
  1:  { season: '겨울',      keywords: ['새해', '새출발', '신년 계획'] },
  2:  { season: '겨울 끝',   keywords: ['설날', '발렌타인데이', '입학 준비'] },
  3:  { season: '봄',        keywords: ['새 학기', '봄꽃', '환절기', '화이트데이'] },
  4:  { season: '봄',        keywords: ['벚꽃', '봄나들이', '식목일'] },
  5:  { season: '봄 끝',     keywords: ['가정의달', '어린이날', '어버이날'] },
  6:  { season: '초여름',    keywords: ['호국보훈의달', '여름맞이', '장마 준비'] },
  7:  { season: '여름',      keywords: ['장마', '바캉스', '휴가'] },
  8:  { season: '여름',      keywords: ['휴가 절정', '광복절', '개학 준비'] },
  9:  { season: '가을',      keywords: ['추석', '한가위', '환절기'] },
  10: { season: '가을',      keywords: ['단풍', '국군의날', '한글날'] },
  11: { season: '늦가을',    keywords: ['빼빼로데이', '수능', '겨울맞이'] },
  12: { season: '겨울',      keywords: ['크리스마스', '연말', '송년'] },
};

function getSeasonContext(): { month: number; season: string; keywords: string[] } {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const month = now.getUTCMonth() + 1;
  const ctx = SEASON_BY_MONTH[month] || { season: '계절', keywords: [] };
  return { month, season: ctx.season, keywords: ctx.keywords };
}

// ════════════════════════════════════════════════════════════════════
// 회사 컨텍스트
// ════════════════════════════════════════════════════════════════════

interface CompanyContext {
  companyName: string;
  brandName: string | null;
  brandTone: string | null;
  businessType: string | null;
}

async function loadCompanyContext(companyId: string): Promise<CompanyContext> {
  const r = await query(
    `SELECT company_name, brand_name, brand_tone, business_type
     FROM companies WHERE id = $1::uuid`,
    [companyId]
  );
  const row = r.rows[0] || {};
  return {
    companyName: row.company_name || '',
    brandName: row.brand_name || null,
    brandTone: row.brand_tone || null,
    businessType: row.business_type || null,
  };
}

// ════════════════════════════════════════════════════════════════════
// JSON 추출 헬퍼
// ════════════════════════════════════════════════════════════════════

function extractJSON(text: string): string {
  if (text.includes('```json')) {
    const start = text.indexOf('```json') + 7;
    const end = text.indexOf('```', start);
    return text.slice(start, end).trim();
  }
  if (text.includes('```')) {
    const start = text.indexOf('```') + 3;
    const end = text.indexOf('```', start);
    return text.slice(start, end).trim();
  }
  return text.trim();
}

function validateTemplate(t: any): InAppTemplate | null {
  const valid: InAppTemplate[] = [
    'top_banner', 'bottom_banner', 'center_modal', 'full_screen',
    'slide_in', 'inline_card', 'toast', 'floating_button',
  ];
  return valid.includes(t) ? t : null;
}

// ════════════════════════════════════════════════════════════════════
// 핵심 — 자연어 한 줄 → 완전 인앱 메시지 패키지
// ════════════════════════════════════════════════════════════════════

export async function generateInAppMessagePackage(
  input: InAppAIGenerateInput
): Promise<InAppAIPackage> {
  if (!input.objective && !input.templateHint) {
    throw new Error('objective (자연어) 또는 templateHint (빠른 시작 7 시나리오 중 하나) 중 하나는 필수입니다.');
  }

  // templateHint 우선 — 빠른 시작 SEED 사용
  let effectiveObjective = input.objective || '';
  let suggestedTemplate: InAppTemplate = 'center_modal';
  let suggestedTrigger: TriggerConditions['event'] = 'page_load';

  if (input.templateHint && QUICK_START_SEEDS[input.templateHint]) {
    const seed = QUICK_START_SEEDS[input.templateHint];
    effectiveObjective = effectiveObjective || seed.objective;
    suggestedTemplate = seed.defaultTemplate;
    suggestedTrigger = seed.defaultTrigger;
  }

  const ctx = await loadCompanyContext(input.companyId);
  const memoryContext = await buildMemoryPromptContext(input.companyId, 30).catch(() => '');
  const season = getSeasonContext();
  const dataProfile = await getCompanyDataProfile(input.companyId).catch(() => null);
  const dataProfilePrompt = dataProfile ? formatProfileForAiPrompt(dataProfile) : '';

  const system = `당신은 한국 마케팅 자동화 인앱 메시지 설계 전문가입니다.
회사 admin이 입력한 자연어 목표 또는 빠른 시작 시나리오를 받아 완전한 인앱 메시지 패키지를 JSON으로 응답합니다.

[회사 컨텍스트]
- 회사명: ${ctx.companyName}
- 브랜드명: ${ctx.brandName || '(미설정)'}
- 톤앤매너: ${ctx.brandTone || '친근함'}
- 업종: ${ctx.businessType || '(미설정)'}

[현재 시점 컨텍스트 — KST]
- 현재 월: ${season.month}월 (${season.season})
- 시즌 키워드: ${season.keywords.join(', ')}

${memoryContext}

[★ ★ ★ 영구 룰 — 절대 위반 X ★ ★ ★]

1. AI 임의 혜택 절대 금지:
   ✗ 구체 혜택 (% / 원 / 무료 / 쿠폰 / 사은품 / 적립 / 무료배송 / 할인) 절대 임의 작성 X
   ✓ 혜택 부분은 \`[혜택 안내 — 직접 작성해주세요]\` placeholder만 정확히 사용
   ✓ 회사 admin이 검토 + 편집 단계에서 실제 정책 작성 의무

2. AI 메시지 = 메시지 흐름 / 구조 / 인사 / 시즌 감성 텍스트만 작성
   ✓ 안부 / 공감 도입 / 시즌 묘사 / 가치 제안 / CTA 안내 / 진심 마무리 = 적극 작성
   ✓ %고객명% / {{ customer.name }} / {{ customer.grade }} 변수 활용 권장
   ✓ 짧고 강렬하게 — 제목 18자 안, 본문 1~2문장(40~70자). 한 호흡에 읽히게, 군더더기 X

3. 브랜드 격조 의무:
   ✗ "단골" / "사장님이 직접" / "초특가" / "역대급" / "미친" / "대박" 단어 사용 X
   ✓ "오랜 시간 함께해주신" / "꾸준한 관심을 보내주신" / "소중한 고객님" 등 격조 표현

[8 templates 선택 가이드]

| Template | 시나리오 |
|---|---|
| top_banner | 공지 / 신상품 출시 / 이벤트 안내 (전체 회원) |
| bottom_banner | 동의 / 장바구니 회복 / 결제 직전 안내 |
| center_modal | 신규 환영 / 휴면 회수 / VIP 감사 등 중요 알림 |
| full_screen | 신규 가입 환영 / 온보딩 (5단계 슬라이드 가능) |
| slide_in | 우측 슬라이드 알림 / 자동 닫힘 |
| inline_card | 페이지 안 추천 카드 (DOM inline 삽입 — selector 필요) |
| toast | 우상단 작은 confirmation (3초 자동 닫힘) |
| floating_button | 우하단 플로팅 CTA (장바구니 / 문의 진입) |

빠른 시작 시나리오 기본 제안: ${suggestedTemplate} (자연어 목표에 더 일치하는 template 자유 선택 가능)

[트리거 가이드]

- page_load: 페이지 로드 직후 표시 (default)
- cart_add: 장바구니 추가 직후
- cart_view: 장바구니 페이지 진입
- checkout_start: 결제 페이지 진입
- scroll: 페이지 N% 스크롤 도달 (scroll_percent 명시 — 30~70 권장)
- time_on_page: 페이지 N초 체류 (time_on_page_seconds 명시 — 10~60 권장)
- exit_intent: 마우스 상단 이탈 (desktop only)
- cart_value: 장바구니 금액 N원 이상 (cart_value_min 명시)

빠른 시작 시나리오 기본 제안: ${suggestedTrigger}

[세그먼트 조건 가이드 — D214+ Unified Customer Profile 활용]

customer 조건:
- grade: ['VIP', '일반', '신규'] 등 등급 배열
- region: ['서울', '경기'] 등 지역 배열
- age_min / age_max: 연령 범위
- ltv_min: LTV (Life Time Value) 하한
- cart_add_count_30d_min: 30일 안 장바구니 추가 횟수 하한
- last_activity_days_ago_max: 마지막 활동 N일 안

events 조건 (cdp_events 매칭):
- cart_add_within_days: 지난 N일 안 cart_add 이벤트 발생
- purchase_within_days: 지난 N일 안 purchase 이벤트 발생
- page_view_within_days: 지난 N일 안 page_view 이벤트 발생

[Liquid 개인화 변수 — 본문/제목에 활용]

활용 가능한 변수 (Liquid 표기):
- {{ customer.name }} — 회원명
- {{ customer.grade }} — 등급
- {{ customer.points }} — 적립 포인트
- {{ customer.recent_product }} — 직전 본 상품
- {{ customer.cart_count }} — 장바구니 항목 수
- {{ customer.last_purchase_days_ago }} — 마지막 구매 N일 전

personalization_vars 배열 = 본 메시지에 활용한 변수 명칭 (예: ["customer.name", "customer.cart_count"])

★ 제목 (title) 안 변수 / Liquid 사용 X — 모든 회원에게 동일 단순 텍스트만 (제목은 통신사 표시 부분 좁음 + 가독성 우선)
✓ 본문 (body) 안 변수 / Liquid 적극 활용 권장

${dataProfilePrompt}

[다중 CTA 가이드]

buttons 배열 (최대 3개):
- id: 'btn_primary' / 'btn_secondary' / 'btn_tertiary' 등 고유 ID (click 트래킹 분리용)
- label: 버튼 텍스트 (10자 안)
- action_url: 클릭 시 이동 URL (또는 null = dismiss). URL 모르는 경우 \`[URL — 회사 admin 수정]\` placeholder
- style: 'primary' (강조) / 'secondary' / 'tertiary' (약함)
- background_color / text_color: hex 색상

[시간대 / 요일 / 빈도]

- send_start_hour / send_end_hour: 노출 시간대 (0~23, null = 24h)
  ✗ 새벽 노출 위험 (23~7시) 권장 X — 9~22 권장
- allowed_weekdays: 노출 요일 배열 [0=일, 1=월, ..., 6=토] (default [0,1,2,3,4,5,6])
- display_frequency: once_per_session / once_per_day / always
- auto_dismiss_seconds: 자동 닫힘 N초 (null = 사용자 수동 닫음만)
- max_displays_per_user: 사용자별 최대 노출 횟수 (null = 무한)

[애니메이션]

- fade / slide / bounce / pulse 중 선택 (default fade)
- template별 권장:
  - top_banner / bottom_banner = slide
  - center_modal / full_screen = fade
  - slide_in = slide
  - inline_card = fade
  - toast = bounce
  - floating_button = pulse

[is_ad 광고 표기]

- 마케팅성 메시지 (혜택 / 할인 안내) = is_ad: true
- 단순 안내 / 환영 / 감사 인사 = is_ad: false
- is_ad: true 시 = SDK가 자동으로 "(광고)" 표기 + 무료거부 080 자동 합성

[★ 응답 JSON 형식 — 반드시 본 구조 ★]

\`\`\`json
{
  "title": "메시지 제목 (18자 안, 변수 X)",
  "body": "메시지 본문 (40~70자, 1~2문장 — 짧고 강렬, 변수/Liquid 활용 가능)",
  "badge_text": "짧은 라벨 8자 안 (NEW · VIP · 오랜만이에요 — 구체 혜택·수치 X)",
  "template": "top_banner | bottom_banner | center_modal | full_screen | slide_in | inline_card | toast | floating_button",
  "image_url": null,
  "buttons": [
    { "id": "btn_primary", "label": "자세히 보기", "action_url": "[URL — 회사 admin 수정]", "style": "primary", "background_color": "#4f46e5", "text_color": "#ffffff" }
  ],
  "background_color": "#4f46e5",
  "text_color": "#ffffff",
  "segment_conditions": {
    "customer": { "grade": ["VIP"] },
    "events": {}
  },
  "trigger_conditions": {
    "event": "page_load"
  },
  "personalization_vars": ["customer.name"],
  "display_frequency": "once_per_session",
  "auto_dismiss_seconds": null,
  "max_displays_per_user": 3,
  "send_start_hour": 9,
  "send_end_hour": 22,
  "allowed_weekdays": [0,1,2,3,4,5,6],
  "animation": "fade",
  "is_ad": false,
  "reasoning": "본 인앱 메시지 선택 이유 + template/트리거/세그먼트 결정 근거 (한국어 3~5 문장)"
}
\`\`\`

응답은 반드시 위 JSON 객체만. JSON 외 텍스트 X.`;

  const userMessage = `목표: ${effectiveObjective}

위 목표 + 회사 컨텍스트 + 시즌 + 회사 메모리 + 데이터 프로필을 기반으로 완전한 인앱 메시지 패키지를 작성해주세요.

영구 룰 준수 의무:
- 구체 혜택 (% / 원 / 무료 / 쿠폰 / 할인) 절대 임의 작성 X — \`[혜택 안내 — 직접 작성해주세요]\` placeholder만 사용
- 본문 40~70자 짧고 강렬하게 (한두 문장, 군더더기 X)
- 제목 18자 안 + 변수 / Liquid 사용 X (단순 텍스트만)
- badge_text 8자 안 짧은 라벨 (혜택·수치 X)
- segment_conditions / trigger_conditions / personalization_vars 자연어 목표에 정확한 매핑

응답은 위 응답 JSON 형식 그대로.`;

  // AI Operator 영역 호출 (model: 'opus')
  const aiResult = await callAIWithFallback({
    system,
    userMessage,
    model: 'opus',
    maxTokens: 4096,
    temperature: 0.7,
    companyId: input.companyId,
    source: 'inapp-ai-generator', // ★ D227+ 종량제: 인앱 생성 3크레딧
  });

  const jsonText = extractJSON(aiResult || '');
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e: any) {
    throw new Error(`AI 응답 JSON 파싱 실패: ${e.message}\n응답 앞 300자: ${jsonText.slice(0, 300)}`);
  }

  // 응답 검증 + 안전 default
  const scenarioStyle = input.templateHint ? SCENARIO_STYLE[input.templateHint] : null;
  const message: GeneratedInAppMessage = {
    title: String(parsed.title || '').slice(0, 100),
    body: String(parsed.body || ''),
    badge_text: (String(parsed.badge_text || '').slice(0, 20) || scenarioStyle?.badge || null),
    template: validateTemplate(parsed.template) || suggestedTemplate,
    image_url: null, // AI 이미지 환각 차단 — 존재하지 않는 URL 생성 방지(D152 AI 창작 금지 정합). 이미지는 회사 admin 직접 업로드만.
    buttons: Array.isArray(parsed.buttons) ? parsed.buttons.slice(0, 3).map((b: any, idx: number) => ({
      id: String(b.id || `btn_${idx}`),
      label: String(b.label || '').slice(0, 30),
      action_url: b.action_url || null,
      style: ['primary', 'secondary', 'tertiary'].includes(b.style) ? b.style : 'primary',
      background_color: String(b.background_color || '#4f46e5'),
      text_color: String(b.text_color || '#ffffff'),
    })) : [],
    background_color: String(parsed.background_color || scenarioStyle?.background || '#4f46e5'),
    text_color: String(parsed.text_color || scenarioStyle?.textColor || '#ffffff'),
    segment_conditions: parsed.segment_conditions || {},
    trigger_conditions: parsed.trigger_conditions || { event: 'page_load' },
    personalization_vars: Array.isArray(parsed.personalization_vars) ? parsed.personalization_vars : [],
    display_frequency: ['once_per_session', 'once_per_day', 'always'].includes(parsed.display_frequency)
      ? parsed.display_frequency
      : 'once_per_session',
    auto_dismiss_seconds: parsed.auto_dismiss_seconds ?? null,
    max_displays_per_user: parsed.max_displays_per_user ?? null,
    send_start_hour: parsed.send_start_hour ?? null,
    send_end_hour: parsed.send_end_hour ?? null,
    allowed_weekdays: Array.isArray(parsed.allowed_weekdays) ? parsed.allowed_weekdays : [0, 1, 2, 3, 4, 5, 6],
    animation: ['fade', 'slide', 'bounce', 'pulse'].includes(parsed.animation) ? parsed.animation : 'fade',
    is_ad: Boolean(parsed.is_ad),
  };

  // 6 sub-agent 진행 — Frontend 시각 효과용 응답 (5~10초 시뮬레이션)
  const progressSteps: SubAgentStep[] = [
    { name: 'trigger_detection',  status: 'completed', hint: '자연어 목표에서 트리거 자동 추출' },
    { name: 'audience_match',     status: 'completed', hint: 'D214+ Unified Customer Profile 세그먼트 자동 매핑' },
    { name: 'template_selection', status: 'completed', hint: `${message.template} template 선택 (8종 중)` },
    { name: 'copy_design',        status: 'completed', hint: `${message.body.length}자 본문 작성 (시즌 감성 + 가치 제안)` },
    { name: 'variant_generation', status: 'completed', hint: 'A/B variant 생성 가능 (별도 호출 — POST /inapp/variant)' },
    { name: 'review_ready',       status: 'completed', hint: '회사 admin 검토 + 편집 진입 (혜택 placeholder 직접 작성 의무)' },
  ];

  return {
    message,
    reasoning: String(parsed.reasoning || ''),
    progress_steps: progressSteps,
  };
}
