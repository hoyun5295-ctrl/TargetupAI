import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

// ============================================================
// 타입 정의
// ============================================================

// 변수 카탈로그 엔트리 (field_mappings의 각 항목)
export interface VarCatalogEntry {
  column: string;
  type: 'string' | 'number' | 'date';
  description: string;
  sample: string | number;
  values?: string[];
}

interface MessageVariant {
  variant_id: string;
  variant_name: string;
  concept: string;
  sms_text: string;
  lms_text: string;
  kakao_text?: string;
  score: number;
}

interface AIRecommendResult {
  variants: MessageVariant[];
  recommendation: string;
  recommendation_reason: string;
}

interface TargetInfo {
  total_count: number;
  gender_ratio?: { male: number; female: number };
  age_groups?: { [key: string]: number };
  avg_purchase_count?: number;
  avg_total_spent?: number;
}

// ============================================================
// 기본 스키마 정의 (하드코딩 기본값 - 고객사 스키마 없을 때 폴백)
// ============================================================

export const DEFAULT_FIELD_MAPPINGS: Record<string, VarCatalogEntry> = {
  '이름': { column: 'name', type: 'string', description: '고객 이름', sample: '김민수' },
  '포인트': { column: 'points', type: 'number', description: '보유 적립 포인트', sample: 12500 },
  '등급': { column: 'grade', type: 'string', description: '멤버십 등급', sample: 'VIP', values: ['VIP', 'GOLD', 'SILVER', 'BRONZE'] },
  '매장명': { column: 'store_name', type: 'string', description: '고객 주이용 매장', sample: '강남점' },
  '지역': { column: 'region', type: 'string', description: '거주 지역', sample: '서울' },
  '구매금액': { column: 'total_purchase_amount', type: 'number', description: '총 누적 구매금액', sample: 350000 },
  '구매횟수': { column: 'purchase_count', type: 'number', description: '누적 구매 횟수', sample: 8 },
  '평균주문금액': { column: 'avg_order_value', type: 'number', description: '건당 평균 주문 금액', sample: 43750 },
  'LTV점수': { column: 'ltv_score', type: 'number', description: '고객 생애 가치 점수 (0~100)', sample: 85 },
  '브랜드': { column: 'store_code', type: 'string', description: '소속 브랜드 코드', sample: 'NARS' },
};

export const DEFAULT_AVAILABLE_VARS: string[] = ['이름', '포인트', '등급', '매장명', '브랜드', '지역', '구매금액'];

// ============================================================
// 유틸리티 함수
// ============================================================

// 한국 시간 기준 현재 월 달력 생성
function getKoreanCalendar(): string {
  const now = new Date();
  const koreaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const year = koreaTime.getFullYear();
  const month = koreaTime.getMonth();
  
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  let calendar = `## ${year}년 ${month + 1}월 달력 (요일 참고 필수!)\n`;
  
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dayOfWeek = dayNames[date.getDay()];
    calendar += `${day}일(${dayOfWeek})`;
    if (day < daysInMonth) calendar += day % 7 === 0 ? '\n' : ', ';
  }
  
  // 다음 달도 추가 (이벤트가 다음 달에 걸칠 수 있으므로)
  const nextMonth = month + 1 > 11 ? 0 : month + 1;
  const nextYear = month + 1 > 11 ? year + 1 : year;
  const daysInNextMonth = new Date(nextYear, nextMonth + 1, 0).getDate();
  
  calendar += `\n\n## ${nextYear}년 ${nextMonth + 1}월 달력\n`;
  
  for (let day = 1; day <= daysInNextMonth; day++) {
    const date = new Date(nextYear, nextMonth, day);
    const dayOfWeek = dayNames[date.getDay()];
    calendar += `${day}일(${dayOfWeek})`;
    if (day < daysInNextMonth) calendar += day % 7 === 0 ? '\n' : ', ';
  }
  
  return calendar;
}

// 한국 시간 기준 현재 날짜
function getKoreanToday(): string {
  const now = new Date();
  return now.toLocaleDateString('ko-KR', { 
    timeZone: 'Asia/Seoul', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric', 
    weekday: 'long' 
  });
}

// 한국 시간 기준 현재 시각 (HH:mm)
function getKoreanNowTime(): string {
  const now = new Date();
  return now.toLocaleTimeString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

// 080번호 하이픈 포맷팅 (0801111111 → 080-111-1111)
function formatRejectNumber(num: string): string {
  const clean = num.replace(/-/g, '');
  if (clean.length === 10) {
    return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`;
  }
  return num;
}

/**
 * SMS 광고 오버헤드를 제외한 실제 사용 가능 바이트 계산
 * - 광고 SMS 구조: (광고)본문\n무료거부0807196700
 * - (광고) = 6바이트, \n = 1바이트, 무료거부 = 8바이트, 번호 = 가변
 * - 비광고: 90 - 여유 2 = 88바이트
 * - 광고: 90 - 오버헤드 - 여유 1
 */
function getAvailableSmsBytes(isAd: boolean, rejectNumber?: string): number {
  if (!isAd) return 88; // 비광고: 90 - 여유 2
  const cleanNumber = (rejectNumber || '0807196700').replace(/-/g, '');
  // (광고) 6 + \n 1 + 무료거부 8 + 번호길이 + 여유 1
  const overhead = 6 + 1 + 8 + cleanNumber.length + 1;
  return 90 - overhead;
}

// ============================================================
// 변수 카탈로그 관련 함수 (핵심!)
// ============================================================

/**
 * 메시지 내 개인화 변수 검증
 * - 메시지에서 %...% 패턴을 추출하여 available_vars에 없는 것이 있으면 invalid 반환
 * - 발송 전 반드시 호출하여 잘못된 변수가 고객에게 노출되는 것을 방지
 */
export function validatePersonalizationVars(
  message: string,
  availableVars: string[]
): { valid: boolean; invalidVars: string[] } {
  const found = message.match(/%[^%\s]{1,20}%/g) || [];
  const varNames = found.map(v => v.replace(/%/g, ''));
  const invalidVars = varNames.filter(v => !availableVars.includes(v));
  return { valid: invalidVars.length === 0, invalidVars };
}

/**
 * 변수 카탈로그 → AI 프롬프트용 텍스트 생성
 * AI가 사용 가능한 변수의 이름, 설명, 예시값을 테이블로 전달
 */
function buildVarCatalogPrompt(
  catalog: Record<string, VarCatalogEntry>,
  availableVars: string[]
): string {
  if (!catalog || availableVars.length === 0) {
    return `이 회사는 개인화 변수가 등록되지 않았습니다.\n%...% 형태의 변수를 절대 사용하지 마세요. 일반 문안으로만 작성하세요.`;
  }

  let text = `## 사용 가능한 개인화 변수 (⚠️ 이 목록의 변수만 사용 가능!)\n\n`;
  text += `| 변수 | 설명 | 예시값 |\n|------|------|--------|\n`;
  for (const varName of availableVars) {
    const entry = catalog[varName];
    if (entry) {
      const sample = typeof entry.sample === 'number' ? entry.sample.toLocaleString() : entry.sample;
      text += `| %${varName}% | ${entry.description} | ${sample} |\n`;
    }
  }

  text += `\n⚠️ 위 목록에 없는 변수를 절대 만들지 마세요!\n`;
  text += `금지 예시: %매장번호%, %고객명%, %적립금%, %담당매장%, %회원번호% 등\n`;
  text += `존재하지 않는 변수는 고객에게 "%변수명%" 텍스트가 그대로 발송됩니다.\n`;
  text += `반드시 위 표의 변수명만 정확히 %변수명% 형태로 사용하세요.\n`;
  text += `변수를 사용할지 말지는 문맥에 맞게 자연스럽게 판단하세요.`;

  return text;
}

/**
 * customer_schema에서 field_mappings, available_vars 추출 (폴백 포함)
 */
export function extractVarCatalog(customerSchema: any): {
  fieldMappings: Record<string, VarCatalogEntry>;
  availableVars: string[];
} {
  const schema = customerSchema || {};
  const fieldMappings = schema.field_mappings || DEFAULT_FIELD_MAPPINGS;
  const availableVars = schema.available_vars || DEFAULT_AVAILABLE_VARS;
  return { fieldMappings, availableVars };
}

/**
 * 프롬프트에서 개인화 관련 키워드를 감지하여 사용 가능한 변수 중 관련된 것을 추출
 * - 하드코딩이 아닌 field_mappings 기반 동적 감지
 */
function detectPersonalizationVars(
  objective: string,
  fieldMappings: Record<string, VarCatalogEntry>,
  availableVars: string[]
): string[] {
  const detected: string[] = [];

  // 키워드 → 변수명 매핑 (다양한 고객 표현을 커버)
  const keywordMap: Record<string, string[]> = {
    '이름': ['이름', '고객명', '성함', '개인화'],
    '포인트': ['포인트', '적립금', '마일리지', '리워드'],
    '등급': ['등급', '멤버십', '회원등급', 'VIP', 'GOLD', 'SILVER', '티어'],
    '매장명': ['매장', '지점', '스토어', '주이용매장'],
    '브랜드': ['브랜드', '브랜드별', '브랜드명', '브랜드코드'],
    '지역': ['지역', '거주'],
    '구매금액': ['구매금액', '구매액', '총구매', '누적구매'],
    '구매횟수': ['구매횟수', '구매건수', '주문횟수'],
    '평균주문금액': ['평균주문', '평균구매', '객단가'],
    'LTV점수': ['LTV', '고객가치', '생애가치'],
    // 추가 스키마 (custom_fields 기반 - 업종별)
    '피부타입': ['피부타입', '피부', '건성', '지성', '복합성', '민감성'],
    '주요카테고리': ['카테고리', '선호카테고리', '스킨케어', '클렌징', '바디케어', '색조'],
    '선호라인': ['선호라인', '히알루론', '미백', '탄력', '콜라겐', '진정'],
    '선호채널': ['선호채널', '카카오선호', 'SMS선호'],
    '연령대': ['연령대'],
  };

  for (const varName of availableVars) {
    if (!fieldMappings[varName]) continue;
    const keywords = keywordMap[varName] || [varName];
    for (const keyword of keywords) {
      if (objective.includes(keyword)) {
        if (!detected.includes(varName)) {
          detected.push(varName);
        }
        break;
      }
    }
  }

  // "개인화" 키워드가 있으면 최소 "이름"은 포함
  if (/개인화/.test(objective) && !detected.includes('이름') && availableVars.includes('이름')) {
    detected.unshift('이름');
  }

  return detected;
}

// ============================================================
// 브랜드 시스템 프롬프트
// ============================================================

const BRAND_SYSTEM_PROMPT = `당신은 마케팅 문자 메시지 전문가입니다.

## 채널별 작성 규칙

### SMS
- 짧고 임팩트 있게, 핵심 혜택만
- ⚠️ 바이트 제한은 사용자 메시지에 명시된 값을 반드시 따르세요!
- 광고성 메시지는 시스템이 (광고)표기+수신거부번호를 자동 추가하므로, 순수 본문 바이트가 제한됩니다
- 예시: [브랜드]봄세일 20%할인! 2/4~6 매장방문▶

### LMS (2000바이트 이하, 한글 약 1000자)  
- subject(제목) 필수! 40바이트 이내, 핵심 키워드로 짧고 임팩트 있게
- 제목 예시: "[브랜드명] 봄 세일 안내", "VIP 고객님 특별 혜택"
- 줄바꿈과 특수문자로 가독성 높게
- 구성: 인사 → 혜택상세 → 기간/조건 → CTA
- 예시:
[브랜드명] 봄맞이 특별 이벤트

안녕하세요, 고객님!
따뜻한 봄을 맞아 특별한 혜택을 준비했어요.

★ 혜택: 전품목 20% 할인
★ 기간: 2월 4일(화) ~ 6일(목)

▶ 지금 바로 확인하세요!

### MMS
- LMS와 동일하되 이미지 첨부 고려
- 텍스트는 이미지 보완 역할

### 카카오 (친구톡/브랜드메시지)
- 최대 4,000자 (한글 기준)
- 발송 가능 시간: 08:00~20:50 (⚠️ 이 시간 밖에 발송 불가!)
- 광고 표기: 메시지 상단에 "(광고)" 자동 붙음 (시스템 처리, 본문에 넣지 마세요)
- 수신거부: 하단에 "채널 차단하기" 자동 포함 (본문에 넣지 마세요)
- 이모지 사용 가능 (SMS와 다르게 카카오는 이모지 지원!)
- 버튼: 최대 5개 (웹링크, 앱링크, 봇키워드, 메시지전달, 상담톡전환)
- 구성: 인사 → 혜택/내용 → 기간/조건 → 안내
- 이모지는 적절히 포인트로만 사용 (과도한 사용 금지)

## 🚫 절대 금지 규칙 (최우선!)

### 1. 광고 표기 금지
(광고), 무료거부, 무료수신거부, 080번호를 메시지에 절대 포함하지 마세요!
광고 표기와 수신거부 번호는 시스템이 자동으로 붙입니다.
당신은 순수 메시지 본문만 작성하세요.

### 2. 사용자가 언급하지 않은 혜택/할인/이벤트 날조 금지
- 사용자가 "설날 이벤트"만 말했으면 → 할인율, 적립금, 사은품, 무료배송 등을 지어내지 마세요!
- 사용자가 "20% 할인"을 명시했으면 → 정확히 20%만 언급, 추가 혜택 날조 금지!
- 사용자가 구체적 혜택을 안 말했으면 → "특별한 혜택을 준비했어요", "이벤트를 확인해보세요" 등 포괄적 표현만 사용
- 절대 하면 안 되는 예시: 사용자가 언급 안 했는데 "전상품 30% 할인", "포인트 10% 적립", "샘플 증정", "무료배송" 등 추가

### 3. 날짜 규칙
- "내일", "모레", "다음주" 등 상대적 날짜는 반드시 구체적 날짜로 변환
- 날짜 표기는 반드시 "M/D(요일)" 형식으로! 예: 2/8(일)

## 특수문자 규칙 (⚠️ 필수!)
SMS/LMS/MMS: 이모지(😀🎁🔥💕 등)는 SMS에서 깨지므로 절대 사용 금지!
대신 아래 특수문자만 사용하세요:
★☆●○◎◇◆□■△▲▽▼→←↑↓♠♣♥♡♦※☎▶◀【】「」『』

### ⛔ 구분선 사용 절대 금지!
━━━, ───, ═══, ＿＿＿, ~~~, ***, --- 등 가로줄/구분선 문자를 절대 사용하지 마세요!
줄바꿈(빈 줄)으로 단락을 구분하세요. 구분선은 모바일에서 넘치거나 깨집니다.

카카오: 이모지 사용 가능하나 절제하여 포인트로만 활용 (🎉✨💝 등 1~2개 적절히)

## 출력 형식
반드시 아래 JSON 형식으로만 응답하세요:

{
  "variants": [
    {
      "variant_id": "A",
      "variant_name": "감성형",
      "concept": "따뜻하고 친근한 톤",
      "subject": "LMS/MMS일 때 제목 (SMS는 빈 문자열)",
      "subject": "LMS/MMS일 때 제목 (SMS는 빈 문자열)",
      "message_text": "채널에 맞는 메시지 (광고표기/수신거부 포함 금지!)",
      "byte_count": 바이트수,
      "score": 점수
    },
    {
      "variant_id": "B",
      "variant_name": "혜택강조형",
      "concept": "할인/혜택을 직접적으로 강조",
      "subject": "LMS/MMS일 때 제목 (SMS는 빈 문자열)",
      "message_text": "채널에 맞는 메시지 (광고표기/수신거부 포함 금지!)",
      "byte_count": 바이트수,
      "score": 점수
    },
    {
      "variant_id": "C",
      "variant_name": "MZ감성형",
      "concept": "트렌디하고 캐주얼한 톤",
      "subject": "LMS/MMS일 때 제목 (SMS는 빈 문자열)",
      "message_text": "채널에 맞는 메시지 (광고표기/수신거부 포함 금지!)",
      "byte_count": 바이트수,
      "score": 점수
    }
  ],
  "recommendation": "A",
  "recommendation_reason": "추천 이유"
}`;

// ============================================================
// 메시지 생성 (generateMessages)
// ============================================================

export async function generateMessages(
  prompt: string,
  targetInfo: TargetInfo,
  extraContext?: {
    productName?: string;
    discountRate?: number;
    eventName?: string;
    brandName?: string;
    brandSlogan?: string;
    brandDescription?: string;
    brandTone?: string;
    channel?: string;
    isAd?: boolean;
    rejectNumber?: string;
    usePersonalization?: boolean;
    personalizationVars?: string[];
    // ★ 신규: 변수 카탈로그 (customer_schema에서 전달)
    availableVarsCatalog?: Record<string, VarCatalogEntry>;
    availableVars?: string[];
  }
): Promise<AIRecommendResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return getFallbackVariants(extraContext);
  }

  const brandName = extraContext?.brandName || '브랜드';
  const brandSlogan = extraContext?.brandSlogan || '';
  const brandDescription = extraContext?.brandDescription || '';
  const brandTone = extraContext?.brandTone || '친근함';
  const channel = extraContext?.channel || 'SMS';
  const isAd = extraContext?.isAd !== false;
  const rejectNumber = extraContext?.rejectNumber || '';
  
  // ★ 개인화 설정 - 변수 카탈로그 기반 (하드코딩 varToTag 제거!)
  const usePersonalization = extraContext?.usePersonalization || false;
  const personalizationVars = extraContext?.personalizationVars || [];
  const varCatalog = extraContext?.availableVarsCatalog || DEFAULT_FIELD_MAPPINGS;
  const availableVars = extraContext?.availableVars || DEFAULT_AVAILABLE_VARS;
  
  // 개인화 태그 생성 (카탈로그 기반 동적 생성)
  const personalizationTags = personalizationVars.map(v => `%${v}%`).join(', ');
  
  // ★ SMS 가용 바이트 동적 계산 (광고 오버헤드 반영)
  const smsAvailableBytes = getAvailableSmsBytes(isAd, rejectNumber);
  const byteLimit = channel === 'SMS' ? smsAvailableBytes : channel === 'LMS' ? 2000 : channel === 'MMS' ? 2000 : channel === '카카오' ? 4000 : 1000;
  
  // ★ 변수 카탈로그 프롬프트 생성
  const varCatalogPrompt = buildVarCatalogPrompt(varCatalog, availableVars);

  // ★ SMS 바이트 제한 안내 (광고/비광고 구분)
  const smsByteInstruction = channel === 'SMS'
    ? isAd
      ? `- ⚠️ SMS 광고 메시지: 순수 본문을 반드시 ${smsAvailableBytes}바이트 이내로 작성! (시스템이 (광고)표기+수신거부번호를 자동 추가하므로 전체 90바이트 중 본문은 ${smsAvailableBytes}바이트만 사용 가능)\n- 한글 1자=2바이트, 영문/숫자/특수문자=1바이트 기준으로 정확히 계산하세요\n- ${smsAvailableBytes}바이트 초과 시 발송 불가! 짧고 임팩트 있게 작성`
      : `- SMS 비광고 메시지: 순수 본문을 반드시 ${smsAvailableBytes}바이트 이내로 작성\n- 한글 1자=2바이트, 영문/숫자/특수문자=1바이트 기준으로 정확히 계산하세요`
    : '';

  // ★ 카카오 채널 안내
  const kakaoInstruction = channel === '카카오'
    ? `- 카카오 메시지: 최대 4,000자 (한글 기준)
- 이모지 사용 가능! 포인트로 적절히 활용 (1~2개)
- 줄바꿈과 이모지로 가독성 높게 구성
- ⚠️ (광고) 표기와 수신거부는 시스템이 처리하므로 본문에 넣지 마세요
- 발송 가능 시간: 08:00~20:50 (이 시간 밖 발송 불가)`
    : '';
  
  const userMessage = `## 캠페인 정보
- 요청: ${prompt}
- 채널: ${channel}
- 타겟 고객 수: ${targetInfo.total_count.toLocaleString()}명

⚠️ 중요: (광고), 무료거부, 무료수신거부, 080번호를 메시지에 절대 포함하지 마세요! 시스템이 자동으로 붙입니다.
⚠️ 중요: 사용자가 언급하지 않은 할인율, 적립금, 사은품, 무료배송 등을 절대 지어내지 마세요!

## 오늘 날짜 (한국 시간)
${getKoreanToday()}
※ "내일", "모레" 등은 위 날짜 기준으로 구체적 날짜(예: 2/5(수))로 변환하세요.

## 브랜드 정보 (⚠️ 반드시 아래 브랜드명을 정확히 사용!)
- 브랜드명: ${brandName}
${brandSlogan ? `- 슬로건: ${brandSlogan}` : ''}
${brandDescription ? `- 브랜드 소개: ${brandDescription}` : ''}
- 톤앤매너: ${brandTone}
${extraContext?.productName ? `- 상품: ${extraContext.productName}` : ''}
${extraContext?.discountRate ? `- 할인율: ${extraContext.discountRate}%` : ''}
${extraContext?.eventName ? `- 이벤트: ${extraContext.eventName}` : ''}

${varCatalogPrompt}

## 요청사항
${channel} 채널에 최적화된 3가지 문안(A/B/C)을 생성해주세요.
- 브랜드명은 "[${brandName}]" 형태로 정확히 사용
${brandSlogan ? `- 브랜드 슬로건 "${brandSlogan}"의 느낌을 반영` : ''}
- 톤앤매너: ${brandTone}
- 🚫 (광고), 무료거부, 무료수신거부, 080번호 절대 포함 금지! 순수 본문만 작성!
- 🚫 사용자가 언급하지 않은 혜택(할인율, 적립금, 사은품 등) 날조 금지!
${smsByteInstruction}
${kakaoInstruction}
${channel === 'LMS' ? '- LMS는 줄바꿈, 특수문자로 가독성 좋게 작성 (이모지 금지!)' : ''}

## 개인화 설정 (⚠️ 중요!)
- 개인화 사용: ${usePersonalization ? '예' : '아니오'}
${usePersonalization ? `- 사용할 개인화 변수: ${personalizationTags}
- 메시지에 반드시 위 변수를 자연스럽게 포함하세요!
- ⚠️ 3개 문안(A/B/C) 모두에 위 개인화 변수를 동일하게 반드시 포함하세요!
- 하나의 문안에만 변수를 넣고 나머지에는 빠뜨리는 것은 절대 금지!
- 예시: "%이름%님, 적립금 %포인트%원이 곧 소멸됩니다"
- 변수는 반드시 %변수명% 형태로 작성 (예: %이름%, %포인트%)
- ⚠️ 위 "사용 가능한 개인화 변수" 목록에 있는 것만 사용! 다른 변수 생성 금지!` : '- 개인화 변수 없이 일반 문안으로 작성\n- %...% 형태의 변수를 사용하지 마세요.'}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      temperature: 0.7,
      system: BRAND_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    
    let jsonStr = text;
    if (text.includes('```json')) {
      const start = text.indexOf('```json') + 7;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    } else if (text.includes('```')) {
      const start = text.indexOf('```') + 3;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    }

    const result = JSON.parse(jsonStr) as AIRecommendResult;
    
    // ★ 생성된 메시지에서 잘못된 변수 검증 + 자동 제거 (안전장치)
    if (result.variants) {
      for (const variant of result.variants) {
        let msgField = (variant as any).message_text || '';
        
        // ★ 안전장치: AI가 (광고), 무료거부 등을 포함했으면 자동 제거
        msgField = msgField.replace(/^\(광고\)\s?/g, '');
        msgField = msgField.replace(/\n?무료거부\d{8,11}/g, '');
        msgField = msgField.replace(/\n?무료수신거부\s?\d{3}-?\d{3,4}-?\d{4}/g, '');
        msgField = msgField.trim();
        (variant as any).message_text = msgField;
        
        // 변수 검증
        const validation = validatePersonalizationVars(msgField, availableVars);
        if (!validation.valid) {
          console.warn(`[AI 변수 검증] 잘못된 변수 발견: ${validation.invalidVars.join(', ')} → 제거`);
          let cleaned = msgField;
          for (const invalidVar of validation.invalidVars) {
            cleaned = cleaned.replace(new RegExp(`%${invalidVar}%`, 'g'), '');
          }
          (variant as any).message_text = cleaned;
        }
      }
    }
    
    return result;
  } catch (error) {
    console.error('AI 메시지 생성 오류:', error);
    return getFallbackVariants(extraContext);
  }
}

// ============================================================
// 타겟 추천 (recommendTarget)
// ============================================================

export async function recommendTarget(
  companyId: string,
  objective: string,
  customerStats: any,
  companyInfo?: { business_type?: string; reject_number?: string; brand_name?: string; company_name?: string; customer_schema?: any; has_kakao_profile?: boolean }
): Promise<{
  filters: any;
  reasoning: string;
  estimated_count: number;
  recommended_channel: string;
  channel_reason: string;
  is_ad: boolean;
  recommended_time: string;
  suggested_campaign_name: string;
  use_individual_callback: boolean;
  use_personalization: boolean;
  personalization_vars: string[];
}> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      filters: {},
      reasoning: 'API 키가 설정되지 않았습니다.',
      estimated_count: 0,
      recommended_channel: 'SMS',
      channel_reason: '기본 채널입니다.',
      is_ad: true,
      recommended_time: '',
      suggested_campaign_name: '캠페인',
      use_individual_callback: false,
      use_personalization: false,
      personalization_vars: [],
    };
  }

  // ★ 변수 카탈로그 추출 (customer_schema 기반, 없으면 DEFAULT 폴백)
  const { fieldMappings, availableVars } = extractVarCatalog(companyInfo?.customer_schema);

  // 키워드 감지: 개별회신번호
  const useIndividualCallback = /매장번호|각 매장|주이용매장|개별번호|각자 번호/.test(objective);
  
  // 개인화 키워드 감지
  const usePersonalization = /개인화/.test(objective);
  
  // ★ 개인화 변수 동적 감지 (field_mappings 기반 - 하드코딩 제거!)
  const personalizationVars = detectPersonalizationVars(objective, fieldMappings, availableVars);

  const businessType = companyInfo?.business_type || '기타';
  const brandName = companyInfo?.brand_name || companyInfo?.company_name || '브랜드';
  const hasKakaoProfile = companyInfo?.has_kakao_profile || false;
  
  // 동적 스키마 파싱
  const schema = companyInfo?.customer_schema || {};
  const genders = schema.genders?.join(', ') || '남성, 여성';
  const grades = schema.grades?.join(', ') || 'VIP, GOLD, SILVER, BRONZE';
  const regions = schema.regions?.join(', ') || '서울, 경기, 부산, 대구, 인천, 울산, 대전, 광주, 제주, 전북, 전남, 경북, 경남, 충북, 충남, 강원, 세종';
  const customKeys = schema.custom_field_keys || [];
  
  // ★ 변수 카탈로그 프롬프트 (AI가 문안 추천 시 참조)
  const varCatalogPrompt = buildVarCatalogPrompt(fieldMappings, availableVars);

  const userMessage = `## 회사 정보
- 업종: ${businessType}
- 브랜드명: ${brandName}

## 현재 날짜 (한국 시간 기준)
오늘: ${getKoreanToday()}
현재 시각: ${getKoreanNowTime()}

⚠️ recommended_time은 반드시 현재 시각 이후여야 합니다!
현재 시각이 이미 지난 시간이면 내일 또는 다음 적절한 날짜의 시간을 추천하세요.

${getKoreanCalendar()}

이벤트 기간 작성 시 반드시 위 달력의 요일을 확인하세요!

## 마케팅 목표
${objective}

## 현재 고객 데이터 통계
- 전체 고객: ${customerStats.total}명
- SMS 수신동의: ${customerStats.sms_opt_in_count}명
- 남성: ${customerStats.male_count}명 / 여성: ${customerStats.female_count}명
- 평균 구매횟수: ${Number(customerStats.avg_purchase_count || 0).toFixed(1)}회
- 평균 구매금액: ${Math.round(Number(customerStats.avg_total_spent || 0)).toLocaleString()}원

## 사용 가능한 필터 필드 (⚠️ 반드시 아래 값만 정확히 사용!)
- gender: 성별 → 반드시 다음 값 중 하나만 사용: ${genders}
- age: 나이 (between 연산자로 범위 지정, 예: [20, 29])
- grade: 등급 → 반드시 다음 값 중 하나만 사용: ${grades}
- region: 지역 → 사용 가능한 값: ${regions} (별도 컬럼, custom_fields 아님!)
- points: 포인트 (gte, lte, between)
- total_purchase_amount: 총구매금액
- recent_purchase_date: 최근구매일
- store_code: 브랜드코드 (eq/in 연산자, 예: "NARS", "CPB")
- store_name: 매장명 (eq/in 연산자, 예: "강남점", "홍대점")
${customKeys.map((k: string) => `- custom_fields.${k}: ${k} 필터`).join('\n')}

⚠️ 주의: region은 custom_fields.region이 아닌 그냥 "region"으로 사용!

${varCatalogPrompt}

## 채널 선택 기준
- SMS: 간단한 할인 안내, 짧은 알림 (광고 시 본문 약 64바이트, 비광고 시 약 88바이트)
- LMS: 상세한 이벤트 안내, 여러 혜택 설명 필요시 (2000바이트)
- MMS: 이미지가 중요한 경우 (신상품, 비주얼 강조)
- 카카오: 카카오 채널 친구 대상 발송, 이모지/버튼 활용, 비용 절감 목적, 리치 콘텐츠 필요시 (최대 4,000자)
  ※ 카카오는 발송 가능 시간 08:00~20:50 제한 있음 (recommended_time 추천 시 반드시 이 범위 내로!)
  ※ 카카오 추천 시 recommended_channel: "카카오"로 표기

${hasKakaoProfile ? '⚠️ 이 고객사는 카카오 발신 프로필이 등록되어 있어 카카오 채널 추천이 가능합니다.' : '⚠️ 이 고객사는 카카오 발신 프로필이 미등록이므로 카카오 채널은 추천하지 마세요. SMS/LMS/MMS만 추천하세요.'}

⚠️ 필수 규칙: 개인화 변수(%이름%, %등급%, %매장명% 등)를 사용하는 경우 반드시 LMS 이상을 추천하세요!
개인화 변수는 치환 시 바이트가 늘어나므로 SMS(90바이트)에서는 초과 위험이 매우 높습니다.
개인화가 포함된 캠페인에서 SMS를 추천하는 것은 절대 금지입니다.

## 광고성 판단 기준
- 광고성 (is_ad: true): 할인, 세일, 이벤트, 프로모션, 신상품 홍보, 쿠폰
- 알림성 (is_ad: false): 마일리지 소멸 안내, 예약 확인, 배송 안내, 결제 완료

## 개인화 & 회신번호 판단 (⚠️ 중요!)
- "개인화" 키워드 있으면 → use_personalization: true
- "매장번호", "각 매장", "주이용매장", "개별번호" 있으면 → use_individual_callback: true
- 개인화 사용 시 personalization_vars에는 위 "사용 가능한 개인화 변수" 목록에 있는 변수명만 포함!
- ⚠️ personalization_vars에 위 목록에 없는 변수를 절대 넣지 마세요!

현재 요청 분석:
- 개인화 요청: ${usePersonalization ? '예' : '아니오'}
- 개별회신번호 요청: ${useIndividualCallback ? '예' : '아니오'}
- 감지된 개인화 변수: ${personalizationVars.length > 0 ? personalizationVars.join(', ') : '없음'}

## 출력 형식 (JSON만 응답)
{
  "filters": {
    "필드명": { "operator": "연산자", "value": 값 }
  },
  "reasoning": "이 타겟을 추천하는 이유 (한글 1~2문장)",
  "estimated_percentage": 예상 타겟 비율(%),
  "recommended_channel": "SMS 또는 LMS 또는 MMS 또는 카카오 (⚠️ 카카오 추천 시 시간은 08:00~20:50 범위 내로!)",
  "channel_reason": "이 채널을 추천하는 이유 (한글 1문장)",
  "is_ad": true 또는 false,
  "recommended_time": "YYYY-MM-DD HH:mm (한국시간 기준)",
  "suggested_campaign_name": "타겟+이벤트 요약 (예: 20대여성 봄세일, VIP고객 감사이벤트, 30대남성 스킨케어)",
  "use_individual_callback": true 또는 false,
  "use_personalization": true 또는 false,
  "personalization_vars": ["이름", "포인트", "등급"] 또는 []
}

연산자: eq(같음), gte(이상), lte(이하), between([최소,최대]), in([배열])`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      temperature: 0.3,
      system: '당신은 CRM 마케팅 타겟팅 전문가입니다. 주어진 목표에 최적화된 고객 세그먼트와 최적의 발송 채널을 추천해주세요. recommended_time은 반드시 현재 시각 이후의 미래 시간이어야 합니다. JSON 형식으로만 응답하세요.',
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    
    let jsonStr = text;
    if (text.includes('```json')) {
      const start = text.indexOf('```json') + 7;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    } else if (text.includes('```')) {
      const start = text.indexOf('```') + 3;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    }

    const result = JSON.parse(jsonStr);
    
    // ★ AI가 반환한 personalization_vars 검증 — available_vars에 없는 것 제거
    let aiPersonalizationVars = result.personalization_vars || personalizationVars;
    aiPersonalizationVars = aiPersonalizationVars.filter((v: string) => availableVars.includes(v));
    
    return {
      filters: result.filters,
      reasoning: result.reasoning,
      estimated_count: Math.round((customerStats.total * (result.estimated_percentage || 10)) / 100),
      recommended_channel: result.recommended_channel || 'SMS',
      channel_reason: result.channel_reason || '기본 채널입니다.',
      is_ad: result.is_ad !== false,
      recommended_time: result.recommended_time || '',
      suggested_campaign_name: result.suggested_campaign_name || '캠페인',
      use_individual_callback: result.use_individual_callback || useIndividualCallback,
      use_personalization: result.use_personalization || usePersonalization,
      personalization_vars: aiPersonalizationVars,
    };
  } catch (error) {
    console.error('AI 타겟 추천 오류:', error);
    return {
      filters: {},
      reasoning: '추천 생성 중 오류가 발생했습니다.',
      estimated_count: 0,
      recommended_channel: 'SMS',
      channel_reason: '기본 채널입니다.',
      is_ad: true,
      recommended_time: '',
      suggested_campaign_name: '캠페인',
      use_individual_callback: useIndividualCallback,
      use_personalization: usePersonalization,
      personalization_vars: personalizationVars,
    };
  }
}

// ============================================================
// 폴백 메시지
// ============================================================

function getFallbackVariants(extraContext?: any): AIRecommendResult {
  const brand = extraContext?.brandName || '브랜드';
  const product = extraContext?.productName || '상품';
  const discount = extraContext?.discountRate ? `${extraContext.discountRate}%` : '특별';

  return {
    variants: [
      {
        variant_id: 'A',
        variant_name: '혜택 직접형',
        concept: '할인 혜택 직접 전달',
        sms_text: `[${brand}] ${product} ${discount} 할인! 지금 확인▶`,
        lms_text: `[${brand}] ${product} ${discount} 할인\n\n지금 바로 확인하세요!\n\n▶ 바로가기`,
        kakao_text: `${brand}에서 알려드려요 🎉\n\n${product} ${discount} 할인 이벤트가 진행 중이에요!\n\n지금 바로 확인해보세요 ✨`,
        score: 70,
      },
      {
        variant_id: 'B',
        variant_name: '긴급/한정',
        concept: '마감 임박 긴급함 강조',
        sms_text: `[${brand}] 마감임박! ${product} ${discount} 할인▶`,
        lms_text: `[${brand}] 마감 임박!\n\n${product} ${discount} 할인\n\n서두르세요!\n\n▶ 바로가기`,
        kakao_text: `⏰ 마감 임박!\n\n${brand} ${product} ${discount} 할인이 곧 종료됩니다.\n\n서두르세요!`,
        score: 65,
      },
      {
        variant_id: 'C',
        variant_name: '재방문 유도',
        concept: '휴면 고객 재활성화',
        sms_text: `[${brand}] 오랜만이에요! ${product} ${discount} 할인▶`,
        lms_text: `[${brand}] 오랜만이에요!\n\n다시 만나 반가워요!\n${product} ${discount} 할인\n\n▶ 바로가기`,
        kakao_text: `오랜만이에요! 💝\n\n${brand}에서 다시 만나 반가워요.\n${product} ${discount} 할인으로 준비했어요.\n\n다시 만나러 와주실 거죠?`,
        score: 60,
      },
    ],
    recommendation: 'A',
    recommendation_reason: '기본 추천입니다.',
  };
}

// ============================================================
// 프로모션 브리핑 파싱 (parseBriefing)
// ============================================================

const PARSE_BRIEFING_SYSTEM = `당신은 마케팅 프로모션 분석 전문가입니다.
마케터가 자연어로 브리핑한 프로모션 내용을 구조화된 JSON으로 파싱합니다.

## 파싱 규칙
- 브리핑에서 명시적으로 언급된 정보만 추출
- 언급되지 않은 항목은 빈 문자열("")로 설정
- 절대 정보를 지어내거나 추측하지 마세요
- 할인율, 기간, 조건 등은 브리핑 원문 그대로 반영
- 여러 혜택이 있으면 benefit에 모두 나열

## 출력 형식
반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):

{
  "promotionCard": {
    "name": "프로모션 제목/이름",
    "benefit": "혜택/할인 내용 (여러 개면 + 로 연결)",
    "condition": "적용 조건 (없으면 빈 문자열)",
    "period": "기간 (없으면 빈 문자열)",
    "target": "대상 고객 (없으면 빈 문자열)",
    "couponCode": "쿠폰코드 (없으면 빈 문자열)",
    "extra": "기타 참고 사항 (없으면 빈 문자열)"
  }
}`;

export async function parseBriefing(briefing: string): Promise<{
  promotionCard: {
    name: string;
    benefit: string;
    condition: string;
    period: string;
    target: string;
    couponCode?: string;
    extra?: string;
  };
}> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      promotionCard: {
        name: '프로모션',
        benefit: briefing.substring(0, 50),
        condition: '',
        period: '',
        target: '',
        couponCode: '',
        extra: '',
      }
    };
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      temperature: 0.3,
      system: PARSE_BRIEFING_SYSTEM,
      messages: [{ role: 'user', content: `다음 프로모션 브리핑을 구조화해주세요:\n\n${briefing}` }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    let jsonStr = text;
    if (text.includes('```json')) {
      const start = text.indexOf('```json') + 7;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    } else if (text.includes('```')) {
      const start = text.indexOf('```') + 3;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    }

    const result = JSON.parse(jsonStr);
    return result;
  } catch (error) {
    console.error('브리핑 파싱 오류:', error);
    return {
      promotionCard: {
        name: '프로모션',
        benefit: briefing.substring(0, 50),
        condition: '',
        period: '',
        target: '',
        couponCode: '',
        extra: '',
      }
    };
  }
}

// ============================================================
// 개인화 맞춤 문안 생성 (generateCustomMessages)
// ============================================================

interface CustomMessageOptions {
  briefing: string;
  promotionCard: {
    name: string;
    benefit: string;
    condition: string;
    period: string;
    target: string;
    couponCode?: string;
    extra?: string;
  };
  personalFields: string[];
  url?: string;
  tone: string;
  brandName: string;
  brandTone?: string;
  channel: string;
  isAd: boolean;
  rejectNumber?: string;
}

const FIELD_TO_VAR: Record<string, string> = {
  name: '이름',
  gender: '성별',
  grade: '등급',
  store_name: '매장명',
  region: '지역',
  birth_date: '생일',
  birth_month_day: '생일',
  age: '나이',
  points: '포인트',
  total_purchase_amount: '구매금액',
  purchase_count: '구매횟수',
  recent_purchase_date: '최근구매일',
  recent_purchase_store: '최근구매매장',
  avg_order_value: '평균주문금액',
  wedding_anniversary: '결혼기념일',
};

const TONE_MAP: Record<string, string> = {
  friendly: '친근하고 따뜻한',
  formal: '격식있고 신뢰감 있는',
  humorous: '유머러스하고 재미있는',
  urgent: '긴급하고 행동을 유도하는',
  premium: '고급스럽고 VIP 대우하는',
  casual: '편하고 가벼운',
};

export async function generateCustomMessages(options: CustomMessageOptions): Promise<{
  variants: Array<{
    variant_id: string;
    variant_name: string;
    concept: string;
    message_text: string;
    subject?: string;
    score: number;
  }>;
  recommendation: string;
}> {
  const {
    briefing, promotionCard, personalFields, url, tone,
    brandName, brandTone, channel, isAd, rejectNumber,
  } = options;

  const varNames = personalFields
    .map(f => FIELD_TO_VAR[f] || f)
    .filter(Boolean);
  const varTags = varNames.map(v => `%${v}%`).join(', ');

  const smsAvailableBytes = getAvailableSmsBytes(isAd, rejectNumber);
  const toneDesc = TONE_MAP[tone] || '친근한';

  const cardLines = [
    promotionCard.name && `- 프로모션명: ${promotionCard.name}`,
    promotionCard.benefit && `- 혜택: ${promotionCard.benefit}`,
    promotionCard.condition && `- 조건: ${promotionCard.condition}`,
    promotionCard.period && `- 기간: ${promotionCard.period}`,
    promotionCard.target && `- 대상: ${promotionCard.target}`,
    promotionCard.couponCode && `- 쿠폰코드: ${promotionCard.couponCode}`,
    promotionCard.extra && `- 기타: ${promotionCard.extra}`,
  ].filter(Boolean).join('\n');

  const smsByteInstruction = channel === 'SMS'
    ? isAd
      ? `- ⚠️ SMS 광고: 순수 본문 ${smsAvailableBytes}바이트 이내 필수! (시스템이 (광고)+수신거부 자동 추가)\n- 한글 1자=2바이트, 영문/숫자=1바이트`
      : `- SMS 비광고: 순수 본문 ${smsAvailableBytes}바이트 이내`
    : '';

  const userMessage = `## 프로모션 정보 (마케터 확인 완료)
${cardLines}

## 원본 브리핑
${briefing}

## 오늘 날짜
${getKoreanToday()}

## 브랜드
- 브랜드명: ${brandName}
${brandTone ? `- 톤앤매너: ${brandTone}` : ''}

## 개인화 변수 (⚠️ 필수 포함!)
사용할 변수: ${varTags}
- 3개 문안(A/B/C) 모두에 위 변수를 반드시 자연스럽게 포함!
- 변수 형식: %변수명% (예: %이름%님, %등급% 고객님)
- ⚠️ 위 목록에 없는 변수 생성 절대 금지!

${url ? `## 바로가기 URL\n- URL: ${url}\n- 문안 하단에 "▶ 바로가기 ${url}" 형태로 배치` : ''}

## 톤/분위기
${toneDesc} 톤으로 작성

## 채널: ${channel}
${smsByteInstruction}
${channel === 'LMS' ? '- LMS: subject(제목) 필수, 줄바꿈으로 가독성 높게, 이모지 금지' : ''}

## 요청사항
${channel} 채널에 최적화된 3가지 맞춤 문안(A/B/C)을 생성해주세요.
- 브랜드명: "[${brandName}]" 형태 사용
- 🚫 (광고), 무료거부, 무료수신거부, 080번호 절대 포함 금지! 순수 본문만!
- 🚫 프로모션 카드에 없는 혜택/할인/이벤트 날조 금지!
- 개인화 변수(${varTags})를 활용하여 고객별 맞춤 느낌 극대화
- 각 시안은 서로 다른 컨셉으로 차별화`;

  const systemPrompt = `당신은 개인화 마케팅 문자 메시지 전문가입니다.

## 핵심 임무
프로모션 정보와 개인화 변수를 활용하여, 고객 한 명 한 명에게 맞춤형으로 느껴지는 마케팅 문안을 작성합니다.

## 채널별 규칙

### SMS
- 짧고 임팩트 있게, 핵심 혜택만
- 바이트 제한 엄수 (사용자 메시지에 명시된 값)
- 이모지 절대 금지, 특수문자만 사용: ★☆●○◎◇◆□■△▲▽▼→←↑↓♠♣♥♡♦※☎▶◀【】「」『』

### LMS (2000바이트 이하)
- subject(제목) 필수! 40바이트 이내
- 줄바꿈과 특수문자로 가독성 높게
- 구성: 인사(개인화) → 혜택상세 → 기간/조건 → CTA
- 이모지 절대 금지

## 🚫 절대 금지
1. (광고), 무료거부, 무료수신거부, 080번호 포함 금지
2. 프로모션 카드에 없는 혜택/할인 날조 금지
3. 개인화 변수 목록에 없는 변수 생성 금지
4. 이모지 사용 금지 (SMS/LMS)
5. 구분선(━━━, ───, ═══) 사용 금지

## 출력 형식
반드시 아래 JSON 형식으로만 응답 (다른 텍스트 없이):

{
  "variants": [
    {
      "variant_id": "A",
      "variant_name": "시안 이름",
      "concept": "컨셉 설명 (1줄)",
      "subject": "LMS일 때 제목 (SMS는 빈 문자열)",
      "message_text": "개인화 변수 포함된 완성 문안 (광고표기/수신거부 금지!)",
      "score": 85
    },
    { "variant_id": "B", ... },
    { "variant_id": "C", ... }
  ],
  "recommendation": "A",
  "recommendation_reason": "추천 이유"
}`;

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      variants: [
        {
          variant_id: 'A',
          variant_name: '기본형',
          concept: 'API 키 미설정 - 기본 문안',
          message_text: `[${brandName}] ${promotionCard.name}\n${promotionCard.benefit}`,
          score: 70,
        }
      ],
      recommendation: 'A',
    };
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      temperature: 0.7,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    let jsonStr = text;
    if (text.includes('```json')) {
      const start = text.indexOf('```json') + 7;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    } else if (text.includes('```')) {
      const start = text.indexOf('```') + 3;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    }

    const result = JSON.parse(jsonStr);

    // 안전장치: 광고표기 자동 제거 + 변수 검증
    if (result.variants) {
      for (const variant of result.variants) {
        let msg = variant.message_text || '';
        msg = msg.replace(/^\(광고\)\s?/g, '');
        msg = msg.replace(/\n?무료거부\d{8,11}/g, '');
        msg = msg.replace(/\n?무료수신거부\s?\d{3}-?\d{3,4}-?\d{4}/g, '');
        msg = msg.trim();
        variant.message_text = msg;

        const validation = validatePersonalizationVars(msg, varNames);
        if (!validation.valid) {
          console.warn(`[AI 맞춤한줄 변수 검증] 잘못된 변수: ${validation.invalidVars.join(', ')} → 제거`);
          let cleaned = msg;
          for (const invalidVar of validation.invalidVars) {
            cleaned = cleaned.replace(new RegExp(`%${invalidVar}%`, 'g'), '');
          }
          variant.message_text = cleaned;
        }
      }
    }

    return {
      variants: result.variants || [],
      recommendation: result.recommendation || 'A',
    };
  } catch (error) {
    console.error('맞춤 문안 생성 오류:', error);
    return {
      variants: [
        {
          variant_id: 'A',
          variant_name: '기본형',
          concept: '오류 발생 - 기본 문안',
          message_text: `[${brandName}] ${promotionCard.name}\n${promotionCard.benefit}`,
          score: 70,
        }
      ],
      recommendation: 'A',
    };
  }
}

// ============================================================
// API 상태 확인
// ============================================================

export function checkAPIStatus(): { available: boolean; message: string } {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  return {
    available: hasKey,
    message: hasKey ? 'Claude API 준비 완료' : 'ANTHROPIC_API_KEY가 설정되지 않았습니다.',
  };
}
