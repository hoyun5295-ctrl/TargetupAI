/**
 * journey-labels.ts — 여정 화면이 같이 쓰는 사람 말 라벨 · 시간 표기 · 흐름 색 (★ 2026-09-29 여정 V2 0차 ⑤ · ⑦)
 *
 * 왜 있나
 *   같은 칸을 세 화면(흐름 그림 · 목록 칸별 흐름 · 통계)이 제각각 그렸다.
 *   칸 종류는 영문 그대로(message · wait) 나갔고, 시간은 "168h 후" · "7일" · "D+7" 세 가지였고,
 *   흐름 색 기준은 70/40 과 50/20 두 벌이었고, 통계는 칸 번호를 하나씩 밀려 적었다.
 *   화면이 같은 사실을 다른 말로 하면 담당자는 어느 쪽도 믿지 못한다 — 표기는 여기 한 곳에서 꺼낸다.
 */

/** 칸 종류 → 사람 말. 모르는 값은 "알 수 없는 칸"(영문 식별자를 화면에 내지 않는다). */
export const STEP_TYPE_LABEL: Record<string, string> = {
  message: '문자',
  wait: '대기',
  condition: '조건',
  // ★ 2026-09-30 V2 4차
  end: '끝',
};

export function stepTypeLabel(stepType: string | null | undefined): string {
  return STEP_TYPE_LABEL[String(stepType || '')] || '알 수 없는 칸';
}

/** 앞 칸 기준 대기 시간(시간 단위) → "바로" · "3시간 뒤" · "7일 뒤" · "1일 6시간 뒤". */
export function formatDelayAfter(hours: number | null | undefined): string {
  const h = Math.max(0, Math.floor(Number(hours) || 0));
  if (h === 0) return '바로';
  if (h < 24) return `${h}시간 뒤`;
  if (h % 24 === 0) return `${h / 24}일 뒤`;
  return `${Math.floor(h / 24)}일 ${h % 24}시간 뒤`;
}

/** 칸 번호(1부터) → "3번째 칸". 서버 step_order 는 1부터 시작한다(여기서 더하지 않는다). */
export function stepOrdinalLabel(stepOrder: number): string {
  return `${stepOrder}번째 칸`;
}

/**
 * 흐름(첫 칸 대비 이 칸까지 온 비율) 색 — 기준 한 벌. 50% 이상 = 좋음 · 20% 이상 = 보통 · 그 아래 = 낮음.
 * (옛 흐름 그림 70/40 · 목록 50/20 두 벌을 목록 기준으로 합쳤다 — 같은 칸이 화면마다 다른 색이던 자리)
 */
export function funnelBarClass(pct: number): string {
  if (pct >= 50) return 'bg-emerald-400';
  if (pct >= 20) return 'bg-amber-400';
  return 'bg-rose-400';
}

/** 여정 문자 칸 채널 → 사람 말(★ 2026-09-29 V2 1차 생애 지도). 모르는 값은 "문자". */
export const STEP_CHANNEL_LABEL: Record<string, string> = {
  sms: '단문 문자',
  lms: '장문 문자',
  mms: '사진 문자',
  kakao: '알림톡',
};

export function stepChannelLabel(channel: string | null | undefined): string {
  return STEP_CHANNEL_LABEL[String(channel || '')] || '문자';
}
