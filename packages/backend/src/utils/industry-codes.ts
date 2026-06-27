/**
 * industry-codes.ts — 표준 업종 코드 SSOT (문안 두뇌 업종 폴링 + 슈퍼관리자 업종 칸 공통 기준)
 *
 * copy-context.ts의 시즌 이벤트 industries 문자열과 동일 코드를 쓴다(fashion/beauty/food/edu 등).
 * companies.industry_code · ai_training_logs.industry_code 둘 다 이 코드 체계로 채운다.
 */

export const INDUSTRY_CODES = [
  'fashion', 'beauty', 'food', 'health', 'home', 'digital', 'baby',
  'pet', 'edu', 'travel', 'sports', 'culture', 'finance', 'service', 'etc',
] as const;

export type IndustryCode = (typeof INDUSTRY_CODES)[number];

export const INDUSTRY_LABELS: Record<IndustryCode, string> = {
  fashion: '패션/의류/잡화',
  beauty: '뷰티/화장품',
  food: '식품/F&B',
  health: '건강/제약/건기식',
  home: '리빙/생활',
  digital: '디지털/가전/IT',
  baby: '유아/출산',
  pet: '반려동물',
  edu: '교육',
  travel: '여행/숙박/리조트',
  sports: '스포츠/레저',
  culture: '문화/취미',
  finance: '금융/결제',
  service: '서비스/종합',
  etc: '기타',
};

export function isIndustryCode(value: string | null | undefined): value is IndustryCode {
  return !!value && (INDUSTRY_CODES as readonly string[]).includes(value);
}

export function industryLabel(value: string | null | undefined): string {
  return isIndustryCode(value) ? INDUSTRY_LABELS[value] : '기타';
}
