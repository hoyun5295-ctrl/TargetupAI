/**
 * 몰별 「준비 됨」 표 → 고객 문장(★ 2026-10-28 자사몰 대비 K13)
 *
 * 등급 판정은 서버(`backend/src/utils/provider-readiness.ts` · GET /api/cdp/providers)가 하고 화면은 이 표로 문장만 고른다.
 * 단계 목록 = 서버 READINESS_STAGES 와 같은 닫힌 목록(계약 시험이 대조한다).
 * test · live = 「됩니다」 문장 · code = 「준비 중」 문장 · none = 말하지 않음 · 표가 없으면(조회 실패) 문장 0.
 */
export type ReadinessStage = 'history' | 'realtime' | 'paid_signal' | 'consent' | 'withdrawal' | 'behavior' | 'first_purchase';
export type ReadinessGrade = 'live' | 'test' | 'code' | 'none';
export type ProviderReadiness = Record<ReadinessStage, { grade: ReadinessGrade; evidence: string }>;

export const STAGE_SENTENCE: Record<ReadinessStage, { ready: string; preparing: string }> = {
  history: { ready: '연결하면 지난 주문과 회원을 가져와요.', preparing: '지난 주문 가져오기는 준비 중이에요.' },
  realtime: { ready: '새 주문과 회원 변경이 들어와요.', preparing: '새 주문 받기는 준비 중이에요.' },
  paid_signal: { ready: '결제가 확인된 주문만 구매로 셉니다.', preparing: '결제 확정 구분은 준비 중이에요.' },
  consent: { ready: '몰의 광고 수신 동의를 함께 받아요.', preparing: '수신 동의 받기는 준비 중이에요.' },
  withdrawal: { ready: '몰에서 탈퇴한 회원은 광고 수신이 꺼져요.', preparing: '탈퇴 반영은 준비 중이에요.' },
  behavior: { ready: '방문과 클릭 같은 행동도 모을 수 있어요.', preparing: '행동 수집은 준비 중이에요.' },
  first_purchase: { ready: '첫 구매 고객을 가려낼 수 있어요.', preparing: '첫 구매 판정은 준비 중이에요.' },
};

const ORDER: ReadinessStage[] = ['realtime', 'history', 'paid_signal', 'consent', 'withdrawal', 'behavior', 'first_purchase'];

/** 화면에 그릴 줄(됩니다 먼저 · 준비 중 뒤) — 표가 없으면 빈 배열 */
export function readinessLines(r: ProviderReadiness | null | undefined): { ready: string[]; preparing: string[] } {
  const out = { ready: [] as string[], preparing: [] as string[] };
  if (!r) return out;
  for (const st of ORDER) {
    const g = r[st]?.grade;
    if (g === 'live' || g === 'test') out.ready.push(STAGE_SENTENCE[st].ready);
    else if (g === 'code') out.preparing.push(STAGE_SENTENCE[st].preparing);
  }
  return out;
}
