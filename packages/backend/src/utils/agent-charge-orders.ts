/**
 * ★ 2026-07-27 §5-4 — 에이전트 충전 요청(고객사) 파싱·상태 CT
 *
 * §5-3(슈퍼관리자 충전 실행)이 게이트웨이 원장 `RSRM_FillAmtHist`에 직접 INSERT하는 "실행" 축이라면,
 * 여기는 그 앞단의 "요청" 축이다. **요청은 어떤 잔액도 건드리지 않는다** — 증액 경로는 §5-3 하나뿐이고,
 * 요청 행은 직원이 그 화면을 1클릭으로 채우게 해주는 접수 원장일 뿐이다.
 *
 * 웹 무통장입금(`deposit_requests`)과 한 테이블에 섞지 않는 이유:
 *   deposit_requests 승인은 한줄로 `companies.balance`(웹 지갑)를 올린다. 에이전트 요청이 그 테이블에
 *   섞이면 기존 무통장입금 승인 화면이 게이트웨이 지갑 요청을 웹 잔액으로 잘못 증액할 수 있다.
 *   축이 다르면 테이블도 다르다(6원칙 ④ — 라우팅 축 변경 = 전 경로 영향).
 *
 * 음수(상계)를 여기서 막는 이유: 상계는 내부 회계 조정이라 고객사가 요청할 일이 없고,
 * 요청 창구에 음수를 열어두면 고객사 입력만으로 차감 지시가 접수된다.
 */

/** 요청 최소 금액 — 웹 무통장입금(1,000원)과 같은 하한 */
export const AGENT_CHARGE_ORDER_MIN = 1000;
/** 요청 1건 상한 — §5-3 배치 절대합(1억)과 같은 눈금 */
export const AGENT_CHARGE_ORDER_MAX = 100_000_000;
export const AGENT_CHARGE_ORDER_MEMO_MAX = 200;
export const AGENT_CHARGE_ORDER_DEPOSITOR_MAX = 50;

export type AgentChargeOrderStatus = 'pending' | 'processing' | 'fulfilled' | 'rejected';

export interface AgentChargeOrderInput {
  agentSendId: string;
  amount: number;
  depositorName: string;
  /** 입금(예정)일 — YYYY-MM-DD. 미입력 허용 */
  expectedAt: string | null;
  memo: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 고객사 충전 요청 1건 파싱.
 * 금액은 **양수 정수(원 단위)만** 받는다 — 소수 단가와 달리 입금액은 원 단위로 떨어진다.
 */
export function parseAgentChargeOrder(body: any): AgentChargeOrderInput | { error: string } {
  const agentSendId = String(body?.agentSendId ?? '').trim();
  if (!agentSendId) return { error: '발송ID를 선택하세요.' };
  if (agentSendId.length > 40) return { error: '발송ID 형식이 올바르지 않습니다.' };

  const rawAmount = body?.amount;
  // 문자열로 와도 받되, 숫자로 해석되지 않으면 거부 (빈 문자열·'-'·'1e5' 차단)
  const amount =
    typeof rawAmount === 'number'
      ? rawAmount
      : /^\d+$/.test(String(rawAmount ?? '').trim())
        ? Number(String(rawAmount).trim())
        : NaN;
  if (!Number.isFinite(amount)) return { error: '금액을 숫자로 입력하세요.' };
  if (!Number.isInteger(amount)) return { error: '금액은 원 단위(정수)로 입력하세요.' };
  if (amount <= 0) return { error: '충전 요청 금액은 0보다 커야 합니다. (차감·상계는 요청 대상이 아닙니다)' };
  if (amount < AGENT_CHARGE_ORDER_MIN) {
    return { error: `${AGENT_CHARGE_ORDER_MIN.toLocaleString()}원 이상 입력하세요.` };
  }
  if (amount > AGENT_CHARGE_ORDER_MAX) {
    return { error: `1건 상한은 ${AGENT_CHARGE_ORDER_MAX.toLocaleString()}원입니다. 나눠서 요청하세요.` };
  }

  const depositorName = String(body?.depositorName ?? '').trim();
  if (!depositorName) return { error: '입금자명을 입력하세요.' };
  if (depositorName.length > AGENT_CHARGE_ORDER_DEPOSITOR_MAX) {
    return { error: `입금자명은 ${AGENT_CHARGE_ORDER_DEPOSITOR_MAX}자 이내로 입력하세요.` };
  }

  const rawExpected = String(body?.expectedAt ?? '').trim();
  let expectedAt: string | null = null;
  if (rawExpected) {
    if (!DATE_RE.test(rawExpected)) return { error: '입금(예정)일은 YYYY-MM-DD 형식으로 입력하세요.' };
    const d = new Date(`${rawExpected}T00:00:00+09:00`);
    if (Number.isNaN(d.getTime())) return { error: '입금(예정)일이 올바르지 않습니다.' };
    expectedAt = rawExpected;
  }

  const rawMemo = String(body?.memo ?? '').trim();
  if (rawMemo.length > AGENT_CHARGE_ORDER_MEMO_MAX) {
    return { error: `메모는 ${AGENT_CHARGE_ORDER_MEMO_MAX}자 이내로 입력하세요.` };
  }

  return {
    agentSendId,
    amount,
    depositorName,
    expectedAt,
    memo: rawMemo || null,
  };
}

/**
 * 반려 사유 파싱 — 사유 없는 반려 금지(고객사가 왜 거절됐는지 알 수 없게 된다).
 */
export function parseRejectReason(body: any): { reason: string } | { error: string } {
  const reason = String(body?.reason ?? '').trim();
  if (!reason) return { error: '반려 사유를 입력하세요. (고객사에게 그대로 표시됩니다)' };
  if (reason.length > AGENT_CHARGE_ORDER_MEMO_MAX) {
    return { error: `반려 사유는 ${AGENT_CHARGE_ORDER_MEMO_MAX}자 이내로 입력하세요.` };
  }
  return { reason };
}

/**
 * 상태 전이 허용 판정 — 되돌리기(fulfilled→pending 등)를 막는다.
 * pending  → processing(실행 접수) / rejected(반려)
 * processing → fulfilled(게이트웨이 반영 확인) / pending(실행이 미반영으로 확정돼 되돌림)
 * fulfilled·rejected = 종결(전이 없음)
 */
export function canTransition(from: AgentChargeOrderStatus, to: AgentChargeOrderStatus): boolean {
  if (from === 'pending') return to === 'processing' || to === 'rejected';
  if (from === 'processing') return to === 'fulfilled' || to === 'pending';
  return false;
}

/** 화면 표시용 라벨 — 서버·프론트 한 곳에서만 정의(문구가 갈리면 같은 상태가 두 이름으로 보인다) */
export const AGENT_CHARGE_ORDER_LABEL: Record<AgentChargeOrderStatus, string> = {
  pending: '접수 대기',
  processing: '충전 처리 중',
  fulfilled: '충전 완료',
  rejected: '반려',
};
