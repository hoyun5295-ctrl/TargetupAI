/**
 * billing-ledger.ts — 청구 단가·선불여부 스냅샷 컨트롤타워 (★ 2026-07-26 신설)
 *
 * 신설 사유: 한 번의 발행이 **같은 원장을 서로 다른 시점에 세 번 읽고 있었다.**
 *   ① 회사 단가(`companies.cost_per_*`) — `/generate` 초입
 *   ② 후불 발송ID 집합(`company_agent_ids.billing_type`) — 사용량 집계 안
 *   ③ 발송ID별 단가(`company_agent_ids.cost_per_*`) — 금액 계산 직전
 *   셋 다 트랜잭션 밖이라, 그 사이 슈퍼관리자 화면에서 값이 바뀌면 조용히 어긋난다.
 *   예: ②를 읽을 때 `prepaid`라 성공 10만 건이 제외됐는데 ③ 전에 `postpaid`로 바뀌면,
 *   단가 행은 있는데 사용량은 이미 빠져 **아무 경고 없이 0원 청구**가 된다.
 *
 *   지금이 특히 위험한 시기다 — 283개 발송ID 단가를 직원들이 채워 넣는 중이라
 *   발행과 단가 저장이 겹칠 확률이 평상시보다 구조적으로 높다.
 *
 * 그래서 원장을 **한 스냅샷으로 한 번 읽고**, 발행 트랜잭션 안에서 지문을 다시 계산해
 * 그 사이 바뀌었는지 확인한다. 잠금(`FOR SHARE`)을 쓰지 않는 이유는 원장이 화면에서 수시로
 * 갱신되는 축이라 잠금 대기가 발행을 붙잡기 때문이다.
 *
 * ★ 회사 단가도 같은 스냅샷에 넣는다. 에이전트만 묶으면 같은 결함이 웹 단가에 그대로 남는다.
 */

import pool from '../config/database';
import { BILLING_TYPES, type AgentUnitPriceRow, type AgentPriceColumn } from './billing-types';

/**
 * `company_agent_ids` 한 행 — 발송ID별 선불여부와 단가는 회사 축과 완전히 독립이다(2026-07-24 ALTER).
 * ★ 2026-07-29 단가 컬럼은 `AgentUnitPriceRow`(축 정의)를 그대로 상속한다. 따로 나열하면
 *   유형이 늘 때 한쪽만 늘어나고, 그 차이가 곧 그 유형의 미청구다.
 */
export interface AgentLedgerRow extends AgentUnitPriceRow {
  billing_type: string;
}

export interface BillingLedger {
  /** 전체 발송ID 행(선불 포함) — 제외 사유를 설명하려면 선불 행도 알아야 한다 */
  agentRows: AgentLedgerRow[];
  /** 청구 대상 후불 발송ID(대문자) */
  postpaidSendIds: Set<string>;
  /** 후불 행만 — 금액 계산에 넘긴다 */
  postpaidPriceRows: AgentLedgerRow[];
  /** 회사 단가 행(`cost_per_*`) */
  companyPriceRow: any;
  /** `companies.usage_type` — 매핑이 0인데 agent/both면 게이트웨이 발송분이 조용히 빠진다는 신호다 */
  usageType: string;
  /** 이 스냅샷의 지문. 발행 트랜잭션 안에서 다시 계산해 대조한다 */
  fingerprint: string;
}

/** 회사 단가 컬럼 — 축 정의에서 뽑는다. 유형이 늘면 지문도 자동으로 그 단가를 감시한다. */
const COMPANY_PRICE_COLS: string[] = BILLING_TYPES
  .map((t) => t.companyPriceColumn)
  .filter((c): c is string => !!c);

/** 발송ID 단가 컬럼 — 지문·SELECT가 같은 목록을 쓴다(둘이 갈라지면 감시 못 하는 단가가 생긴다). */
const AGENT_PRICE_COLS: AgentPriceColumn[] = BILLING_TYPES
  .map((t) => t.agentPriceColumn)
  .filter((c): c is AgentPriceColumn => !!c);

/** 값이 없는 것과 0원을 지문에서 구분한다 — 그 둘이 청구에서 다르게 다뤄지기 때문이다. */
function fp(v: any): string {
  return v === null || v === undefined || v === '' ? '~' : String(v);
}

/**
 * (순수) 원장 지문. 정렬을 고정해 읽는 순서가 달라도 같은 값이 나오게 한다.
 * 지문이 달라졌다는 건 "그 사이 누가 단가나 선불여부를 바꿨다"는 뜻이다.
 */
export function billingLedgerFingerprint(companyPriceRow: any, agentRows: AgentLedgerRow[]): string {
  // 단가만이 아니라 **청구 가능 여부와 금액을 정하는 값 전부**가 지문에 들어가야 한다.
  const co = [
    ...COMPANY_PRICE_COLS.map((c) => fp(companyPriceRow?.[c])),
    fp(companyPriceRow?.billing_type),
    fp(companyPriceRow?.usage_type),
    fp(companyPriceRow?.plan_monthly_price),
    // ★ 2026-07-26 부가세 기준. 단가 숫자가 그대로여도 이 값이 바뀌면 **공급가액이 10% 달라진다.**
    //   직원들이 회사별로 단가를 재입력하는 중이라 발행과 겹칠 확률이 구조적으로 높다.
    fp(companyPriceRow?.unit_price_basis),
    // ※ `plan_id`는 지문에 넣지 않는다(2026-07-26 Codex 6차 수용).
    //   한 번 넣었다가 되돌렸다 — 7월분을 8월에 뽑는 동안 8월 플랜이 **같은 금액**의 다른 플랜으로 바뀌면
    //   7월 금액과 무관한데도 `BILLING_LEDGER_CHANGED`로 발행이 막힌다.
    //   요금제 금액의 진실은 `company_plan_changes`의 시점 스냅샷이고, 현재 플랜의 가격 변동은
    //   위 `plan_monthly_price`가 이미 잡는다.
  ].join(':');
  const agents = (agentRows || [])
    .map((r) => [
      String(r.id), String(r.billing_type || ''),
      ...AGENT_PRICE_COLS.map((c) => fp((r as any)[c])),
    ].join(':'))
    .sort()
    .join('|');
  return `co(${co})/agent(${agents})`;
}

// 컬럼 목록은 축에서 만든다 — SELECT와 지문이 갈라지면 감시하지 않는 단가가 생긴다.
// (조립에 들어가는 값은 전부 소스 상수라 외부 입력이 섞이지 않는다)
const AGENT_SQL = `SELECT id, agent_send_id, billing_type, ${AGENT_PRICE_COLS.join(', ')}
                     FROM company_agent_ids WHERE company_id = $1::uuid`;
// ★ 2026-07-26 `billing_type`·요금제 월정액도 스냅샷에 넣는다(Codex 2차 수용).
//   `billing_type`은 **청구 가능 여부 자체**를 바꾸는 값인데 지문에 없어서,
//   무거운 MySQL 집계가 도는 동안 후불→선불로 바뀌어도 재검증에 안 걸렸다.
//   `plans.monthly_price`는 "유료인데 요금제 이력이 없다"를 판정하는 근거다.
// `c.plan_id`는 조회만 한다(지문 제외) — 해지·미지정 관측용이고 판정 근거는 `company_plan_changes` 이력이다.
const COMPANY_SQL = `SELECT ${COMPANY_PRICE_COLS.map((c) => `c.${c}`).join(', ')},
                            c.usage_type, c.billing_type, c.plan_id, c.unit_price_basis,
                            p.monthly_price AS plan_monthly_price
                       FROM companies c
                       LEFT JOIN plans p ON p.id = c.plan_id
                      WHERE c.id = $1::uuid`;

/**
 * 청구에 쓰이는 단가·선불여부를 한 번에 읽는다.
 * @param db 트랜잭션 안에서 재확인할 땐 그 `client`를 넘긴다. 미지정 시 풀.
 */
export async function loadBillingLedger(companyId: string, db: any = pool): Promise<BillingLedger> {
  const [agentRes, coRes] = await Promise.all([
    db.query(AGENT_SQL, [companyId]),
    db.query(COMPANY_SQL, [companyId]),
  ]);
  const agentRows = (agentRes.rows || []) as AgentLedgerRow[];
  const companyPriceRow = coRes.rows?.[0] || null;

  const postpaidSendIds = new Set<string>();
  const postpaidPriceRows: AgentLedgerRow[] = [];
  for (const r of agentRows) {
    if (String(r.billing_type) !== 'postpaid') continue;
    const v = String(r.agent_send_id || '').trim();
    if (!v) continue;
    postpaidSendIds.add(v.toUpperCase());
    postpaidPriceRows.push(r);
  }

  return {
    agentRows,
    postpaidSendIds,
    postpaidPriceRows,
    companyPriceRow,
    usageType: String(companyPriceRow?.usage_type || ''),
    fingerprint: billingLedgerFingerprint(companyPriceRow, agentRows),
  };
}

/** 발행 트랜잭션 안에서 지문만 다시 계산한다. 스냅샷과 다르면 그 사이 원장이 바뀐 것이다. */
export async function readBillingLedgerFingerprint(companyId: string, db: any): Promise<string> {
  const ledger = await loadBillingLedger(companyId, db);
  return ledger.fingerprint;
}

/** 회사에 에이전트 발송ID 매핑이 하나라도 있는가 — 에이전트 조회를 시도할지 정하는 기준. */
export function hasAgentMapping(ledger: BillingLedger): boolean {
  return (ledger.agentRows || []).length > 0;
}
