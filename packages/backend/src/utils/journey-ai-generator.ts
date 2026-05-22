/**
 * CT-45: Journey AI Generator — D187-fix3 One-shot AI Operator (2026-05-21)
 *
 * 목적
 *   자연어 한 줄 → 완전 여정 패키지 자동 생성. 진정 AI Operator 본질 정합.
 *   Sonnet 4.6 + ai_company_memory + 시즌 컨텍스트 + 회사 톤 + 메모리 통합 (D209+ 전환 — 기존 ai.ts 흐름 정합).
 *
 * 영구 룰 정합
 *   - ai_operator_model_isolation: model:'sonnet' (D209+ Harold 명시 전환 — 기존 ai.ts 정합 모델)
 *   - ai_no_arbitrary_benefit: 구체 혜택(% / 원 / 무료 / 쿠폰) 임의 작성 X
 *       안내문/인사/감성 텍스트는 풍성, 혜택 영역만 [혜택 안내 — 직접 수정해주세요] placeholder
 *   - no_humuson_keyword_exposure: 검수 단어 X
 *   - 회사 격리: company_id FK
 *   - (광고)+080+KISA 제목 = 시스템 자동 합성 (직접 작성 X)
 */

import { callAIWithFallback } from '../services/ai';
import { buildMemoryPromptContext } from './company-memory';
import { query } from '../config/database';
import { sanitizeForSms } from './message-sanitizer';
// ★ D210+ Phase 2 (Harold 명시 2026-05-23): CT-58 — 회사 customer DB 실측 프로필 동적 주입.
//   본질 = AI가 어설픈 변수 임의 작성 차단 (Harold 명시: "개인화 어설프게 실수로 들어가는게 더 안좋다").
import { getCompanyDataProfile, formatProfileForAiPrompt } from './company-data-profile';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface JourneyAIGenerateInput {
  companyId: string;
  createdBy: string;
  objective?: string;
  templateHint?: 'onboarding' | 'repeat' | 'dormant' | 'cart' | 'birthday' | 'reservation' | 'custom';
}

export interface GeneratedStep {
  stepOrder: number;
  stepType: 'message';
  delayHours: number;
  channel: 'sms' | 'lms' | 'mms';
  messageTemplate: string;
  subject: string;
  isAd: boolean;
  stepIntent: string;
}

export interface JourneyAIPackage {
  name: string;
  templateCode: string;
  triggerEvent: string;
  triggerFilters: Record<string, any>;
  steps: GeneratedStep[];
  allowReentry: boolean;
  reentryCooldownDays: number | null;
  callbackNumberHint: string | null;
  budgetMonthlyHint: number | null;
  thresholdCostHint: number | null;
  reasoning: string;
}

export interface StepRefineInput {
  companyId: string;
  currentMessage: string;
  channel: 'sms' | 'lms' | 'mms';
  isAd: boolean;
  stepIntent?: string;
}

export interface StepRefineCandidate {
  message: string;
  tone: '감성적' | '실용적' | '캐주얼';
  bytes: number;
  reasoning: string;
}

// ════════════════════════════════════════════════════════════════════
// 시즌 컨텍스트 매트릭스 (KST 월 기준)
// ════════════════════════════════════════════════════════════════════

const SEASON_BY_MONTH: Record<number, { season: string; keywords: string[] }> = {
  1:  { season: '겨울', keywords: ['새해', '새출발', '신년 계획', '추위', '연말정산'] },
  2:  { season: '겨울 끝', keywords: ['설날', '발렌타인데이', '입학 준비', '봄맞이'] },
  3:  { season: '봄', keywords: ['새 학기', '봄꽃', '환절기', '새로운 시작', '화이트데이'] },
  4:  { season: '봄', keywords: ['벚꽃', '봄나들이', '식목일', '야외활동'] },
  5:  { season: '봄 끝', keywords: ['가정의달', '어린이날', '어버이날', '스승의날', '부부의날', '봄 마무리'] },
  6:  { season: '초여름', keywords: ['호국보훈의달', '현충일', '여름맞이', '장마 준비'] },
  7:  { season: '여름', keywords: ['장마', '바캉스', '휴가', '제헌절', '여름 휴가'] },
  8:  { season: '여름', keywords: ['휴가 절정', '광복절', '여름 마무리', '개학 준비'] },
  9:  { season: '가을', keywords: ['추석', '한가위', '환절기', '가을맞이'] },
  10: { season: '가을', keywords: ['단풍', '국군의날', '개천절', '한글날', '가을 정취'] },
  11: { season: '늦가을', keywords: ['빼빼로데이', '수능', '김장', '겨울맞이'] },
  12: { season: '겨울', keywords: ['크리스마스', '연말', '송년', '겨울 휴가', '새해 준비'] },
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
  rejectNumber: string | null;
}

async function loadCompanyContext(companyId: string): Promise<CompanyContext> {
  const r = await query(
    `SELECT company_name, brand_name, brand_tone, business_type,
            COALESCE(reject_number, opt_out_080_number) AS reject_number
     FROM companies WHERE id = $1::uuid`,
    [companyId]
  );
  const row = r.rows[0] || {};
  return {
    companyName: row.company_name || '',
    brandName: row.brand_name || null,
    brandTone: row.brand_tone || null,
    businessType: row.business_type || null,
    rejectNumber: row.reject_number || null,
  };
}

function getBytes(s: string): number {
  let b = 0;
  for (let i = 0; i < s.length; i++) b += s.charCodeAt(i) > 127 ? 2 : 1;
  return b;
}

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

// ════════════════════════════════════════════════════════════════════
// 핵심: 자연어 한 줄 → 완전 여정 패키지
// ════════════════════════════════════════════════════════════════════

export async function generateJourneyPackage(input: JourneyAIGenerateInput): Promise<JourneyAIPackage> {
  if (!input.objective && !input.templateHint) {
    throw new Error('objective (자연어) 또는 templateHint (7 표준 단축) 중 하나는 필수입니다.');
  }

  const ctx = await loadCompanyContext(input.companyId);
  const memoryContext = await buildMemoryPromptContext(input.companyId, 30).catch(() => '');
  const season = getSeasonContext();
  // ★ D210+ Phase 2 (Harold 명시 2026-05-23): 회사 customer DB 실측 프로필 (CT-58).
  //   AI 시스템 프롬프트 안 안전/분기/차단 3단계 분류 동적 주입.
  const dataProfile = await getCompanyDataProfile(input.companyId).catch(() => null);
  const dataProfilePrompt = dataProfile ? formatProfileForAiPrompt(dataProfile) : '';

  const system = `당신은 한국 마케팅 자동화 여정 설계 전문가입니다.
회사 admin이 입력한 자연어 목표 또는 표준 템플릿 진입을 받아 완전한 여정 패키지를 JSON으로 응답합니다.

[회사 컨텍스트]
- 회사명: ${ctx.companyName}
- 브랜드명: ${ctx.brandName || '(미설정)'}
- 톤앤매너: ${ctx.brandTone || '친근함'}
- 업종: ${ctx.businessType || '(미설정)'}

[현재 시점 컨텍스트 — KST]
- 현재 월: ${season.month}월 (${season.season})
- 시즌 키워드: ${season.keywords.join(', ')}
- 이 시즌의 자연스러운 단어/감성/이벤트를 메시지에 녹여내세요.

${memoryContext}

[설계 원칙]
1. 표준 트리거 매트릭스 (자연어 목표에서 자동 매칭):
   - customer.created (24h 안 신규 가입) — 환영/온보딩 시리즈
   - cdp.purchase (구매 직후 5분) — 후기/재구매 유도
   - customer.dormant (휴면 N일+) — 회수 시리즈
   - cdp.cart_abandon (장바구니 24h+ 결제 X) — 회복 시리즈
   - customer.birthday_approaching (D-N) — 생일 축하
   - cdp.reservation_created — 예약 follow-up
   - custom (위 외 자유 — 정기 발송 / 신상품 알림 / VIP 감사 등)

2. step 개수: 2~5개 (목표 + 시계열에 맞춰 자동 결정)
3. delay_hours: 0(즉시) / 24(1일) / 72(3일) / 168(7일) / 336(14일) / 720(30일) 자연 단위
4. channel: 'lms' default (광고 표기 + 무료거부 자동 합성 시 90바이트 SMS 한계 초과)
5. isAd: 마케팅성은 true default (정보 안내성만 false)
6. subject (제목): LMS/MMS 채널 시 필수 — 한 줄 20자 안 / 본문 핵심을 단순 요약 / 호기심 유발 / 시즌감
   ★ Harold 명시 영구 룰: 제목은 변수(%고객명% / %이름% 등) + Liquid 문법({{ }} / {% %}) 절대 사용 금지. 모든 수신자에게 동일 단순 텍스트만 사용 (가독성 + 통신사 표시 영역 좁음 + 개인화는 본문에서).
   좋은 예시: "곧 다가올 생일을 미리 축하해요" / "VIP만 받는 봄 안내" / "오랜만에 안부 전해요" / "이번 달 감사 인사" / "봄나들이 시즌 새 소식"
   나쁜 예시: "%고객명%님, 곧 생일이에요" (변수 X) / "{{ customer.name }}님 안내" (Liquid X)
   SMS 채널은 빈 문자열 ""로 응답 (제목 없음).
7. allow_reentry / reentry_cooldown_days: 시리즈에 맞춰 자동 결정
   - 가입 온보딩: false / null
   - 재구매: true / 0
   - 휴면: true / 90
   - 장바구니: true / 7
   - 생일: true / 365
   - 예약: true / 0
   - 정기 발송: true / 0 또는 30

[메시지 작성 원칙 — 매우 중요]
★ Harold 명시 영구 룰 — 본문은 보다 풍성하게 작성 의무 (단순 1~2 줄 안내 X)

★ ★ ★ 브랜드 격조 영구 룰 (Harold 명시 D191-fix2) ★ ★ ★
✗ 저렴한 단어 / 친근감 과한 단어 사용 절대 금지:
   - "단골" / "단골 고객님" / "단골 손님" — 격조 X 본질, 브랜드 가치 손상 (저렴 인상)
   - "사장님이 직접" / "초특가" / "역대급" — 광고 톤 X
✓ 대체 표현 매트릭스 (격조 + 정중 + 감사 본질):
   - "단골" → "오랜 시간 함께해주신" / "꾸준한 관심을 보내주신" / "변함없이 찾아주시는" / "한결같은 신뢰를 보내주신"
   - "단골 고객님" → "오래 함께해주신 고객님" / "소중한 고객님" / "꾸준히 사랑해주시는 고객님"
✓ 브랜드 톤 본질: 격조 / 정중함 / 진심 어린 감사 / 절제된 감성 — 친근한 대화체 X, 정중한 안부 O
✓ 안내문 / 인사 / 감성 텍스트 / 시즌 단어 / 회사 톤 = 매우 풍성하게 직접 작성 (마케팅 가치 본질)
   - 단순 "안녕하세요 고객님" 수준 X = 시즌 묘사 + 감성 어휘 + 안부 + 회사 소식 + CTA 안내까지 자연스럽게 전개
   - 한국 마케팅 정합 분량 = LMS 300~500바이트 (광고 합성 후 380~580바이트) — 단순 단답 X 풍성 본문 의무
   - 줄바꿈 / 단락 활용으로 가독성 정합 (3~5 단락 권장)
✗ 구체 혜택 (% / 원 / 무료 / 쿠폰 / 사은품 / 적립 / 할인 / 무료배송) = 절대 임의 작성 금지
  대신 \`[혜택 안내 — 직접 수정해주세요]\` placeholder만 정확히 사용
✓ URL = http(s):// 실제 URL 직접 작성 가능 (D190 #1 강화) — 발송 시점 자동 단축 URL 변환 (hanjul.ai/c/xxxxxxxx, 30자) + 클릭 트래킹 + Bandit 학습 자동 활성. 회사 자사몰 URL이 정합되지 않은 영역은 \`[URL — 회사 admin 수정]\` placeholder 사용
✗ (광고) 표기 직접 작성 X (시스템 자동 합성)
✗ 무료수신거부 080 직접 작성 X (시스템 자동 합성)
✓ %고객명% 변수 사용 권장 (본문 영역만 — 제목 영역은 변수 X)
✓ LMS 300~500바이트 권장 (광고 합성 후 380~580바이트)

[★ ★ ★ 보존 영역 vs 자유 영역 분리 (D209+ Harold 명시 강화 — 옛 ai.ts 정합 통합) ★ ★ ★]
✓ 보존 영역 (절대 변경 X — 회사 admin이 직접 작성할 영역):
   - 구체 혜택 (% / 원 / 무료 / 쿠폰 / 사은품 / 적립 / 무료배송) → [혜택 안내 — 직접 수정해주세요] placeholder
   - 상품명 / 매장명 / 일시 / 숫자 / 연락처 / 주소 / URL → [URL 입력] placeholder 또는 실제 URL 작성
   - 변수 {{ customer.X }} / %고객명% → 자리 그대로 보존
✓ 자유 영역 (적극 활용 — 카피라이터 감각으로):
   - 수식어 / 감성 표현 ("기다리시던" / "소중한" / "정성스럽게" / "오랜 시간 함께해주신")
   - 시즌 묘사 (현재 시즌 키워드 + 자연스러운 1~2 줄 묘사)
   - 1:1 대화감 (단체 안내 X, 브랜드가 나한테 직접 보낸 느낌)
   - 문장 리듬 (짧은 문장 + 긴 문장 교차)
   - 호기심 갭 (정보 일부 열고 나머지 궁금증 유발 — 사용자가 URL 클릭하고 싶은 느낌)

[★ ★ ★ 뻔한 표현 금지 (D209+ Harold 명시 강화 — 옛 ai.ts 정합 통합) ★ ★ ★]
✗ "안녕하세요 고객님" — 금지 (시즌감 / 질문 / 숫자로 시작)
✗ "특별한 혜택 / 소식 / 선물" — 금지 (구체 혜택 placeholder 사용)
✗ "준비했어요 / 준비했습니다" — 금지 ("지금 ~할 수 있어요" 또는 시즌 도입부로)
✗ "소중한 고객님" — 금지 (%고객명% 또는 {{ customer.name }} 직접 활용)
✗ "다양한 혜택" — 금지 (핵심 1가지 구체 placeholder)
✗ "많은 관심 부탁드립니다" — 금지 (구체 CTA로)
✗ 느낌표 폭탄 (!!!) — 전체에서 최대 2~3개
✗ 과장 형용사 ("초특가" / "역대급" / "미친" / "대박") — 금지

[★ Liquid 동적 콘텐츠 — D191 강화 (사용자별 1:1 개인화)]
회사 admin이 고급 1:1 동적 콘텐츠를 원할 때 Liquid 문법 활용 권장. 발송 시점 사용자별 자동 분기 + 변수 계산:
✓ 변수 출력: {{ customer.name }} / {{ customer.grade }} / {{ customer.points }}
✓ 기본값 fallback: {{ customer.name | default: '고객' }} (값 없으면 '고객'으로 자동 대체)
✓ 숫자 포맷: {{ customer.points | format_number }} → 2,300 (한국 천 단위 콤마 자동)
✓ 조건 분기: {% if customer.grade == 'VIP' %} VIP 안내 {% elsif customer.purchase_count > 10 %} 오래 함께한 고객 안내 {% else %} 일반 안내 {% endif %}
✓ 계산: {{ customer.points | minus: 1000 }} (포인트 차감) / {{ customer.amount | times: 0.1 | round: 0 }} (10% 환산)
✓ 등급별 인사 / 지역별 매장 안내 / 직전 구매 회상 = 1개 메시지로 N가지 분기 자동 처리

[Liquid 활용 가이드 — AI 작성 시 의무]
- 회사 admin이 "등급별 분기 / 지역별 / 직전 구매 회상" 영역 명시 시 Liquid 적극 활용
- Liquid 분기 안의 구체 혜택 텍스트도 동일 룰: % / 원 / 무료 등 임의 작성 X → \`[혜택 안내 — 직접 수정해주세요]\` placeholder
- 단순 일률 발송 영역은 Liquid 미사용 (기존 %고객명% 변수만 사용 권장)
- ★ D210+ Phase 2 — 모르는 필드(customer.X) 사용 절대 금지. 아래 [회사 실측 데이터 활용 매트릭스]의 안전/분기 변수만 사용 의무.

${dataProfilePrompt}

[★ ★ ★ 날씨 Liquid 변수 — D209+ 신규 (Connected Content 통합) ★ ★ ★]
✗ 날씨 단순 단어 직접 작성 절대 금지 ("맑음" / "비" / "눈" / "흐림" / "쌀쌀해요" / "더워요" / "화창" / "쌀쌀") — 발송 시점 실시간 날씨와 불일치 사고 위험 (예: "오늘 날씨 화창해요" 박은 메시지가 폭우 영역에 발송 = 신뢰 파괴)
✓ 발송 시점 실시간 자동 분기는 Liquid 변수 의무:
   - {{ weather.summary }} — 고객 region 기준 현재 날씨 한 줄 ("맑음 18°C" 등)
   - {{ weather.store.summary }} — 매장 region 기준 (매장 단독 행사 영역 의무 — 예: "강남점 봄 행사")
   - {{ weather.temp }} / {{ weather.condition }} — 온도 / 상태 (분기 조건용)
✓ 분기 예시 — 폭우 / 폭염 / 눈 영역 안내:
   {% if weather.condition == 'Rain' %}
   비 오는 오늘, 매장 방문이 어려우신 분들을 위해
   {% elsif weather.temp > 30 %}
   더위 속에도 발걸음 해주시는 분들께
   {% else %}
   오늘 날씨와 함께
   {% endif %}
✓ 매장 단독 행사 영역 (회사 admin이 "강남점 봄 행사" / "부산점 가을 세일" 명시 시) = {{ weather.store.summary }} 의무

[★ ★ ★ AI 자율 예측 점수 활용 가이드 — D197 신규 (Predictive Suite 통합) ★ ★ ★]
발송 시점에 customer 객체에 자동 첨부되는 3 예측 점수 (0~1 매트릭스):
✓ {{ customer.click_score }} — 다음 메시지 클릭 가능성
✓ {{ customer.churn_risk }} — 이탈 위험 (높을수록 회복 캠페인 의무)
✓ {{ customer.purchase_likelihood }} — 구매 가능성 (높을수록 구매 유도)

[AI 자율 분기 작성 가이드 — 회사 admin이 "이탈 고객 회복" / "구매 유도" / "AI가 알아서 분기" 영역 명시 시 적극 활용]

예시 1 — 이탈 위험 분기:
{{ customer.name }}님,
{% if customer.churn_risk > 0.7 %}
오랜만에 인사드려요. 곧 봄을 맞아 [회복 안내 — 직접 작성해주세요] 준비했어요.
{% elsif customer.purchase_likelihood > 0.6 %}
{{ customer.name }}님께 어울리는 새 상품 [추천 안내 — 직접 작성해주세요]
{% else %}
이번 봄 새로운 소식 전해드려요.
{% endif %}

예시 2 — 클릭 가능성 + 등급 통합:
{{ customer.name }}님,
{% if customer.click_score > 0.4 and customer.grade == 'VIP' %}
VIP 회원님께 먼저 안내드리는 봄 소식.
{% elsif customer.churn_risk > 0.6 %}
오랜만에 안부 전해드려요.
{% else %}
봄 새 소식 안내.
{% endif %}

[Predictive 점수 분기 본질 룰]
✓ 점수는 발송 시점 자동 계산 (cache 24h TTL)
✓ 신규 회사 영역도 cold start fallback 정합 — 등급별 평균 점수 사용
✓ 데이터 누적 시 모델 자동 정확도 향상 — 시간 지날수록 정확도↑
✗ 점수 자체를 메시지에 직접 노출 금지 (예: "당신의 이탈 위험은 87%입니다" X)
✗ Liquid 분기 안 구체 혜택 임의 작성 X — placeholder 유지 의무

[★ 문자 사용 절대 룰 — 한국 통신사 SMS/LMS 표준]
✗ 이모지 절대 사용 금지 — 🎂 🎉 💝 🌸 🎁 ✨ 💌 🌷 🍀 ❤ 등 모든 이모지 통신사 미지원 (발송 실패 / 깨짐 위험)
✗ 비표준 특수문자 사용 금지:
  - 대시: — – ‐ (대신 - 사용)
  - 화살표: ▶ ▷ ➤ ➜ (대신 > 사용 or "자세히 →" 단어 형태)
  - 표시: ★ ☆ ✓ ✗ ◆ ※ ‣ • (대신 * V X · 사용 or 단어로 풀어쓰기)
  - 따옴표: " " ' ' 『 』 (대신 표준 " ' 사용)
  - 전각 기호: ＆ ％ ＋ ？ ！ (대신 표준 & % + ? ! 사용)
✓ 허용 단어: 한글 / 영문 / 숫자 / 표준 기호 ( . , ! ? : ; ( ) [ ] " ' + - * / = @ # $ % & | < > → ) / 줄바꿈
✓ SMS 호환 특수문자 화이트리스트 (D209+ 강화 — EUC-KR 통신사 검증 정합): ★ ☆ ♥ ♡ ◆ ◇ ■ □ ▲ △ ▶ ◀ ● ○ ◎ ♨ ※ ☞ ☎ ① ② ③ ④ ⑤ ↑ ↓ ← → ㈜ ㎝ ㎏ ㎡
✓ "→" 단어는 자세히 안내 화살표로 허용

[좋은 메시지 예시 — 5월 생일 D-7 사전 안내 (풍성 본문 + 단순 제목)]
제목: "곧 다가올 생일을 미리 축하해요"

본문:
%고객명%님, 안녕하세요.

봄의 끝자락, 5월의 따뜻한 햇살이 가득한 이 계절에
곧 다가올 %고객명%님의 생일을 미리 떠올려봤어요.

가정의 달 5월은 사랑하는 사람들과 함께하는 특별한 시간이죠.
한 해 한 살 더 나이를 먹는다는 건
그만큼 더 많은 추억과 이야기가 쌓인다는 의미이기도 해요.

%고객명%님의 이번 생일은
조금 더 특별하게 기억되길 바라는 마음으로 작은 선물을 준비했어요.

[혜택 안내 — 직접 수정해주세요]

미리 축하드려요. 생일 당일까지 즐거운 봄날 되시길.

자세히 → [URL 입력]

[좋은 메시지 예시 — 등급별 1:1 분기 (Liquid 활용 + 풍성 본문 + 단순 제목)]
제목: "오랜만에 안부 전해요"

본문:
{{ customer.name | default: '고객' }}님, 안녕하세요.

{% if customer.grade == 'VIP' %}
저희 매장의 VIP 회원님이신 {{ customer.name }}님께
먼저 전하고 싶은 봄 소식이 있어 인사드려요.

오랜 시간 변함없이 찾아주시는 발걸음 하나하나가
저희에게는 가장 큰 힘이 되고 있어요.

VIP 회원님만을 위해 준비한 이번 봄 특별 안내,
가장 먼저 받아보실 수 있도록 정성껏 준비했답니다.
{% elsif customer.purchase_count > 10 %}
{{ customer.name }}님과 함께한 {{ customer.purchase_count }}번의 만남,
어느덧 오랜 시간 함께해주신 소중한 고객님이 되어주셨네요.

매번 변함없는 신뢰로 찾아주셔서 진심으로 감사드려요.
{{ customer.name }}님 같은 고객님이 계셔서
저희가 더 좋은 제품과 서비스를 고민할 수 있어요.

봄을 맞아 오래 함께해주신 분들께만 전해드리는 특별한 인사 준비했어요.
{% else %}
봄꽃이 한창인 요즘, 새로운 소식 전해드리고 싶어
{{ customer.name }}님께 인사드려요.

따뜻해진 날씨처럼 마음도 한결 가벼워지는 계절이에요.
이번 봄, 저희가 준비한 새로운 이야기에
%고객명%님의 일상에도 작은 즐거움을 더해드릴게요.
{% endif %}

[혜택 안내 — 직접 수정해주세요]

자세히 → [URL 입력]

[좋은 메시지 예시 — 신규 가입 환영 (D209+ 신규 Onboarding LMS — 풍성 본문 + 단순 제목)]
제목: "함께하게 되어 진심으로 반가워요"

본문:
{{ customer.name | default: '고객' }}님, 안녕하세요.

오늘 저희 매장의 새 가족이 되어주셔서
진심으로 감사한 마음을 먼저 전해요.

봄꽃이 한창인 이 계절, 첫 인연을 맺게 된 {{ customer.name | default: '고객' }}님께
저희가 가장 정성껏 준비한 첫 인사를 드리고 싶었어요.

처음 만나는 분께만 드리는 작은 선물 한 가지,
오래 함께해주실 분들을 위해 정성껏 준비했답니다.

[혜택 안내 — 직접 수정해주세요]

자세히 → [URL 입력]

[좋은 메시지 예시 — 휴면 고객 회복 (D209+ 신규 Dormant LMS — Predictive churn_risk 활용)]
제목: "오랜만에 안부 전해드려요"

본문:
{{ customer.name | default: '고객' }}님, 안녕하세요.

{% if customer.churn_risk > 0.7 %}
오랜 시간 발걸음이 뜸하셨네요.
혹시 그동안 불편하셨던 영역이 있었다면 부족함을 먼저 사과드리고 싶어요.

다시 한 번 좋은 인연으로 이어가고 싶은 마음으로
오랜 시간 함께해주신 분들께만 전해드리는 회복 안내 준비했답니다.

[혜택 안내 — 직접 수정해주세요]
{% else %}
계절이 바뀌어가는 요즘, 잘 지내고 계신지 안부 전해드려요.

새로운 봄 소식과 함께 {{ customer.name | default: '고객' }}님께
어울리는 작은 안내 드리고 싶었어요.

[혜택 안내 — 직접 수정해주세요]
{% endif %}

자세히 → [URL 입력]

[budget / threshold]
- budgetMonthlyHint: NULL = 무제한 default (회사 자유)
- thresholdCostHint: NULL = 무제한 default (회사 자유)

[출력 JSON 형식 — 다른 텍스트 없이 JSON만]
{
  "name": "여정 이름 (한국어, 30자 안)",
  "templateCode": "onboarding|repeat|dormant|cart|birthday|reservation|custom",
  "triggerEvent": "customer.created 등",
  "triggerFilters": { "recent_hours": 24 },
  "steps": [
    {
      "stepOrder": 1,
      "stepType": "message",
      "delayHours": 0,
      "channel": "lms",
      "subject": "한 줄 20자 안 제목 (LMS/MMS만)",
      "messageTemplate": "...풍성 본문... [혜택 안내 — 직접 수정해주세요] ... → [URL 입력]",
      "isAd": true,
      "stepIntent": "환영 인사 + 첫 구매 안내"
    }
  ],
  "allowReentry": false,
  "reentryCooldownDays": null,
  "budgetMonthlyHint": null,
  "thresholdCostHint": null,
  "reasoning": "AI가 결정한 흐름의 한 줄 근거 (회사 admin 검토용)"
}`;

  let userMessage: string;
  if (input.objective && input.objective.trim().length >= 3) {
    userMessage = `여정 목표: ${input.objective.trim()}\n\n위 회사 컨텍스트 + 시즌 + 메모리를 종합하여 완전한 여정 패키지 JSON을 응답하세요. 시즌 단어를 자연스럽게 녹여내고, 혜택 영역은 placeholder로 처리하세요.`;
  } else {
    userMessage = `7 표준 시리즈 단축 진입: ${input.templateHint}\n\n위 회사 컨텍스트 + 시즌 + 메모리에 맞춰 ${input.templateHint} 시리즈의 표준 흐름을 풍성하게 작성한 JSON 응답하세요.`;
  }

  // ★ D209+ (Harold 명시 2026-05-22): Sonnet 4.6 전환 — 기존 ai.ts generateMessages 시스템 프롬프트
  //   매트릭스(D152 + D80 정합) 정합 본질 + 비용 80% 절감.
  //   Phase D 통합: companyId + source 전달 → 회사별 월 한도 + cache + 통계 자동 활성.
  const text = await callAIWithFallback({
    system,
    userMessage,
    maxTokens: 4096,
    temperature: 0.4,
    model: 'sonnet',
    companyId: input.companyId,
    source: 'journey-ai-generate',
  });

  let parsed: any;
  try {
    parsed = JSON.parse(extractJSON(text));
  } catch (err: any) {
    console.error('[journey-ai-generator] JSON parse 실패. raw:', text.slice(0, 500));
    throw new Error('AI 응답 JSON 파싱 실패. 다시 시도해주세요.');
  }

  const rawSteps: any[] = Array.isArray(parsed.steps) ? parsed.steps : [];
  const steps: GeneratedStep[] = rawSteps.slice(0, 5).map((s: any, idx: number) => {
    const channel = ['sms', 'lms', 'mms'].includes(s.channel) ? s.channel : 'lms';
    // ★ D187-fix5: AI 응답에 이모지/비표준 특수문자 포함 가능성 — sanitize 자동 적용
    const rawMessage = String(s.messageTemplate || '').slice(0, 2000);
    const rawSubject = channel === 'sms' ? '' : String(s.subject || '').slice(0, 50);
    const messageSan = sanitizeForSms(rawMessage);
    const subjectSan = sanitizeForSms(rawSubject);
    if (messageSan.hadChanges) {
      console.log(`[journey-ai-generator] step ${idx + 1} message sanitize:`, messageSan.warnings.join(' / '));
    }
    if (subjectSan.hadChanges) {
      console.log(`[journey-ai-generator] step ${idx + 1} subject sanitize:`, subjectSan.warnings.join(' / '));
    }
    return {
      stepOrder: Number(s.stepOrder) || idx + 1,
      stepType: 'message' as const,
      delayHours: Math.max(0, Math.min(720, Number(s.delayHours) || 0)),
      channel,
      messageTemplate: messageSan.sanitized,
      subject: subjectSan.sanitized,
      isAd: s.isAd !== false,
      stepIntent: String(s.stepIntent || '').slice(0, 100),
    };
  });

  if (steps.length === 0) {
    throw new Error('AI가 유효한 step을 생성하지 못했습니다. 목표 문구를 더 명확히 작성해주세요.');
  }

  const cbRes = await query(
    `SELECT REPLACE(phone, '-', '') AS phone FROM callback_numbers
     WHERE company_id = $1::uuid AND is_default = true
     LIMIT 1`,
    [input.companyId]
  );
  const callbackHint = cbRes.rows[0]?.phone || null;

  const validTemplates = ['onboarding','repeat','dormant','cart','birthday','reservation','custom'];
  const templateCode = validTemplates.includes(parsed.templateCode) ? parsed.templateCode : 'custom';

  return {
    name: String(parsed.name || '여정').slice(0, 100),
    templateCode,
    triggerEvent: String(parsed.triggerEvent || 'custom').slice(0, 50),
    triggerFilters: typeof parsed.triggerFilters === 'object' && parsed.triggerFilters !== null ? parsed.triggerFilters : {},
    steps,
    allowReentry: !!parsed.allowReentry,
    reentryCooldownDays: parsed.reentryCooldownDays != null ? Math.max(0, Math.min(3650, Number(parsed.reentryCooldownDays))) : null,
    callbackNumberHint: callbackHint,
    budgetMonthlyHint: parsed.budgetMonthlyHint != null ? Number(parsed.budgetMonthlyHint) : null,
    thresholdCostHint: parsed.thresholdCostHint != null ? Number(parsed.thresholdCostHint) : null,
    reasoning: String(parsed.reasoning || '').slice(0, 500),
  };
}

// ════════════════════════════════════════════════════════════════════
// step별 AI 다듬기 — 3 후보 다양성 (감성 / 실용 / 캐주얼)
// ════════════════════════════════════════════════════════════════════

export async function refineStepMessage(input: StepRefineInput): Promise<{ candidates: StepRefineCandidate[] }> {
  if (!input.currentMessage || input.currentMessage.trim().length < 5) {
    return { candidates: [] };
  }

  const ctx = await loadCompanyContext(input.companyId);
  const memoryContext = await buildMemoryPromptContext(input.companyId, 20).catch(() => '');
  const season = getSeasonContext();

  const maxBytes = input.channel === 'sms' ? 90 : 2000;

  const system = `당신은 한국 마케팅 메시지 다듬기 전문가입니다.
회사 admin이 작성한 step 메시지를 받아 3가지 톤의 후보로 다듬어 JSON으로 응답합니다.

[회사 컨텍스트]
- 회사명: ${ctx.companyName}
- 브랜드명: ${ctx.brandName || '(미설정)'}
- 톤앤매너: ${ctx.brandTone || '친근함'}
- 업종: ${ctx.businessType || '(미설정)'}

[시즌 컨텍스트]
- 현재 ${season.month}월 (${season.season})
- 시즌 키워드: ${season.keywords.join(', ')}

${memoryContext}

[step 의도] ${input.stepIntent || '(미지정)'}

[다듬기 원칙]
✓ 원본의 의미 / 변수 / 혜택 placeholder([혜택 안내 — 직접 수정해주세요]) / URL placeholder 모두 보존
✓ 안내문 / 인사 / 감성 텍스트는 시즌과 회사 톤에 맞춰 풍성하게 정련
✗ 구체 혜택 (% / 원 / 무료 / 쿠폰) 임의 생성 금지 — placeholder 유지
✗ (광고) / 무료수신거부 080 직접 작성 X
✗ 날씨 단순 단어 직접 작성 X — {{ weather.summary }} / {{ weather.store.summary }} Liquid 변수 의무 (D209+ Connected Content 정합)
✓ 최대 ${maxBytes}바이트 안
✓ ★ D191 강화: Liquid 문법({{ }}, {% if %}, {% endif %}, {% elsif %}, {% else %}, | filter)이 원본에 있으면 정확히 보존. Liquid 분기 안 텍스트만 톤 정련. Liquid 미사용 영역은 기존대로 평문 처리.
✓ ★ D209+ 강화 (옛 ai.ts 정합 통합):
  - 뻔한 표현 금지: "안녕하세요 고객님" / "특별한 혜택" / "준비했어요" / "소중한 고객님" / "다양한 혜택" / "많은 관심 부탁드립니다" / 느낌표 폭탄 / 과장 형용사 ("초특가" / "역대급" / "미친" / "대박")
  - SMS 호환 특수문자 화이트리스트 (EUC-KR 통신사 검증 정합): ★ ☆ ♥ ♡ ◆ ◇ ■ □ ▲ △ ▶ ◀ ● ○ ◎ ♨ ※ ☞ ☎ ① ② ③ ④ ⑤ ↑ ↓ ← → ㈜ ㎝ ㎏ ㎡
  - 자유 영역 (수식어 / 감성 / 시즌감 / 1:1 대화감 / 호기심 갭) 적극 활용, 사실 영역 (숫자 / 장소 / 약속 / 혜택) 절대 보존

[3 후보 톤 매트릭스]
1. 감성적: 따뜻함 / 시즌감 강조 / 호기심 유발 / 정서적 공감
2. 실용적: 명확 / 정보 중심 / CTA 강조 / 구체적 안내
3. 캐주얼: 친근 / 가벼움 / 일상적 / 부담 X 톤

[출력 JSON — 다른 텍스트 금지]
{
  "candidates": [
    { "message": "...", "tone": "감성적", "reasoning": "..." },
    { "message": "...", "tone": "실용적", "reasoning": "..." },
    { "message": "...", "tone": "캐주얼", "reasoning": "..." }
  ]
}`;

  const userMessage = `원본 메시지:\n${input.currentMessage}\n\n위 메시지를 3가지 톤 후보로 다듬어 JSON으로 응답하세요. 혜택 placeholder + 변수는 그대로 유지하고 안내문/감성 텍스트만 정련하세요.`;

  // ★ D209+ (Harold 명시 2026-05-22): Sonnet 4.6 전환 — D152 AI 다듬기 정합 본질
  //   (기존 ai.ts 흐름과 동일 모델) + 비용 80% 절감.
  //   Phase D 통합: companyId + source 전달 → 회사별 월 한도 + cache + 통계 자동 활성.
  const text = await callAIWithFallback({
    system,
    userMessage,
    maxTokens: 3000,
    temperature: 0.5,
    model: 'sonnet',
    companyId: input.companyId,
    source: 'journey-ai-refine',
  });

  let parsed: any;
  try {
    parsed = JSON.parse(extractJSON(text));
  } catch {
    return { candidates: [] };
  }

  const raw: any[] = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  const validTones: Array<'감성적' | '실용적' | '캐주얼'> = ['감성적', '실용적', '캐주얼'];
  const candidates: StepRefineCandidate[] = raw.slice(0, 3).map((c: any) => {
    const rawMsg = String(c.message || '').slice(0, maxBytes * 2);
    // ★ D187-fix5: refine 응답도 sanitize 자동 적용
    const san = sanitizeForSms(rawMsg);
    return {
      message: san.sanitized,
      tone: validTones.includes(c.tone) ? c.tone : '감성적',
      bytes: getBytes(san.sanitized),
      reasoning: String(c.reasoning || '').slice(0, 200),
    };
  });

  return { candidates };
}
