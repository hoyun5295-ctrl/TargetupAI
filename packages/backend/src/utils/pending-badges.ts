/**
 * pending-badges.ts — 슈퍼관리자 요금/정산 대기 뱃지 카운트 (★ 2026-08-11 · 서수란 접수)
 *
 * 접수: "요금/정산 > 충전관리도 새로고침을 하지 않으면 요청에 대한 내용이 확인되지 않는다.
 *        새로고침이 없어도 고객이 신청을 하면 탭에 알림표시가 바로되면 좋겠다."
 *
 * 원인 = 0808(임은지 접수)에 발신번호 뱃지만 60초 주기 갱신을 얻었고, 요금/정산 뱃지 3종은
 * 초기 1회 로드가 전부라 그 뒤로 값이 굳었다. 새로고침하면 뜨는 이유도 그것이다.
 *
 * 이 파일이 소유하는 것 = **뱃지 숫자를 세는 방법 하나**. 화면은 이 값만 믿는다.
 *
 * ⛔ **실패를 0으로 바꾸지 않는다.** 0은 "볼 일이 없다"는 뜻이라, 조회가 깨졌을 때 0을 내리면
 *    뱃지가 조용히 사라지고 대기 중인 고객 신청이 화면에서 없어진다. 못 센 축은 `null`로 내리고
 *    화면이 직전 값을 유지한다(§11 "멈춘 데이터를 화면이 숨겼다"와 같은 계열).
 * ⛔ **축별로 실패를 격리한다.** 한 테이블이 없어도(마이그레이션 전) 나머지 뱃지는 그대로 돈다.
 */
import { query } from '../config/database';
import { countRechargeRequests } from './ai-credit-recharge';

export interface PendingBadgeCounts {
  /** 플랜 신청 대기 — `plan_requests.status='pending'` */
  planRequests: number | null;
  /** 웹 무통장입금 신청 대기 — `deposit_requests.status='pending'` */
  deposits: number | null;
  /** 에이전트(발송ID) 충전 요청 대기 — `agent_charge_orders.status='pending'` */
  agentChargeOrders: number | null;
  /** AI 크레딧 충전 요청 대기 — `ai_credit_requests.status='pending'` */
  credits: number | null;
}

/** 한 축을 세고, 실패하면 null. 로그는 남긴다 — 조용히 사라지는 뱃지를 만들지 않는다. */
async function countOne(label: string, run: () => Promise<number>): Promise<number | null> {
  try {
    return await run();
  } catch (err: any) {
    console.warn(`[pending-badges] ${label} 카운트 실패(직전 값 유지):`, err?.message || err);
    return null;
  }
}

/** 단일 상태 컬럼 pending 건수 — 목록 쿼리와 같은 WHERE를 쓴다(뱃지와 목록이 갈리지 않게). */
async function countPending(table: 'plan_requests' | 'deposit_requests' | 'agent_charge_orders'): Promise<number> {
  const r = await query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE status = 'pending'`);
  return Number(r.rows[0]?.n) || 0;
}

/**
 * 요금/정산 뱃지 4축을 한 번에 센다 — 60초 주기로 도는 경량 조회.
 *
 * 목록을 함께 가져오지 않는다. 충전 관리 목록 로더(`/charge-management`)는 거래 이력 페이지까지
 * 같이 끌어오므로, 뱃지 하나 때문에 그 무거운 쿼리를 주기로 돌리면 안 된다.
 */
export async function getPendingBadgeCounts(): Promise<PendingBadgeCounts> {
  const [planRequests, deposits, agentChargeOrders, credits] = await Promise.all([
    countOne('plan_requests', () => countPending('plan_requests')),
    countOne('deposit_requests', () => countPending('deposit_requests')),
    countOne('agent_charge_orders', () => countPending('agent_charge_orders')),
    countOne('ai_credit_requests', () => countRechargeRequests('pending')),
  ]);
  return { planRequests, deposits, agentChargeOrders, credits };
}
