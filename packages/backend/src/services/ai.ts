import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

// 브랜드 시스템 프롬프트
const BRAND_SYSTEM_PROMPT = `당신은 마케팅 문자 메시지 전문가입니다.

## 채널별 작성 규칙

### SMS (90바이트 이하, 한글 약 45자)
- 광고성일 경우: (광고) + 메시지 + 무료거부번호 필수
- 실제 사용 가능한 글자 수: 약 25~30자 (필수요소 제외)
- 짧고 임팩트 있게, 핵심 혜택만
- 예시: (광고)[브랜드]봄세일20%할인!2/4~6 무료거부080-1234-5678

### LMS (2000바이트 이하, 한글 약 1000자)  
- 광고성일 경우: 맨앞 (광고) + 맨뒤 무료수신거부번호 필수
- 줄바꿈과 이모지로 가독성 높게
- 구성: 인사 → 혜택상세 → 기간/조건 → CTA → 무료거부
- 예시:
(광고)[브랜드명] 봄맞이 특별 이벤트 🌸

안녕하세요, 고객님!
따뜻한 봄을 맞아 특별한 혜택을 준비했어요.

🎁 혜택: 전품목 20% 할인
📅 기간: 2월 4일(화) ~ 6일(목)
📍 대상: 기초화장품 전 라인

▶ 지금 바로 확인하세요!

무료수신거부 080-1234-5678

### MMS
- LMS와 동일하되 이미지 첨부 고려
- 텍스트는 이미지 보완 역할

### 카카오 알림톡
- 템플릿 형식 준수
- 버튼 텍스트 포함
- 광고성 표기 규칙 다름

## 출력 형식
반드시 아래 JSON 형식으로만 응답하세요:

{
  "variants": [
    {
      "variant_id": "A",
      "variant_name": "감성형",
      "concept": "따뜻하고 친근한 톤",
      "message_text": "채널에 맞는 메시지",
      "byte_count": 바이트수,
      "score": 점수
    },
    {
      "variant_id": "B",
      "variant_name": "혜택강조형",
      "concept": "할인/혜택을 직접적으로 강조",
      "message_text": "채널에 맞는 메시지",
      "byte_count": 바이트수,
      "score": 점수
    },
    {
      "variant_id": "C",
      "variant_name": "MZ감성형",
      "concept": "트렌디하고 캐주얼한 톤",
      "message_text": "채널에 맞는 메시지",
      "byte_count": 바이트수,
      "score": 점수
    }
  ],
  "recommendation": "A",
  "recommendation_reason": "추천 이유"
}`;

interface MessageVariant {
  variant_id: string;
  variant_name: string;
  concept: string;
  sms_text: string;
  lms_text: string;
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

// 메시지 생성
export async function generateMessages(
  prompt: string,
  targetInfo: TargetInfo,
  extraContext?: {
    productName?: string;
    discountRate?: number;
    eventName?: string;
    brandName?: string;
    channel?: string;
    isAd?: boolean;
    rejectNumber?: string;
  }
): Promise<AIRecommendResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return getFallbackVariants(extraContext);
  }

  const brandName = extraContext?.brandName || '브랜드';
  const channel = extraContext?.channel || 'SMS';
  const isAd = extraContext?.isAd !== false;
  const rejectNumber = extraContext?.rejectNumber || '080-XXX-XXXX';
  
  const byteLimit = channel === 'SMS' ? 90 : channel === 'LMS' ? 2000 : channel === 'MMS' ? 2000 : 1000;
  
  const userMessage = `## 캠페인 정보
- 요청: ${prompt}
- 채널: ${channel} (${byteLimit}바이트 제한)
- 광고성 메시지: ${isAd ? '예 - (광고)와 무료거부번호 필수 포함' : '아니오'}
${isAd ? `- 무료거부번호: ${rejectNumber}` : ''}
- 타겟 고객 수: ${targetInfo.total_count.toLocaleString()}명

## 브랜드 정보
- 브랜드명: ${brandName}
${extraContext?.productName ? `- 상품: ${extraContext.productName}` : ''}
${extraContext?.discountRate ? `- 할인율: ${extraContext.discountRate}%` : ''}
${extraContext?.eventName ? `- 이벤트: ${extraContext.eventName}` : ''}

## 요청사항
${channel} 채널에 최적화된 3가지 문안(A/B/C)을 생성해주세요.
${channel === 'SMS' ? 'SMS는 90바이트 제한! (광고)와 무료거부번호 포함하여 반드시 90바이트 이내로!' : ''}
${channel === 'LMS' ? 'LMS는 줄바꿈, 이모지, 상세설명을 활용하여 가독성 좋게 작성해주세요.' : ''}`;

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
    return result;
  } catch (error) {
    console.error('AI 메시지 생성 오류:', error);
    return getFallbackVariants(extraContext);
  }
}

// 타겟 추천
export async function recommendTarget(
  companyId: string,
  objective: string,
  customerStats: any,
  companyInfo?: { business_type?: string; reject_number?: string; brand_name?: string; company_name?: string }
): Promise<{
  filters: any;
  reasoning: string;
  estimated_count: number;
  recommended_channel: string;
  channel_reason: string;
  is_ad: boolean;
  recommended_time: string;
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
    };
  }

  const businessType = companyInfo?.business_type || '기타';
  const brandName = companyInfo?.brand_name || companyInfo?.company_name || '브랜드';

  const userMessage = `## 회사 정보
- 업종: ${businessType}
- 브랜드명: ${brandName}

## 마케팅 목표
${objective}

## 현재 고객 데이터 통계
- 전체 고객: ${customerStats.total}명
- SMS 수신동의: ${customerStats.sms_opt_in_count}명
- 남성: ${customerStats.male_count}명 / 여성: ${customerStats.female_count}명
- 평균 구매횟수: ${Number(customerStats.avg_purchase_count || 0).toFixed(1)}회
- 평균 구매금액: ${Math.round(Number(customerStats.avg_total_spent || 0)).toLocaleString()}원

## 사용 가능한 필터 필드
- gender: 성별 (M/F)
- age: 나이 (between 연산자로 범위 지정)
- grade: 등급
- points: 포인트 (gte, lte, between)
- total_purchase_amount: 총구매금액
- recent_purchase_date: 최근구매일
- custom_fields.purchase_count: 구매횟수
- custom_fields.total_spent: 총지출
- custom_fields.preferred_category: 선호카테고리 (의류, 식품, 전자제품, 화장품, 생활용품)
- custom_fields.visit_count: 방문횟수
- custom_fields.last_purchase_date: 마지막구매일

## 채널 선택 기준
- SMS: 간단한 할인 안내, 짧은 알림 (90바이트 제한)
- LMS: 상세한 이벤트 안내, 여러 혜택 설명 필요시 (2000바이트)
- MMS: 이미지가 중요한 경우 (신상품, 비주얼 강조)
- 카카오: 예약확인, 배송안내 등 정보성 알림

## 광고성 판단 기준
- 광고성 (is_ad: true): 할인, 세일, 이벤트, 프로모션, 신상품 홍보, 쿠폰
- 알림성 (is_ad: false): 마일리지 소멸 안내, 예약 확인, 배송 안내, 결제 완료

## 출력 형식 (JSON만 응답)
{
  "filters": {
    "필드명": { "operator": "연산자", "value": 값 }
  },
  "reasoning": "이 타겟을 추천하는 이유 (한글 1~2문장)",
  "estimated_percentage": 예상 타겟 비율(%),
  "recommended_channel": "SMS 또는 LMS 또는 MMS 또는 카카오",
  "channel_reason": "이 채널을 추천하는 이유 (한글 1문장)",
  ""is_ad": true 또는 false,
"recommended_time": "YYYY-MM-DD HH:mm"
}

연산자: eq(같음), gte(이상), lte(이하), between([최소,최대]), in([배열])`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      temperature: 0.3,
      system: '당신은 CRM 마케팅 타겟팅 전문가입니다. 주어진 목표에 최적화된 고객 세그먼트와 최적의 발송 채널을 추천해주세요. JSON 형식으로만 응답하세요.',
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
    return {
      filters: result.filters,
      reasoning: result.reasoning,
      estimated_count: Math.round((customerStats.total * (result.estimated_percentage || 10)) / 100),
      recommended_channel: result.recommended_channel || 'SMS',
      channel_reason: result.channel_reason || '기본 채널입니다.',
      is_ad: result.is_ad !== false,
      recommended_time: result.recommended_time || '',
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
    };
  }
}

// 폴백 메시지
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
        sms_text: `(광고)[${brand}] ${product} ${discount} 할인! 지금 확인▶ 무료수신거부 080-XXX-XXXX`,
        lms_text: `(광고)\n[${brand}] ${product} ${discount} 할인\n\n지금 바로 확인하세요!\n\n▶ 바로가기\n\n무료 수신거부: 080-XXX-XXXX`,
        score: 70,
      },
      {
        variant_id: 'B',
        variant_name: '긴급/한정',
        concept: '마감 임박 긴급함 강조',
        sms_text: `(광고)[${brand}] 마감임박! ${product} ${discount} 할인▶ 무료수신거부 080-XXX-XXXX`,
        lms_text: `(광고)\n[${brand}] ⏰ 마감 임박!\n\n${product} ${discount} 할인\n\n서두르세요!\n\n▶ 바로가기\n\n무료 수신거부: 080-XXX-XXXX`,
        score: 65,
      },
      {
        variant_id: 'C',
        variant_name: '재방문 유도',
        concept: '휴면 고객 재활성화',
        sms_text: `(광고)[${brand}] 오랜만이에요💕 ${product} ${discount} 할인▶ 무료수신거부 080-XXX-XXXX`,
        lms_text: `(광고)\n[${brand}] 오랜만이에요 💕\n\n다시 만나 반가워요!\n${product} ${discount} 할인\n\n▶ 바로가기\n\n무료 수신거부: 080-XXX-XXXX`,
        score: 60,
      },
    ],
    recommendation: 'A',
    recommendation_reason: '기본 추천입니다.',
  };
}

// API 상태 확인
export function checkAPIStatus(): { available: boolean; message: string } {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  return {
    available: hasKey,
    message: hasKey ? 'Claude API 준비 완료' : 'ANTHROPIC_API_KEY가 설정되지 않았습니다.',
  };
}