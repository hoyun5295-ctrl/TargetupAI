/**
 * 등급 정규화
 * 다양한 표기 → 표준 등급명
 *
 * 입력 예시:
 *   vip, VIP고객, V.I.P → VIP
 *   골드, GOLD, gold    → GOLD
 *   실버, SILVER        → SILVER
 *   브론즈, BRONZE      → BRONZE
 *   일반, NORMAL        → NORMAL
 */

const GRADE_MAP: Record<string, string> = {
  // VIP
  'vip': 'VIP', 'vip고객': 'VIP', 'v.i.p': 'VIP', 'v.i.p.': 'VIP',
  'vvip': 'VVIP', 'vvip고객': 'VVIP',
  // GOLD
  'gold': 'GOLD', '골드': 'GOLD', '골드고객': 'GOLD', 'gold고객': 'GOLD',
  // SILVER
  'silver': 'SILVER', '실버': 'SILVER', '실버고객': 'SILVER',
  // BRONZE
  'bronze': 'BRONZE', '브론즈': 'BRONZE', '동': 'BRONZE',
  // PLATINUM
  'platinum': 'PLATINUM', '플래티넘': 'PLATINUM', '플래티나': 'PLATINUM',
  // DIAMOND
  'diamond': 'DIAMOND', '다이아몬드': 'DIAMOND', '다이아': 'DIAMOND',
  // NORMAL
  'normal': 'NORMAL', '일반': 'NORMAL', '일반고객': 'NORMAL',
  '일반회원': 'NORMAL', 'general': 'NORMAL', 'basic': 'NORMAL',
  // NEW
  'new': 'NEW', '신규': 'NEW', '신규고객': 'NEW', '신규회원': 'NEW',
};

export function normalizeGrade(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;

  const value = String(raw).trim();
  const lower = value.toLowerCase().replace(/\s+/g, '');

  if (GRADE_MAP[lower]) {
    return GRADE_MAP[lower];
  }

  // 매칭 실패 시 대문자로 변환하여 반환
  return value.toUpperCase();
}
