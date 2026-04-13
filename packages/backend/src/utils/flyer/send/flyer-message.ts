/**
 * ★ CT-F05 — 전단AI 메시지 치환/광고문구 컨트롤타워
 *
 * 한줄로 utils/messageUtils.ts와 완전 분리.
 * - 변수 치환: %이름%, %전화%, %등급%, %포인트%, %최근방문% 등 flyer_customers 기본 필드만
 * - 광고 본문: (광고) 접두 + 080 수신거부 번호 부착 (is_ad=true 때만)
 *
 * 한줄로의 복잡한 FIELD_MAP / custom_fields 시스템 미지원 (전단AI는 표준 필드만 사용).
 */

export interface FlyerCustomerVars {
  name?: string;
  phone?: string;
  gender?: string;
  birth_date?: string;
  email?: string;
  address?: string;
  pos_grade?: string;
  pos_points?: number;
  last_purchase_at?: string;
  total_purchase_amount?: number;
  purchase_count?: number;
}

const VAR_ALIAS_TO_KEY: Record<string, keyof FlyerCustomerVars> = {
  '이름': 'name',
  '고객명': 'name',
  '성명': 'name',
  '전화': 'phone',
  '전화번호': 'phone',
  '휴대폰': 'phone',
  '성별': 'gender',
  '생일': 'birth_date',
  '생년월일': 'birth_date',
  '이메일': 'email',
  '주소': 'address',
  '등급': 'pos_grade',
  '포인트': 'pos_points',
  '최근방문': 'last_purchase_at',
  '최근구매': 'last_purchase_at',
  '누적구매': 'total_purchase_amount',
  '방문횟수': 'purchase_count',
  '구매횟수': 'purchase_count',
};

function formatVarValue(key: string, value: any): string {
  if (value == null || value === '') return '';
  // 숫자: 천단위 콤마
  if (key === 'pos_points' || key === 'total_purchase_amount' || key === 'purchase_count') {
    const n = Number(String(value).replace(/,/g, ''));
    if (!isNaN(n)) return n.toLocaleString('ko-KR');
  }
  // 성별 enum 역변환
  if (key === 'gender') {
    if (value === 'F' || value === 'f') return '여성';
    if (value === 'M' || value === 'm') return '남성';
  }
  // 날짜 YYYY-MM-DD
  if (key === 'birth_date' || key === 'last_purchase_at') {
    const d = String(value).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const [y, m, dd] = d.split('-');
      return `${y}년 ${parseInt(m)}월 ${parseInt(dd)}일`;
    }
  }
  return String(value);
}

/**
 * 변수 치환. %이름%, %등급% 등을 flyer_customers 실제 값으로 교체.
 * 매칭 실패한 변수는 빈 문자열로 대체 (안전망).
 */
export function replaceFlyerVariables(template: string, customer: FlyerCustomerVars): string {
  if (!template) return '';
  return template.replace(/%([^%\n]+)%/g, (_match, varName) => {
    const trimmed = varName.trim();
    const key = VAR_ALIAS_TO_KEY[trimmed] || (trimmed in customer ? trimmed as keyof FlyerCustomerVars : null);
    if (!key) return '';
    return formatVarValue(key, customer[key]);
  });
}

/**
 * (광고) + 무료거부 부착. buildAdMessage와 동일 패턴.
 * idempotent — 이미 (광고)로 시작하면 중복 추가 안 함.
 */
export function buildFlyerAdMessage(body: string, isAd: boolean, opt080: string | null): string {
  if (!isAd) return body;

  // 기존 (광고)/무료거부 제거 후 재부착 (idempotent)
  let clean = body.replace(/^\(광고\)\s*/, '').trim();
  clean = clean.replace(/\n*무료(수신|거부).*$/s, '').trim();

  const lines = [`(광고) ${clean}`];
  if (opt080) lines.push(`무료수신거부 ${opt080}`);
  return lines.join('\n');
}

/**
 * (광고) 프리픽스/무료거부 라인 제거 — 표시용 (DB에 저장된 원문에 이미 있으면 정규화).
 */
export function stripFlyerAdParts(body: string): string {
  if (!body) return '';
  let clean = body.replace(/^\(광고\)\s*/, '').trim();
  clean = clean.replace(/\n*무료(수신|거부).*$/s, '').trim();
  return clean;
}

/**
 * 발송 직전 최종 준비: 변수 치환 → (광고) 부착.
 * 모든 발송 경로에서 이 함수만 호출하면 일관된 결과.
 */
export function prepareFlyerSendMessage(
  template: string,
  customer: FlyerCustomerVars,
  isAd: boolean,
  opt080: string | null
): string {
  const replaced = replaceFlyerVariables(template, customer);
  return buildFlyerAdMessage(replaced, isAd, opt080);
}
