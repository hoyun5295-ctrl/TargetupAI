/**
 * ★ CT: 정산 발행 코어 (2026-07-28 신설 — routes/billing.ts `/generate`에서 동작 무변경 추출)
 *
 * 추출 사유: 거래내역서 **일괄발급**(billing_bulk_jobs 배치)이 발행을 회사 단위로 반복 호출해야 한다.
 * 라우트 인라인인 채로는 배치가 같은 로직을 복사하게 되고(no_inline_duplication), 복사본은 반드시 갈라진다.
 * 라우트와 배치 워커가 **이 함수 하나**를 부른다. SoT = docs/2026-07-28-bulk-invoice-confirm-taxbill-design.md §6.
 *
 * 이동 규칙(동작 무변경 증빙):
 *   - 내부 변수명·SQL·로그 문자열을 그대로 유지했다 — `billing-route-invariants.test.ts`의 소스 스캔이
 *     이 파일을 계속 물 수 있어야 한다(예: `loadPlanChanges(company_id, billing_end, client)`).
 *   - `return res.status(X).json(Y)`는 전부 `throw new BillingIssueError(X, Y)`로 바꿨다.
 *     트랜잭션 안 조기 반환의 선행 ROLLBACK은 제거했다 — 기존 catch가 ROLLBACK을 담당하므로 순효과가 같다.
 *   - 성공 응답 객체는 그대로 반환한다. HTTP 매핑(res.status/json)은 호출부(라우트·배치) 몫이다.
 */

import { randomUUID } from 'crypto';
import pool from '../config/database';
import { CREDIT_UNIT_PRICE } from './ai-credit-calc';
import {
  buildCompanyUsageByDay, buildBillingTotals, resolveBillingUnitPricesDetailed, logUnbillableUsageKeys,
  buildBillingUsageRows, diffBillingRowsVsDayData, priceBillingRows,
  findUnsetPricedTypes, summarizeBlockList, findBlockingPendingRows,
  resolveExistingUserIds, nullifyUnknownUserIds, checkBillingAmountIdentity, chunkArray,
  splitBillingSheets, checkSheetSumIdentity, buildPlanBillingItems, toDayKey,
  buildExtraBillingItems, extraRowUserId, extraRowsBlockingIssue,
  EXTRA_ITEM_SOURCE_SELECT, EXTRA_ITEM_SOURCE_JOIN,
  type PricedBillingItem, type BillingScope,
} from './send-usage-aggregation';
// ★ 2026-07-30 절사 위치 정정 — 헤더·장 공급가액을 절사된 항목줄 합에서 파생(그룹핑·절사 단일원).
import { sumFlooredInvoiceLines } from './billing-invoice-lines';
// ★ 2026-08-04 수량 수정 발행 — 사람이 넣은 조정을 같은 유형·같은 단가 줄로 얹는다(서수란 0804 접수).
import {
  loadQtyAdjustments, buildAdjustmentBillingItems, findNegativeAdjustedTypes, QtyAdjustmentError,
} from './billing-qty-adjust';
import { loadBillingLedger, readBillingLedgerFingerprint } from './billing-ledger';
import { floorWon, vatOfSupply } from './money';
import { normalizeUnitPriceBasis } from './unit-price';
// ★ 2026-08-05 요금제 무료 제공 공제 — 발행과 미리보기가 같은 함수를 쓴다(§2-4 규약).
import {
  readFreeDeductibleForBilling, freeDeductibleFingerprint,
  grantFreeMessagingForCompany, FreeMessagingSchemaPendingError,
} from './free-messaging';
import {
  loadPlanChanges, buildPlanSegments, sumPlanSegments, evaluatePlanHistoryGate,
  countPlanChanges, planChangesFingerprint,
} from './plan-proration';
// ★ 2026-08-05 회사 단위 정산 잠금 CT — 7벌 복제를 하나로. 인라인 복사 금지(그 순간 8번째 복제본이다).
import { lockCompanyForBilling } from './billing-lock';

/** 발행 차단·검증 실패. status = HTTP 상태, body = 그대로 응답으로 나갈 JSON(코드·문구 계약 유지). */
export class BillingIssueError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, any>,
  ) {
    super(String(body?.error || `billing issue blocked (${status})`));
    this.name = 'BillingIssueError';
  }
}

/** 기간 축 충돌 — 겹치는 발행 · 수동 정산완료. */
export interface BillingPeriodConflicts {
  overlap: {
    id: string; status: string; scope: string | null; user_id: string | null;
    billing_start: string; billing_end: string;
  } | null;
  manualCompleted: { period_start: string; period_end: string; reason: string | null } | null;
}

/**
 * ★ 2026-08-04 신설 — 같은 두 조회가 **세 벌로 복제**돼 있었다(발행 사전검사·잠금 안 재검사·정액 발행).
 *   그리고 미리보기에는 아예 없어서 "미리보기는 통과인데 발행만 막힌다"가 났다 — 미리보기의 존재 이유가 그 반대다.
 *   네 곳이 이 함수 하나를 쓴다. 잠금 안에서 재검사하는 경로 때문에 `db`로 트랜잭션 client를 받는다.
 */
export async function readBillingPeriodConflicts(
  companyId: string,
  billingStart: string,
  billingEnd: string,
  db: { query: (text: string, params?: any[]) => Promise<any> } = pool,
): Promise<BillingPeriodConflicts> {
  const overlap = await db.query(
    `SELECT id, status, scope, user_id, billing_start, billing_end FROM billings
     WHERE company_id = $1
       AND billing_start <= $3::date AND billing_end >= $2::date
     LIMIT 1`,
    [companyId, billingStart, billingEnd],
  );
  // ★ 2026-07-29 수동 정산완료 — 화면 목록은 "완전히 덮을 때만" 숨기지만 발급 차단은 **조금이라도 겹치면** 막는다.
  const manual = await db.query(
    `SELECT period_start, period_end, reason FROM billing_manual_completions
      WHERE company_id = $1
        AND period_start <= $3::date AND period_end >= $2::date
      LIMIT 1`,
    [companyId, billingStart, billingEnd],
  );
  return { overlap: overlap.rows[0] || null, manualCompleted: manual.rows[0] || null };
}

/** 사람이 읽는 차단 사유 — 발행 에러 문구와 미리보기 blocker 문구를 한 곳에서 만든다. */
export function describeBillingPeriodConflict(
  c: BillingPeriodConflicts,
): { code: string; message: string; detail: Record<string, any> } | null {
  if (c.overlap) {
    const ex = c.overlap;
    return {
      code: 'BILLING_PERIOD_OVERLAP',
      message: `해당 기간과 겹치는 정산이 이미 존재합니다 (${String(ex.billing_start).slice(0, 10)} ~ ${String(ex.billing_end).slice(0, 10)})`,
      detail: {
        existing_id: ex.id,
        existing_status: ex.status,
        existing_scope: ex.scope,
        existing_user_id: ex.user_id,
      },
    };
  }
  if (c.manualCompleted) {
    const m = c.manualCompleted;
    return {
      code: 'BILLING_MANUAL_COMPLETED',
      message: `해당 기간과 겹치는 구간이 수동 정산완료로 처리돼 있습니다 (${String(m.period_start).slice(0, 10)} ~ ${String(m.period_end).slice(0, 10)}${m.reason ? ` · ${String(m.reason).slice(0, 100)}` : ''}). 자동 발행하려면 일괄발급 화면에서 그 기록을 먼저 해제해 주세요.`,
      detail: {},
    };
  }
  return null;
}

/** 발행 경로 — 충돌이 있으면 409로 던진다(미리보기는 던지지 않고 문구만 읽는다). */
export function assertNoBillingPeriodConflict(c: BillingPeriodConflicts): void {
  const d = describeBillingPeriodConflict(c);
  if (!d) return;
  throw new BillingIssueError(409, { error: d.message, code: d.code, ...d.detail });
}

/**
 * ★ 2026-08-20 정산월(라벨) 파생 — 서수란 0819 접수 (docs/FEATURE-BILLING.md).
 *
 * 정산 한 건이 "몇 월분인가"를 시스템이 추측하지 않는다 — 사람이 정하는 값이고, 기본값은 **종료일의 역월**이다.
 * 그전에는 `new Date(billing_start).getMonth()`로 시작월을 굳혀서, 중간정산(7/16~8/15)이 "7월 정산"이라
 * 불리는데 8월 기준으로 입력한 부가서비스가 실렸다(접수 증상 ①②의 같은 뿌리).
 *
 * - 허용 집합 = 정산 기간에 걸친 역월뿐. 밖이면 422 — 이름이라도 기간 밖 달을 달 수 없다.
 * - 계산은 'YYYY-MM-DD' 문자열 절단으로만 한다. Date 파싱이 없어 서버 TZ와 무관하다
 *   (Date 경유는 음수 오프셋 TZ에서 1일 시작이 전월로 밀리는 잠복 결함이었다).
 * - ★ 2026-08-20(2) 재오픈 정정 — 추가 청구 항목(billing_extra_items)의 귀속 축 = **청구월 = 이 라벨**이다.
 *   항목은 자기 청구월 라벨의 정산에만 실린다. 라벨 부재 고아의 신규 유입은 monthFullyCovered가 반영 시점에 거부한다.
 */
export function resolveBillingLabelMonth(
  labelMonth: string | null | undefined,
  billingStart: string,
  billingEnd: string,
): { year: number; month: number } {
  const startYm = String(billingStart).slice(0, 7);
  const endYm = String(billingEnd).slice(0, 7);
  const raw = String(labelMonth || '').trim();
  const chosen = raw === '' ? endYm : raw;
  const m = /^(\d{4})-(\d{2})$/.exec(chosen);
  const month = m ? Number(m[2]) : 0;
  // 'YYYY-MM'은 사전순 비교가 곧 시간순이다 — 기간에 걸친 달 = startYm ≤ chosen ≤ endYm.
  if (!m || month < 1 || month > 12 || chosen < startYm || chosen > endYm) {
    throw new BillingIssueError(422, {
      error: `정산월은 정산 기간에 걸친 달(${startYm} ~ ${endYm}) 중에서만 지정할 수 있습니다. 받은 값: ${raw || '(없음)'}`,
      code: 'BILLING_LABEL_MONTH_INVALID',
    });
  }
  return { year: Number(m[1]), month };
}

export interface IssueBillingInput {
  company_id: string;
  user_id?: string | null;
  billing_start: string;
  billing_end: string;
  /** 발행 단위. 미지정 시 user_id 유무로 유도(단 user_id+무scope는 422 — 옛 호출 차단 계약 유지) */
  scope?: string | null;
  /** 발행 실행자(billings.created_by) */
  adminId?: string | null;
  /** ★ 2026-08-20 정산월 라벨 'YYYY-MM'. 미지정 = 종료일의 역월. 기간에 걸친 달 밖이면 422. */
  labelMonth?: string | null;
}

/** 정산 발행 1건 — 성공 시 라우트가 그대로 res.json 하던 응답 객체를 반환한다. 차단은 BillingIssueError로 던진다. */
export async function issueBilling(input: IssueBillingInput): Promise<any> {
  const { company_id, user_id, billing_start, billing_end } = input;
  const adminId = input.adminId ?? null;

  if (!company_id || !billing_start || !billing_end) {
    throw new BillingIssueError(400, { error: '필수: company_id, billing_start, billing_end' });
  }

  if (billing_start > billing_end) {
    throw new BillingIssueError(400, { error: '시작일이 종료일보다 늦을 수 없습니다' });
  }

  // ★ 2026-08-20 정산월 = 사람이 정하는 라벨(기본 종료월) — 파생 소유자는 resolveBillingLabelMonth 하나.
  //   옛 파생(시작일 Date 파싱)은 중간정산을 시작월로 굳혔고 TZ 잠복 결함도 있었다(함수 주석 참조).
  const { year: billing_year, month: billing_month } = resolveBillingLabelMonth(
    input.labelMonth, billing_start, billing_end,
  );

  // ★ 2026-07-26 발행 단위(scope). 지금은 `combined`(회사 1장)와 `by_user`(계정별)만 구현한다 —
  //   발송ID별(`by_agent`)은 Harold 결정으로 이월. 값만 나중에 추가하면 되도록 축은 지금 잡는다.
  const scope: string = String(input.scope || (user_id ? 'by_user' : 'combined'));
  if (scope === 'by_agent') {
    throw new BillingIssueError(422, {
      error: '발송ID별 발행은 아직 준비되지 않았습니다. 회사 합산으로 발행해 주세요.',
      code: 'BILLING_SCOPE_NOT_SUPPORTED',
    });
  }
  if (scope !== 'combined' && scope !== 'by_user') {
    throw new BillingIssueError(400, { error: `발행 단위 값이 올바르지 않습니다: ${scope}`, code: 'BILLING_SCOPE_INVALID' });
  }
  // ★ 2026-07-26 `user_id`의 의미가 바뀌었다. 그 전에는 "이 계정 발송분만 담은 한 장"이었고,
  //   그래서 테스트·스팸·에이전트·크레딧이 통째로 빠진 청구서가 나갔다(그 상태가 5개월 이상 유지됐다).
  //   이제 계정별 발행은 **회사 전체를 한 번에** 계정 장 N개 + 공통 장 1개로 낸다.
  //   옛 호출이 조용히 다른 동작을 하지 않도록, 단일 계정 지정은 받지 않고 새 흐름을 안내한다.
  if (user_id && !input.scope) {
    throw new BillingIssueError(422, {
      error: '계정 하나만 지정하는 발행은 더 이상 지원하지 않습니다. 그 방식은 테스트·스팸필터·에이전트·AI 크레딧이 빠진 청구서를 만듭니다. 계정별 발행은 발행 단위를 "계정별"로 선택하면 회사 전체가 계정 장 + 공통 장으로 한 번에 나옵니다.',
      code: 'BILLING_USER_SCOPE_CHANGED',
    });
  }

  // 1) 중복 체크 (기간 겹침)
  // ★ 2026-07-26 축 정정 — 그 전에는 `COALESCE(user_id, nil)`로 비교해서 **회사 정산과 계정별 정산이
  //   서로를 못 막았다.** 회사 1장을 뽑고 같은 달 계정별 정산을 또 뽑으면 그 계정 웹 발송분이 두 번 청구된다.
  //   반대로 계정별만 뽑으면 에이전트·테스트·스팸·크레딧이 통째로 미청구가 된다.
  //   불변식은 하나다 — **한 회사·한 기간에는 하나의 발행만 존재한다.**
  // ★ 2026-07-26 code 부여 — 차단 3종이 422로 빠지면서 409는 이 케이스 전용이 됐다.
  // ★ 2026-08-04 판정을 CT로 통일(readBillingPeriodConflicts) — 미리보기가 같은 문을 본다.
  //   수동 정산완료도 여기서 함께 본다(전에는 잠금 안에서만 봐서 늦게 알았다. 잠금 안 재검사는 그대로 남는다).
  assertNoBillingPeriodConflict(
    await readBillingPeriodConflicts(company_id, billing_start, billing_end),
  );

  // 2) 고객사 단가 조회 (스냅샷)
  // ★ 2026-07-26 `created_at`을 함께 읽는다(SCHEMA.md 등재분·information_schema 실측 확인).
  //   요금제 이력 공백 검사의 기준일이다.
  const companyResult = await pool.query(
    `SELECT company_name, billing_type, created_at,
            cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao,
            cost_per_test_sms, cost_per_test_lms
     FROM companies WHERE id = $1`,
    [company_id]
  );
  if (companyResult.rows.length === 0) {
    throw new BillingIssueError(404, { error: '고객사를 찾을 수 없습니다' });
  }
  const co = companyResult.rows[0];

  // ★ 2026-07-26 단가·선불여부를 **한 스냅샷으로 한 번만** 읽는다.
  //   금액에 쓰는 값과 지문에 들어가는 값이 **같은 읽기**여야 재검증이 의미를 갖는다.
  const ledger = await loadBillingLedger(company_id);

  // ★ 2026-07-25 선불 회사 이중 청구 차단. 판정 근거 = 원장 스냅샷(Codex 3차 CRITICAL 수용).
  if (String(ledger.companyPriceRow?.billing_type) === 'prepaid') {
    throw new BillingIssueError(400, {
      error: `${co.company_name || '해당 고객사'}는 선불 고객사입니다. 발송 시점에 잔액에서 이미 차감되었으므로 월 정산서를 발행하면 이중 청구가 됩니다.`,
      code: 'PREPAID_COMPANY_NOT_BILLABLE',
      billing_type: co.billing_type,
    });
  }

  // ★ 2026-07-25 단가 해석을 CT로 — 0원 설정이 `|| 일반단가` 폴백에 먹히던 결함 정정.
  const { prices, unsetKeys: webUnsetPriceKeys } = resolveBillingUnitPricesDetailed(ledger.companyPriceRow);

  // 3~6) 사용량 집계 — 항상 **회사 전체**다. 계정별 발행은 이 결과를 장으로 쪼개서 낸다.
  // ★ 2026-07-26 단계별 소요 계측 — 느린 지점을 추측이 아니라 로그로 본다.
  const tStart = Date.now();
  const dayData = await buildCompanyUsageByDay({
    companyId: company_id,
    startDate: billing_start,
    endDate: billing_end,
  });
  const tDayData = Date.now();

  // 7) 합산 — ★ 2026-07-25 미리보기와 같은 함수로(금액 불일치 차단)
  const totals = buildBillingTotals(dayData);
  logUnbillableUsageKeys(dayData, `정산생성 company=${company_id} ${billing_start}~${billing_end}`);
  const totalSms = totals.SMS, totalLms = totals.LMS, totalMms = totals.MMS, totalKakao = totals.KAKAO;
  // ★ 2026-07-29 브랜드메시지 — 항등식에서 빠지면 상세합과 공급가액이 갈려 BILLING_AMOUNT_MISMATCH로 발행이 막힌다.
  const totalBrand = totals.BRAND;
  const totalTestSms = totals.TEST_SMS, totalTestLms = totals.TEST_LMS;
  const totalSpamSms = totals.SPAM_SMS, totalSpamLms = totals.SPAM_LMS;

  // 스팸필터 단가 = 일반 단가와 동일 (D16 결정)
  const spamSmsCost = prices.SMS;
  const spamLmsCost = prices.LMS;
  const allPrices: Record<string, number> = { ...prices, SPAM_SMS: spamSmsCost, SPAM_LMS: spamLmsCost };

  // ★ 2026-07-26 청구 상세 — 채널 × 일자 × (계정 | 발송ID) × 유형.
  const usage = await buildBillingUsageRows({
    companyId: company_id,
    startDate: billing_start,
    endDate: billing_end,
    ledger,
  });
  console.log(`[정산][소요] company=${company_id} ${billing_start}~${billing_end} — 일자축 집계 ${tDayData - tStart}ms · 상세축 집계 ${Date.now() - tDayData}ms`);

  // 새 상세와 기존 집계가 갈라지면 화면·엑셀 숫자와 청구서 금액이 어긋난다.
  const axisDiffs = diffBillingRowsVsDayData(usage.rows, dayData);
  if (axisDiffs.length > 0) {
    console.log(`[정산][축불일치] company=${company_id} ${billing_start}~${billing_end} — ${axisDiffs.map((d) => `${d.typeKey}: 상세 ${d.rowsSuccess} vs 집계 ${d.dayDataSuccess}`).join(', ')}`);
    throw new BillingIssueError(422, {
      error: '청구 상세와 사용량 집계의 수량이 일치하지 않아 발행을 중단했습니다. 두 경로가 갈라진 상태로 발행하면 화면·엑셀과 청구서 금액이 어긋납니다.',
      code: 'BILLING_AXIS_MISMATCH',
      mismatches: axisDiffs,
    });
  }

  // ★ 2026-08-05 요금제 무료 제공 — 이번 발행에서 청구 수량에서 뺄 몫(유형별).
  //   `used_qty − 이미 발행에 반영된 양`이라 중간정산으로 같은 달을 두 번 발행해도 두 번 빠지지 않는다.
  //   DDL 미실행이면 빈 객체가 와서 공제 0 = 이 기능 도입 전과 완전히 같은 청구가 나간다.
  // ★ 2026-08-05 (Codex 2R high) 공제량을 재기 **전에** 당월 지급행을 보장한다.
  //   지급 워커는 회사 잠금을 쓰지 않으므로, 잠금 전후 두 조회가 모두 "지급행 없음"을 본 사이에
  //   워커가 당월 행을 넣으면 지문이 같아 통과하고 **무료 공제 없이 전액 청구**된다(부재 행 phantom —
  //   `ON CONFLICT`는 중복만 막지 존재하지 않던 행을 막지 못한다). 지급이 멱등이라 여기서 한 번
  //   불러 두면 그 창이 닫힌다. 이미 있으면 아무 일도 일어나지 않는다.
  await grantFreeMessagingForCompany(company_id);
  let freeDeductible: Record<string, number>;
  try {
    freeDeductible = await readFreeDeductibleForBilling(company_id, billing_start, billing_end);
  } catch (e: any) {
    // DDL 미실행이면 발행을 멈춘다 — 무료 공제 없이 나가면 고객에게 틀린 금액이 청구된다(§2-1).
    if (e instanceof FreeMessagingSchemaPendingError) {
      throw new BillingIssueError(503, {
        error: '요금제 무료 제공 정보를 읽을 수 없어 발행을 중단했습니다. DB 마이그레이션(무료 메시징 4문) 실행이 필요합니다.',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    throw e;
  }
  // 잠금 후 재검증용 지문 — 같은 달을 겹치지 않는 두 기간으로 동시에 발행하면 둘 다 같은 잔량을 읽어
  // 같은 무료분을 두 번 적용할 수 있다(Codex 1R high). 원장·요금제 이력과 **같은 규약**으로 닫는다.
  const freeFingerprint = freeDeductibleFingerprint(freeDeductible);
  const priced = priceBillingRows(
    usage.rows, allPrices, ledger.postpaidPriceRows,
    normalizeUnitPriceBasis(ledger.companyPriceRow?.unit_price_basis),
    freeDeductible,
  );

  // ★ 2026-07-26 회사 단가 미설정 — 그 전에는 `?? 0`으로 조용히 0원 청구됐다.
  //   성공 수량이 있는 유형만 막는다.
  const webUnsetPriced = findUnsetPricedTypes(webUnsetPriceKeys, usage.rows);
  if (webUnsetPriced.length > 0) {
    throw new BillingIssueError(422, {
      error: `고객사 단가가 설정되지 않은 발송 유형이 있어 발행을 중단했습니다. 고객사 관리에서 단가를 채운 뒤 다시 발행해 주세요: ${summarizeBlockList(webUnsetPriced.map((u) => `${u.key}(성공 ${u.success.toLocaleString()})`))}`,
      code: 'WEB_UNIT_PRICE_UNSET',
      unset_price_types: webUnsetPriced,
    });
  }

  // ★ 2026-07-31 (Codex 적대검증 high) 결과 미확정 차단 — 대기(통신사 처리 중) 건이 남아 있으면 발행하지 않는다.
  //   예약 발송 정리 워커는 큐에 행이 있으면 캠페인을 completed로 올리는데 그 행에 대기가 섞여 있을 수 있다.
  //   그 상태로 발행하면 대기 건이 0원으로 확정되고, 뒤에 성공으로 바뀌어도 기간 겹침 차단 때문에
  //   재청구가 불가능하다(영구 미청구). 결과가 확정된 뒤 다시 발행하면 정확히 청구된다.
  //   ★ 2R 정정 — 판정 입력은 **상세 행(usage.rows)**이다. 일자축(dayData)은 에이전트 원장을 읽지 않아
  //   에이전트 대기가 이 게이트를 통째로 우회했다. 그리고 유예를 넘긴 오래된 대기는 막지 않는다
  //   (결과가 영영 안 오는 행이라 0원이 맞고, 무조건 차단하면 그 회사 발행이 영구 봉쇄된다).
  // ★ 2026-07-31 결과 미확정(대기) — **경고 로그만 남기고 발행은 막지 않는다.**
  //   경위(Codex 적대검증 1R~4R): 대기 건이 0원으로 확정되면 기간 겹침 차단 때문에 재청구가 불가능하다.
  //   그래서 처음엔 발행을 차단했는데, 라운드마다 다른 채널에서 구멍이 나왔다 — 스팸은 결과를 확정하지
  //   않은 채 테스트만 완료로 넘기는 경로가 있어 게이트를 통과하고, 최소과금 정액 발행은 이 경로를 아예
  //   지나지 않으며, 스팸 워커가 멈추면 그 회사 정산이 자동 회복되지 않는다.
  //   **원인은 채널마다 "결과 확정"의 의미가 다르다는 것**이고, 한 함수로 덮을 수 있는 문제가 아니다
  //   (채널별 종결 판정 정규화 = 별도 과제). 불완전한 차단은 "막혔으니 안전하다"는 거짓 확신을 주고,
  //   워커 교착 시 정산을 멈춰 세우는 쪽이 더 큰 위험이라 **차단을 걷어내고 관측만 남긴다.**
  //   미리보기는 같은 수치를 화면에 띄워 발행 전에 사람이 보게 한다(billing_guard.pending_types).
  const pendingRows = findBlockingPendingRows(usage.rows);
  if (pendingRows.length > 0) {
    const pendingTotal = pendingRows.reduce((a, p) => a + p.pending, 0);
    console.log(`[정산][대기주의] company=${company_id} ${billing_start}~${billing_end} — 결과 미확정 ${pendingTotal}건(${pendingRows.map((p) => `${p.channel} ${p.key} ${p.pending}${p.stale ? ' stale' : ''}`).join(', ')}). 이 건들은 0원으로 확정되며 같은 기간 재청구가 불가능하다.`);
  }

  // 단가를 못 정하는 유형이 남아 있으면 그 유형은 0원으로 청구된다 — 발행 전에 막는다.
  if (priced.unbillableTypes.length > 0) {
    throw new BillingIssueError(422, {
      error: `청구 단가가 정의되지 않은 발송 유형이 있어 발행을 중단했습니다: ${summarizeBlockList(priced.unbillableTypes.map((u) => `${u.key}(성공 ${u.success.toLocaleString()})`))}. 그대로 발행하면 이 유형이 0원으로 청구됩니다.`,
      code: 'UNBILLABLE_TYPE_KEY',
      unbillable_types: priced.unbillableTypes,
    });
  }
  if (priced.missingAgentPrices.length > 0) {
    throw new BillingIssueError(422, {
      error: `에이전트 발송ID 단가가 설정되지 않아 발행을 중단했습니다. 발송ID별 단가를 채운 뒤 다시 발행해 주세요: ${summarizeBlockList(priced.missingAgentPrices.map((m) => `${m.agentSendId} ${m.typeKey}(성공 ${m.success.toLocaleString()})`))}`,
      code: 'AGENT_UNIT_PRICE_MISSING',
      missing_agent_prices: priced.missingAgentPrices,
    });
  }

  // ★ 2026-07-26 계정 실재 확인 — 삭제된 계정은 미상으로 내리고 수량·금액은 그대로 청구한다.
  const existingUserIds = await resolveExistingUserIds(
    company_id,
    priced.items.map((i) => i.userId).filter(Boolean) as string[],
  );
  const { items: sendingItems, unknownUserIds } = nullifyUnknownUserIds(priced.items, existingUserIds);
  if (unknownUserIds.length > 0) {
    console.log(`[정산][계정미상] company=${company_id} 삭제되었거나 이 회사 소속이 아닌 계정 ${unknownUserIds.length}건 — 해당 행은 계정 미상으로 청구한다: ${summarizeBlockList(unknownUserIds)}`);
  }

  // ★ 2026-07-26 ④ 요금제(구독) 이용요금 — 구간별 일할. **기간 이전 이력까지** 읽어야 시작 시점 플랜을 안다.
  const planChanges = await loadPlanChanges(company_id, billing_end);
  const planSegments = buildPlanSegments(planChanges, billing_start, billing_end);
  const planItems = buildPlanBillingItems(planSegments);
  const planAmount = sumPlanSegments(planSegments);
  // 이 기간에 걸리는 이력의 지문 — 발행 트랜잭션 안에서 다시 만들어 대조한다(그 사이 변경 차단).
  const planFingerprint = planChangesFingerprint(planChanges);
  // 전 기간 이력 건수 — "기간 안 0건"과 "아예 0건"을 가른다.
  const planHistoryTotal = await countPlanChanges(company_id);
  if (planChanges.length === 0) {
    console.log(`[정산][요금제이력없음] company=${company_id} — 이 기간에 걸리는 요금제 이력이 없다(전 기간 이력 ${planHistoryTotal}건). 요금제 이용요금을 청구하지 않는다.`);
  }

  // ★ 2026-07-26 에이전트 매핑 0 차단(Codex 2차 수용).
  if (usage.agentMappingMissing) {
    throw new BillingIssueError(422, {
      error: '이 고객사는 에이전트를 사용하는 것으로 설정돼 있는데 발송ID 매핑이 하나도 없습니다. 이대로 발행하면 게이트웨이 발송분이 통째로 빠집니다. 발송ID를 등록하거나, 실제로 안 쓴다면 사용 구분을 웹으로 바꿔 주세요.',
      code: 'AGENT_MAPPING_MISSING',
      usage_type: ledger.usageType,
    });
  }

  // ★ 2026-07-26 요금제 이력이 **끊겨 있으면** 막는다 — 판정 축은 "공백의 종류"다(Codex 6차 수용).
  const planMonthlyNow = Number(ledger.companyPriceRow?.plan_monthly_price) || 0;
  const planGate = evaluatePlanHistoryGate({
    segments: planSegments,
    billingStart: billing_start,
    billingEnd: billing_end,
    companyCreatedDay: co.created_at ? toDayKey(co.created_at) : null,
    monthlyPrice: planMonthlyNow,
    planAssigned: Boolean(ledger.companyPriceRow?.plan_id),
    historyTotal: planHistoryTotal,
  });
  if (!planGate.ok) {
    throw new BillingIssueError(422, {
      error: planGate.blockReason === 'history_absent'
        ? '요금제가 배정돼 있는데 요금제 변경 이력이 한 건도 없습니다. 이대로 발행하면 구독료가 0원으로 빠집니다. 이력을 먼저 확인해 주세요.'
        : `요금제 변경 이력이 중간에 끊겨 구독료를 계산할 수 없습니다 (${planGate.gap!.from} ~ ${planGate.gap!.to}, ${planGate.gap!.days}일). 이대로 발행하면 그 구간 구독료가 0원으로 빠집니다.`,
      code: 'PLAN_HISTORY_MISSING',
      block_reason: planGate.blockReason,
      plan_gap: planGate.gap,
      cover_from: planGate.coverFrom,
    });
  }
  if (planGate.uncoveredHead) {
    // 차단하지 않는다. 다만 "그 기간 앞부분에 요금제가 없었다"는 사실은 청구서 금액을 바꾸므로 남긴다.
    console.log(`[정산][요금제없는구간] company=${company_id} ${planGate.uncoveredHead.from}~${planGate.uncoveredHead.to} (${planGate.uncoveredHead.days}일) — 그 구간 구독료 없음(기간 중 최초 배정이거나 요금제 미지정). plan_id=${ledger.companyPriceRow?.plan_id || '없음'}`);
  }

  const billingItems = [...planItems, ...sendingItems];
  // 헤더 공급가액 교차검증(A-8)은 **절사 전** 값으로 한다.
  const agentAmountExact = priced.amountExactByChannel.agent;
  // 실제 청구된 요금제 금액 — 구간별 절사 후 합. 응답·화면에는 이 값이 나간다.
  const planAmountBilled = planItems.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  if (usage.excludedPrepaidSendIds.length > 0) {
    console.log(`[정산] company=${company_id} 선불 발송ID ${usage.excludedPrepaidSendIds.join(',')} 청구 제외(게이트웨이 잔액에서 이미 차감)`);
  }

  // ★ 2026-07-25 7~9) 정산 쓰기를 단일 트랜잭션으로.
  //   무거운 사용량 집계는 트랜잭션 밖, 쓰기와 그 근거가 되는 PG 조회만 안에 넣는다.
  //   ※ config/database.ts의 `query`는 pool.query라 BEGIN/COMMIT이 서로 다른 커넥션에 나뉜다 — 반드시 client 고정.
  const client = await pool.connect();
  let billing: any;
  let itemsCount = 0;
  let aiCreditCount = 0, aiCreditSupply = 0;
  let subtotal = 0, vat = 0, totalAmount = 0;
  let sheetsIssued: any[] = [];
  let batchIdIssued: string | null = null;
  let extraSupplyIssued = 0; // ★ 2026-07-30 월별 추가 항목(080 등) 공급가 합 — 응답 channel_amounts용
  try {
    await client.query('BEGIN');

    // 같은 회사 정산을 동시에 생성하면 위 1번 중복검사를 양쪽 다 통과할 수 있다 — 직렬화한다.
    // ★ 2026-07-26 잠금 축은 **회사 단위**다. ★ 2026-08-05 두 겹(advisory + 회사 행)을 CT 하나가 소유한다.
    await lockCompanyForBilling(client, company_id);

    // 잠금을 기다리는 동안 다른 요청이 먼저 만들었을 수 있다 — 잠금 획득 후 재검사.
    // ★ 2026-07-29 수동 정산완료도 **같은 잠금 아래에서** 본다. 사람이 따로 청구한 구간을 자동 청구서가
    //   덮으면 이중청구다. 판정을 이 트랜잭션 밖에만 두면 검사와 커밋 사이가 항상 열린다. 그래서 여기에도 둔다.
    assertNoBillingPeriodConflict(
      await readBillingPeriodConflicts(company_id, billing_start, billing_end, client),
    );

    // ★ 2026-07-26 원장 재검증 — 지문 대조(잠금 대신).
    const fingerprintNow = await readBillingLedgerFingerprint(company_id, client);
    if (fingerprintNow !== ledger.fingerprint) {
      throw new BillingIssueError(422, {
        error: '발행 중에 단가 또는 선불 설정이 변경되어 중단했습니다. 방금 단가를 저장하셨다면 그대로 다시 발행해 주세요.',
        code: 'BILLING_LEDGER_CHANGED',
      });
    }

    // ★ 2026-07-26 요금제 이력 재검증(Codex 7차 ②-2 수용) — 기간에 걸리는 이력만으로 대조.
    const planFingerprintNow = planChangesFingerprint(await loadPlanChanges(company_id, billing_end, client));
    if (planFingerprintNow !== planFingerprint) {
      throw new BillingIssueError(422, {
        error: '발행 중에 요금제 변경 이력이 바뀌어 중단했습니다. 방금 요금제를 변경하셨다면 그대로 다시 발행해 주세요.',
        code: 'BILLING_PLAN_HISTORY_CHANGED',
      });
    }

    // ★ 2026-08-05 무료 제공 잔량 재검증(Codex 1R high) — 공제량을 잠금 **밖에서** 정했으므로,
    //   그 사이 같은 달의 다른 발행이 일부를 소비했으면 이 발행은 이미 쓰인 무료를 또 적용하게 된다.
    //   잠금 안에서 같은 함수로 다시 읽어 대조한다(원장 지문·요금제 이력과 같은 규약).
    const freeFingerprintNow = freeDeductibleFingerprint(
      await readFreeDeductibleForBilling(company_id, billing_start, billing_end, client),
    );
    if (freeFingerprintNow !== freeFingerprint) {
      throw new BillingIssueError(422, {
        error: '발행 중에 요금제 무료 제공 잔량이 바뀌어 중단했습니다. 같은 달의 다른 청구서가 먼저 발행됐을 수 있습니다. 그대로 다시 발행해 주세요.',
        code: 'BILLING_FREE_QUOTA_CHANGED',
      });
    }

    // ★ D229+ 후불 AI 크레딧 충전 합산 — 이 기간 승인·미청구분. FOR UPDATE = 합산 행과 billed 처리 행 일치 보장.
    // ★ 2026-07-26 크레딧은 **항상** 청구한다 — 회사 전체 발행이라 공통 장에 들어간다.
    let creditChargeRes: { rows: any[] } = { rows: [] };
    {
      creditChargeRes = await client.query(
        `SELECT id, credits, supply_amount FROM ai_credit_requests
          WHERE company_id = $1::uuid AND status = 'approved' AND billed = false
            -- ★ 2026-07-26 KST 경계. date 캐스트는 세션 TZ(Etc/UTC) 기준이라 KST 09:00에서 잘렸다.
            AND processed_at >= ($2 || ' 00:00:00+09')::timestamptz
            AND processed_at < (($3::date + INTERVAL '1 day')::date::text || ' 00:00:00+09')::timestamptz
          FOR UPDATE`,
        [company_id, billing_start, billing_end]
      );
    }
    const chargeSupply = creditChargeRes.rows.reduce((s: number, r: any) => s + Number(r.supply_amount || 0), 0);
    const chargeCount = creditChargeRes.rows.reduce((s: number, r: any) => s + Number(r.credits || 0), 0);
    // ★ #3 후불 overage 합산 — 청구 완료 마커(billed_billing_id)로 이중 청구 차단(Codex 3차 HIGH 수용).
    let overageCount = 0;
    let overageTxIds: string[] = [];
    {
      const overageRes = await client.query(
        `SELECT id, overage_credits FROM ai_credit_transactions
          WHERE company_id = $1::uuid AND type = 'deduct' AND overage_credits > 0
            AND billed_billing_id IS NULL
            -- ★ 2026-07-26 KST 경계.
            AND created_at >= ($2 || ' 00:00:00+09')::timestamptz
            AND created_at < (($3::date + INTERVAL '1 day')::date::text || ' 00:00:00+09')::timestamptz
          FOR UPDATE`,
        [company_id, billing_start, billing_end]
      );
      overageCount = (overageRes.rows as any[]).reduce((s, r) => s + (Number(r.overage_credits) || 0), 0);
      overageTxIds = (overageRes.rows as any[]).map((r) => String(r.id));
    }
    aiCreditCount = chargeCount + overageCount;                       // 충전 + 초과사용 크레딧 수량
    aiCreditSupply = chargeSupply + overageCount * CREDIT_UNIT_PRICE; // 공급가(크레딧×단가=공급가 일관)

    // ★ 2026-08-21 080 고정료(이용료·KT 부가서비스) 근거 행 자동 생성(서수란 0821 접수 — 전 고객사 공통).
    //   고정료는 KT 명세서와 무관한 월정액인데 근거가 명세서 [반영] 행에 묶여 있어서, 명세서를 반영하지
    //   않은 달은 고정료가 통째로 빠졌다(게스코리아 8월 실측). 활성 매핑이면 정산월마다 근거 행
    //   (`080_base` · supply_amount=0)을 여기서 만들고 같은 트랜잭션에서 소비한다 — 금액은 행이 아니라
    //   발행 시점의 매핑 원장에서 읽는다(0804 원칙). 발행 삭제 시 FK SET NULL로 미소비 복귀,
    //   재발행이 NOT EXISTS로 재사용하므로 행이 늘지 않는다. UNIQUE(period_month, kind, source_ref)가
    //   경합 이중 생성을 구조로 막는다(ON CONFLICT DO NOTHING).
    //   옛 `080_fee`·`080_svc` 행이 있는 달은 그 행이 고정료의 근거라 생성하지 않는다(파생 스킵 규칙과 짝 —
    //   buildExtraBillingItems 문서 주석). 회사 잠금(lockCompanyForBilling) 아래라 반영·취소와 직렬화된다.
    //   ★ Codex 1R high 수용 — **소비된 `080_call`이 있는 달도 생성하지 않는다.** 이 배포 전의 080_call은
    //   고정료까지 파생해 그 장에 이미 청구했으므로, 같은 라벨 월의 분할 2차 발행이 base를 만들면 재청구다.
    //   미소비 080_call만 있는 달은 생성한다(그 통화료 행은 새 파생에서 고정료를 안 내므로 base가 근거).
    //   발행 삭제로 080_call이 미소비 복귀하면 재발행이 base를 만들어 고정료 1회가 유지된다.
    await client.query(
      `INSERT INTO billing_extra_items (company_id, period_month, kind, label, supply_amount, source_ref, created_by)
       SELECT n.company_id, $2::date, '080_base', '080 고정료(자동)', 0, n.number, $3
         FROM billing_080_numbers n
        WHERE n.company_id = $1 AND n.is_active = TRUE
          AND NOT EXISTS (
            SELECT 1 FROM billing_extra_items pe
             WHERE pe.company_id = n.company_id AND pe.period_month = $2::date
               AND pe.source_ref = n.number AND pe.kind IN ('080_base', '080_fee', '080_svc')
          )
          AND NOT EXISTS (
            SELECT 1 FROM billing_extra_items pc
             WHERE pc.company_id = n.company_id AND pc.period_month = $2::date
               AND pc.source_ref = n.number AND pc.kind = '080_call'
               AND pc.billed_billing_id IS NOT NULL
          )
       ON CONFLICT DO NOTHING`,
      [company_id, `${billing_year}-${String(billing_month).padStart(2, '0')}-01`, adminId],
    );

    // ★ 2026-07-30 월별 추가 항목(080 이용료·부가서비스·통화료 — billing_extra_items, 서수란 접수).
    //   발행 기간과 겹치는 달의 **미소비** 항목만 싣는다 — 겹침 판정은 billings와 같은 식(월 = [1일, 말일]).
    //   소비 마커 = billed_billing_id(AI 크레딧 billed_billing_id 선례 미러 — Codex 1R critical 수용):
    //   분할 기간 발행(7/1~15 + 7/16~31)이 같은 달 항목을 두 번 싣는 이중청구를 마커가 구조로 막고,
    //   FK ON DELETE SET NULL이라 발행 삭제 시 자동으로 미소비 복귀한다. FOR UPDATE = 반영 취소(DELETE)와의 경합 차단.
    // ★ 2026-08-04 이용료·KT 부가서비스·통화료 청구 여부·귀속은 **매핑 원장에서 읽는다**(EXTRA_ITEM_SOURCE_*).
    //   그전에는 [반영]이 그 값들을 항목 행에 복사해 굳혀서, 매핑을 고쳐도 청구서가 옛 값으로 나갔다
    //   (서수란 0803 접수 2건 — 시세이도 이용료 9,000 고정 / 금강제화 귀속 무시하고 공통 장).
    //   스냅샷은 명세서에서만 나오는 값(그 달 그 번호의 통화료) 하나뿐이다.
    // ★ 2026-08-20 재오픈 정정(서수란 실측) — 귀속 축 = **청구월 = 정산월**. 그전에는 역월∩발행기간
    //   겹침이라 중간정산(7/16~8/15 "8월 정산")이 7월분까지 쓸어 담았다. 역월 정산은 겹침과 월일치가
    //   같은 답이라 동작 무변화. 항목은 자기 청구월 라벨의 정산에만 실린다(차단·표시 5곳도 같은 축).
    const extraRes = await client.query(
      `SELECT e.id, e.kind, e.supply_amount, e.period_month, e.source_ref,
${EXTRA_ITEM_SOURCE_SELECT}
         FROM billing_extra_items e
${EXTRA_ITEM_SOURCE_JOIN}
        WHERE e.company_id = $1
          AND e.billed_billing_id IS NULL
          AND e.period_month = $2::date
        ORDER BY e.period_month, e.kind, e.source_ref
        FOR UPDATE OF e`,
      [company_id, `${billing_year}-${String(billing_month).padStart(2, '0')}-01`],
    );

    // ★ 2026-08-04 근거가 사라진 080 스냅샷이 있으면 **발행하지 않는다**(Codex 적대검증 high 수용).
    //   번호 매핑을 지우거나 다른 회사로 옮기면 그 달 스냅샷의 계약값 근거가 없어진다. 통화료만이라도
    //   싣는 폴백을 뒀더니, 통화료를 안 받기로 등록한 번호에 **없던 통화료가 새로 청구되는** fail-open이었다.
    const extraBlocking = extraRowsBlockingIssue(extraRes.rows);
    if (extraBlocking.length > 0) {
      const shown = extraBlocking.slice(0, 5).map((b) => `${b.periodMonth.slice(0, 7)} ${b.sourceRef}`).join(', ');
      throw new BillingIssueError(422, {
        error: `080 번호 매핑이 없는 반영분이 있어 발행을 중단했습니다 (${shown}${extraBlocking.length > 5 ? ` 외 ${extraBlocking.length - 5}건` : ''}). 추가 청구 관리에서 그 번호의 매핑을 되살리거나 해당 반영을 취소한 뒤 발행해주세요.`,
        code: 'BILLING_080_MAPPING_MISSING',
        numbers: extraBlocking,
      });
    }
    const extraItems = buildExtraBillingItems(extraRes.rows);
    const extraIds: string[] = extraRes.rows.map((r: any) => String(r.id));
    const extraSupply = extraItems.reduce((s, i) => s + i.amountExact, 0);
    extraSupplyIssued = extraSupply;

    // ★ 2026-08-04 수량 수정 발행(서수란 0804 접수) — 사람이 넣은 조정을 **같은 유형·같은 단가**의
    //   상세 행으로 얹는다. 항목줄이 (채널·유형·단가)로 묶이므로 조정 줄이 따로 서지 않고
    //   `LMS 9,435건 × ₩22.8` 한 줄로 인쇄된다. 발송 실적 자체는 사실이라 건드리지 않는다.
    //   조정은 발행이 아니라 회사×기간 축이라, 삭제 후 재발행해도 그대로 살아남는다.
    let adjustItems: PricedBillingItem[] = [];
    let adjustAppliedIds: string[] = [];
    try {
      const adjustRows = await loadQtyAdjustments(client, company_id, billing_start, billing_end);
      adjustItems = buildAdjustmentBillingItems(adjustRows, priced.items, toDayKey(billing_start));
      adjustAppliedIds = adjustRows.map((a) => String(a.id));
    } catch (adjErr: any) {
      if (adjErr instanceof QtyAdjustmentError) {
        throw new BillingIssueError(422, { error: adjErr.message, code: 'BILLING_QTY_ADJUST_UNMATCHED' });
      }
      const amsg = String(adjErr?.message || '');
      if (amsg.includes('does not exist') && (amsg.includes('relation') || amsg.includes('column'))) {
        throw new BillingIssueError(503, {
          error: 'DB 마이그레이션 필요: billing_qty_adjustments 테이블 생성 요청',
          code: 'DB_MIGRATION_PENDING',
        });
      }
      throw adjErr;
    }
    const adjustSupply = adjustItems.reduce((s, i) => s + i.amountExact, 0);

    const allBillingItems = [...billingItems, ...extraItems, ...adjustItems];

    // ★ 2026-08-05 무료 제공으로 청구에서 뺀 금액(정확값). 헤더 축 보정에 쓴다 — 아래 subtotalExact 참조.
    //   단가는 헤더가 쓰는 것과 **같은 `prices` 표**여야 두 축이 같은 기준으로 만난다.
    const freeSupplyExact = billingItems.reduce((s, it) => {
      const free = Number((it as any).freeCount) || 0;
      if (it.channel !== 'web' || free <= 0) return s;
      return s + free * (Number((prices as any)[it.typeKey]) || 0);
    }, 0);

    // ★ 2026-07-26 금액 항등식 — 헤더는 `totals × 단가`, 상세는 `priceBillingRows`로 **서로 다른 코드가 계산한다.**
    //   대조는 **절사 전** 값끼리 한다.
    const subtotalExact =
      (totalSms * prices.SMS) + (totalLms * prices.LMS) +
      (totalMms * prices.MMS) + (totalKakao * prices.KAKAO) + (totalBrand * prices.BRAND) +
      (totalTestSms * prices.TEST_SMS) + (totalTestLms * prices.TEST_LMS) +
      (totalSpamSms * spamSmsCost) + (totalSpamLms * spamLmsCost) +
      agentAmountExact +
      planAmount +
      extraSupply + // ★ 2026-07-30 080 등 월별 추가 항목 — 빠지면 상세합≠공급가액으로 발행이 막힌다(BRAND 선례)
      adjustSupply + // ★ 2026-08-04 수량 조정 — 헤더는 집계 축(totals×단가)이라 조정을 모른다. 여기서 더한다
      // ★ 2026-08-05 요금제 무료 제공 — 같은 이유로 **빼야** 한다. 헤더 축(`buildBillingTotals`)은
      //   일자별 성공 합이라 무료 공제를 모르는데 상세 축(`priceBillingRows`)은 공제 후 금액이다.
      //   이 항이 없으면 무료를 받는 회사는 항등식이 반드시 어긋나 **발행이 통째로 막힌다**(422).
      //   `adjustSupply`가 조정을 더하는 것과 정확히 같은 형태의 보정이다.
      (-freeSupplyExact) +
      aiCreditSupply;
    const amountCheck = checkBillingAmountIdentity(
      allBillingItems.map((i) => ({ amount: i.amountExact })), aiCreditSupply, subtotalExact,
    );
    if (!amountCheck.ok) {
      console.log(`[정산][금액불일치] company=${company_id} ${billing_start}~${billing_end} — 상세합 ${amountCheck.itemsSum} + 크레딧 ${amountCheck.aiCreditSupply} ≠ 공급가액 ${amountCheck.subtotal} (차이 ${amountCheck.diff})`);
      throw new BillingIssueError(422, {
        error: '청구 상세 금액의 합이 공급가액과 일치하지 않아 발행을 중단했습니다. 그대로 발행하면 청구서 항목을 더한 값과 합계가 어긋납니다.',
        code: 'BILLING_AMOUNT_MISMATCH',
        amount_check: amountCheck,
      });
    }

    // 8~9) 장별 발행 — 한 요청이 N+1장을 **원자적으로** 만든다.
    const sheets = splitBillingSheets(allBillingItems, scope as BillingScope);

    // ★ 2026-08-04 조정 후 수량 음수 판정은 **장을 나눈 뒤 장별로** 한다(Codex 재검증 high).
    //   계정 축은 장이 이미 갈랐으므로, 여기서 장 안의 항목줄(채널·유형·단가)만 본다.
    //   회사 전체 합으로 보면 계정 A가 -1인데 B가 100건이라 통과해 과청구가 되고,
    //   반대로 귀속 축(계정·발송ID)을 키에 넣으면 정상 조정이 거부된다. 둘 다 여기서 닫힌다.
    //   ★ 2026-08-05 재오픈 정정 — 판정 축에서 발송ID를 뺐다. 인쇄 줄(`buildInvoiceLines`)이 쓰는
    //   축과 정확히 같아야 한다(상세 = `billing-qty-adjust.ts` 함수 주석).
    for (const sh of sheets) {
      const negatives = findNegativeAdjustedTypes(sh.items as PricedBillingItem[]);
      if (negatives.length > 0) {
        const shown = negatives.map((v) => `${v.channel}/${v.typeKey} ${v.total}건`).join(', ');
        throw new BillingIssueError(422, {
          error: `수량 조정이 실제 발송량보다 커서 수량이 음수가 됩니다 (${shown}). 조정 값을 확인해주세요.`,
          code: 'BILLING_QTY_ADJUST_NEGATIVE',
          negatives,
        });
      }
    }

    // ★ 2026-07-30 절사 위치 정정(Harold — "최종 청구 금액의 소수점만 버려라").
    //   일자행은 정확값이고, 절사는 각 장의 **항목줄에서 1회**(buildInvoiceLines)다.
    //   공급가액 = 장별 절사 합의 합 — 장 문서에 인쇄되는 값의 합과 헤더가 정의상 일치한다.
    //   (그 전에는 일자행 절사 합이라 항목표가 수량×단가와 수십 원 어긋났다 — 서수란 0729 접수)
    //   ⚠ 계정별(by_account) 발행은 합산 발행과 1원 수준 차이가 날 수 있다 — 장이 늘면 절사 횟수도
    //   는다. **장 = 독립 문서 = 세금계산서 단위**라 각 장의 공급가는 그 장 항목표의 절사 합이어야
    //   하고(전역 절사 후 배분하면 장 문서 검산이 깨진다 — 서수란 문제의 장 단위 재발), 차이 방향은
    //   항상 고객 유리(절사 횟수↑ = 금액↓)다. 계약 테스트 = send-usage-aggregation.test.ts.
    const sheetFloored = sheets.map((sh) => sumFlooredInvoiceLines(sh.items as any));
    subtotal = sheetFloored.reduce((s, v) => s + v, 0) + aiCreditSupply;
    vat = vatOfSupply(subtotal);
    totalAmount = subtotal + vat;

    // 장으로 쪼갠 합이 회사 합산과 같은지 — 분산 발행이 회사 총액을 다 담았는지 보는 유일한 장치다.
    //   대조는 **정확값 축**끼리 한다(장별 정확합 vs totals×단가 — 절사 축과 얽히면 검사가 사라진다).
    const sheetSum = checkSheetSumIdentity(sheets, aiCreditSupply, subtotalExact);
    if (!sheetSum.ok) {
      console.log(`[정산][장합불일치] company=${company_id} ${billing_start}~${billing_end} — 장합 ${sheetSum.itemsSum} + 크레딧 ${sheetSum.aiCreditSupply} ≠ 공급가액 ${sheetSum.subtotal} (차이 ${sheetSum.diff})`);
      throw new BillingIssueError(422, {
        error: '장별 금액의 합이 회사 합산 공급가액과 일치하지 않아 발행을 중단했습니다.',
        code: 'BILLING_SHEET_SUM_MISMATCH',
        amount_check: sheetSum,
      });
    }

    // 묶음 식별자 — 부분 삭제 차단과 "N장 중 k장" 표기의 근거. 한 장짜리 발행에는 붙이지 않는다.
    const batchId = sheets.length > 1 ? randomUUID() : null;
    // ★ 2026-07-26 14 → 16. 요금제 일수 전용 컬럼(plan_days·plan_month_days) 추가분.
    // ★ 2026-08-05 16 → 17. 요금제 무료 제공 공제분(free_count).
    const COLS = 17;
    const ITEM_CHUNK_ROWS = 1000;
    const issuedSheets: any[] = [];

    for (const [sheetIdx, sheet] of sheets.entries()) {
      const carries = sheet.carriesCompanyItems;
      // 청구할 내용이 없는 장은 만들지 않는다 — 0원 청구서가 나가는 것을 막는다.
      // ★ 2026-07-26 조건 = "청구 내용 0"(Harold 지시).
      const hasBillableContent =
        sheet.amount > 0 || sheet.items.some((i) => (Number(i.success) || 0) > 0);
      if (!hasBillableContent && !(carries && (aiCreditSupply > 0 || aiCreditCount > 0))) continue;

      // ★ 2026-07-30 장 공급가액 = 그 장의 절사된 항목줄 합 — 문서에 인쇄되는 항목표와 정의상 일치.
      const sheetSubtotal = sheetFloored[sheetIdx] + (carries ? aiCreditSupply : 0);
      const sheetVat = vatOfSupply(sheetSubtotal);
      const t = sheet.totals;

      const billingResult = await client.query(
        `INSERT INTO billings (
          company_id, user_id, billing_year, billing_month, billing_start, billing_end,
          sms_success, lms_success, mms_success, kakao_success,
          sms_unit_price, lms_unit_price, mms_unit_price, kakao_unit_price,
          test_sms_count, test_lms_count, test_sms_unit_price, test_lms_unit_price,
          spam_filter_sms_count, spam_filter_lms_count, spam_filter_sms_unit_price, spam_filter_lms_unit_price,
          subtotal, vat, total_amount, ai_credit_count, ai_credit_supply, created_by, scope, batch_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
        RETURNING *`,
        [
          company_id, sheet.userId, billing_year, billing_month, billing_start, billing_end,
          t.SMS, t.LMS, t.MMS, t.KAKAO,
          prices.SMS, prices.LMS, prices.MMS, prices.KAKAO,
          t.TEST_SMS, t.TEST_LMS, prices.TEST_SMS, prices.TEST_LMS,
          t.SPAM_SMS, t.SPAM_LMS, spamSmsCost, spamLmsCost,
          sheetSubtotal, sheetVat, sheetSubtotal + sheetVat,
          carries ? aiCreditCount : 0, carries ? aiCreditSupply : 0,
          adminId, sheet.sheetScope, batchId,
        ]
      );
      const sheetBilling = billingResult.rows[0];
      issuedSheets.push(sheetBilling);
      if (carries || !billing) billing = sheetBilling;   // 응답 대표 = 회사 단위 항목을 실은 장

      // ★ D229+ 후불 크레딧 충전 행을 billed 처리 (id 배열로 정확히 — 중복 청구 차단)
      //   크레딧을 실은 장에만 건다.
      if (carries && creditChargeRes.rows.length > 0) {
        await client.query(
          `UPDATE ai_credit_requests SET billed = true, billed_invoice_id = $1::uuid WHERE id = ANY($2::uuid[])`,
          [sheetBilling.id, creditChargeRes.rows.map((r: any) => r.id)]
        );
      }

      // ★ 2026-07-26 초과사용 크레딧에도 같은 마커. FK(`ON DELETE SET NULL`)가 삭제 시 자동 복귀.
      if (carries && overageTxIds.length > 0) {
        await client.query(
          `UPDATE ai_credit_transactions SET billed_billing_id = $1::uuid WHERE id = ANY($2::uuid[])`,
          [sheetBilling.id, overageTxIds]
        );
      }

      // ★ 2026-07-30 월별 추가 항목(080 등) 소비 마킹 — 크레딧과 같은 계약.
      //   이 마커가 분할 기간 재발행의 이중청구를 막고, 발행 삭제 시 FK가 자동 복귀시킨다(Codex 1R critical 수용).
      //
      // ★ 2026-07-31 **마커는 그 항목이 실제로 실린 장에 건다.** 그전에는 전부 공통 장(carries) id로 걸었는데,
      //   귀속(user_id)이 생겨 항목이 계정 장으로 갈라진 뒤에도 그대로 두면 공통 장 하나를 지우는 순간
      //   계정 장에 실려 있는 항목까지 미청구로 풀려 다음 발행에서 이중청구가 된다(Codex 적대검증 high 후속).
      //   전체 발행(combined)은 장이 하나뿐이라 그 장이 전부 싣는다.
      //
      // ★ 2026-08-04 귀속 판정은 `extraRowUserId` 하나 — 080은 매핑 원장, 수기 항목은 자기 값이다.
      //   여기서 따로 계산하면 `buildExtraBillingItems`가 실은 장과 마커가 걸리는 장이 갈라진다.
      const sheetExtraIds = scope === 'combined'
        ? extraIds
        : extraRes.rows
            .filter((r: any) => String(extraRowUserId(r) || '') === String(sheet.userId || ''))
            .map((r: any) => String(r.id));
      if (sheetExtraIds.length > 0) {
        await client.query(
          `UPDATE billing_extra_items SET billed_billing_id = $1::uuid WHERE id = ANY($2::uuid[])`,
          [sheetBilling.id, sheetExtraIds]
        );
      }

      // billing_items INSERT (채널 × 일자 × 계정|발송ID × 유형 상세)
      //   ★ `user_id`는 행별 실제 계정, 에이전트 행은 `agent_id`가 발송ID.
      //   `store_id`(대상ID)는 청구 축이 아니다.
      const itemValues: any[][] = sheet.items.map((it: PricedBillingItem) => ([
        sheetBilling.id, company_id,
        it.channel === 'agent' ? null : it.userId,
        it.agentId,
        null,                 // store_id — 청구 축 아님
        it.channel,
        it.itemDate, it.typeKey,
        it.total, it.success, it.fail, it.pending,
        it.unitPrice, it.amount,
        // ★ 2026-07-26 요금제 일수는 전용 컬럼으로. 발송 행은 null이다.
        it.planDays, it.planMonthDays,
        // ★ 2026-08-05 무료 제공 공제분 — 이 칸이 곧 소비 마커다(발행을 지우면 함께 사라진다).
        Number(it.freeCount) || 0,
      ]));

      // ★ 청크 INSERT. 검증은 count(*)가 아니라 **rowCount 합**으로 한다.
      let insertedRows = 0;
      for (const batch of chunkArray(itemValues, ITEM_CHUNK_ROWS)) {
        const ph = batch.map((_, i) => {
          const b = i * COLS;
          return `(${Array.from({ length: COLS }, (_, k) => `$${b + k + 1}`).join(',')})`;
        }).join(',');

        const ins = await client.query(
          `INSERT INTO billing_items (
            billing_id, company_id, user_id, agent_id, store_id, channel,
            item_date, message_type,
            total_count, success_count, fail_count, pending_count,
            unit_price, amount,
            plan_days, plan_month_days,
            free_count
          ) VALUES ${ph}`,
          batch.flat()
        );
        insertedRows += ins.rowCount || 0;
      }
      if (insertedRows !== itemValues.length) {
        throw new Error(`청구 상세 적재 수량이 맞지 않습니다 (적재 ${insertedRows} / 대상 ${itemValues.length}). 청크 분할에 결함이 있습니다.`);
      }
      itemsCount += itemValues.length;
    }

    if (issuedSheets.length === 0) {
      throw new BillingIssueError(422, {
        error: '이 기간에 청구할 발송·크레딧이 없어 발행할 내용이 없습니다.',
        code: 'BILLING_NOTHING_TO_ISSUE',
      });
    }

    // ★ 2026-08-04 파생 결과가 0원이라 어느 장에도 실리지 않은 스냅샷 행(이용료·부가서비스·통화료가
    //   전부 0인 무료 번호 — 리스킨류)도 **이 발행이 소비한 것으로 마킹한다.** 안 하면 미소비로 남아
    //   달마다 다시 읽히고 최소과금 게이트(MIN_CHARGE_EXTRA_EXISTS)를 영구히 막는다.
    //   `billed_billing_id IS NULL` 조건이라 이미 자기 장에 마킹된 행은 건드리지 않고,
    //   FK `ON DELETE SET NULL`이라 그 장을 지우면 함께 미소비로 돌아온다.
    if (extraIds.length > 0 && billing?.id) {
      await client.query(
        `UPDATE billing_extra_items SET billed_billing_id = $1::uuid
          WHERE id = ANY($2::uuid[]) AND billed_billing_id IS NULL`,
        [billing.id, extraIds],
      );
    }

    // ★ 2026-08-04 이 발행이 **실제로 실은 조정 델타를 기록한다**(Codex 재검증 high).
    //   그전에는 화면이 `billings.created_at > 조정.updated_at`으로 "적용됐는가"를 추론했는데,
    //   조정을 수정하면 `updated_at`이 갱신돼 이미 실린 델타까지 미적용으로 보였다(9,435에서 -4로
    //   고치면 base가 9,435가 되어 다음 계산이 통째로 어긋난다). 추론을 버리고 사실을 적는다.
    //   정산을 지우면 삭제 경로가 이 값을 0으로 되돌린다.
    if (adjustAppliedIds.length > 0 && billing?.id) {
      await client.query(
        `UPDATE billing_qty_adjustments SET applied_delta = qty_delta, applied_billing_id = $1::uuid
          WHERE id = ANY($2::uuid[])`,
        [billing.id, adjustAppliedIds],
      );
    }

    sheetsIssued = issuedSheets;
    batchIdIssued = batchId;

    await client.query('COMMIT');
  } catch (txError: any) {
    // ※ 옛 라우트와 의도적 차이(Codex 1R 불수용 — 현 동작 유지): 옛 코드는 조기 반환 앞의 선행
    //   ROLLBACK이 실패하면 그 롤백 에러가 500으로 나갔다. 지금은 롤백 실패를 로그로 남기고
    //   **원래 차단 사유**(409/422)를 응답한다 — 커넥션은 release로 파기되어 트랜잭션이 남지 않고,
    //   운영자에게는 롤백 에러보다 차단 사유가 행동 가능한 정보다.
    try { await client.query('ROLLBACK'); } catch (rbError: any) {
      console.error('정산 생성 롤백 실패:', rbError?.message || rbError);
    }
    throw txError;
  } finally {
    client.release();
  }

  return {
    billing,
    items_count: itemsCount,
    summary: { totalSms, totalLms, totalMms, totalKakao, totalBrand, totalTestSms, totalTestLms, totalSpamSms, totalSpamLms, subtotal, vat, totalAmount },
    // ★ 2026-07-26 발행 단위 결과 — 계정별이면 계정 장 N개 + 공통 장 1개가 한 묶음.
    scope,
    batch_id: batchIdIssued,
    sheet_count: sheetsIssued.length,
    sheets: sheetsIssued.map((b: any) => ({
      id: b.id, scope: b.scope, user_id: b.user_id,
      subtotal: b.subtotal, total_amount: b.total_amount,
    })),
    // ★ 2026-07-26 채널별 소계 — 전부 **절사 후 청구된 값**이다. extra(080 등)는 공급가 정수라 절사 멱등.
    channel_amounts: { ...priced.amountByChannel, plan: planAmountBilled, extra: extraSupplyIssued },
    plan: {
      amount: planAmountBilled,
      segments: planSegments.map((s) => ({
        plan_code: s.planCode, monthly_price: s.monthlyPrice,
        from: s.from, to: s.to, days: s.days, month_days: s.monthDays, amount: floorWon(s.amount),
      })),
    },
    agent: {
      amount: priced.amountByChannel.agent,
      excluded_prepaid_send_ids: usage.excludedPrepaidSendIds,
    },
  };
}

/**
 * ★ 2026-07-30 최소과금 정액 발행 (서수란 접수 · Harold 확정 — "금액이 너무 안 나오는 업체는 기본요금 5만+VAT 5천").
 *
 * 대상 = `company_billing_settings.min_charge_supply`가 설정된 회사. 이 회사들은 일괄발급 담기에서 빠지고
 * (filterBillableCompanies), 최소과금 모달의 [발행]이 이 함수로 **기본요금 정액 청구서**를 만든다.
 * 발행 후 메일·컨펌·세금계산서는 기존 정산 흐름(발행 목록 메일 발송·invoice_confirmations) 그대로.
 *
 * 안전핀 3 (전부 fail-closed — 티켓 원문이 "5만 미만의 경우"라는 조건부라서):
 *  1. **사용량 초과 차단** — 그 달 실사용 공급가를 발행 코어와 같은 집계·단가로 정확 계산해 최소과금을
 *     넘으면 발행 거부(일반 발행 안내). 정액 5만을 끊으면 회사 손해가 나는 달을 막는다.
 *  2. **단가 미설정 = 판정 불가 = 거부** — "5만 미만"인지 계산할 수 없으면 발행하지 않는다.
 *  3. **미소비 추가 항목(080 등) 존재 = 거부** — 정액과 extra가 섞이면 이중청구/누락 어느 쪽이든 난다
 *     (벨루티류 080+최소과금 겹침의 규칙은 서 팀장 확인 후 별도).
 *     **요금제 요금이 그 달에 청구되는 회사**도 부적격(★2026-08-05 축 정정 — `plan_id` 존재가 아니다).
 *
 * 발행 불변식은 issueBilling과 동일 — 회사 advisory lock·겹침 409·수동완료 409·단일 트랜잭션.
 */
export async function issueMinimumChargeBilling(input: {
  company_id: string;
  billing_start: string;
  billing_end: string;
  adminId?: string | null;
}): Promise<any> {
  const { company_id, billing_start, billing_end } = input;
  if (!company_id || !billing_start || !billing_end || billing_start > billing_end) {
    throw new BillingIssueError(400, { error: '필수: company_id, billing_start, billing_end (시작 ≤ 종료)' });
  }

  // ★ Codex 1R 수용 — **끝나지 않은 달은 발행하지 않는다**(KST). 사용량은 가변(MySQL 발송 결과)이라
  //   진행 중인 달의 스냅샷으로 정액을 확정하면 이후 발송이 최소과금을 넘어도 겹침 차단 때문에 되돌릴 수 없다.
  //   서수란 정산 관례도 익월 초라 운영 영향 0.
  const kstToday = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  if (billing_end >= kstToday) {
    throw new BillingIssueError(422, {
      error: `아직 끝나지 않은 기간(${billing_end}까지)은 정액 발행할 수 없습니다. 달이 끝난 뒤 발행해주세요.`,
      code: 'MIN_CHARGE_MONTH_OPEN',
    });
  }

  const coRes = await pool.query(
    `SELECT c.company_name, c.billing_type, c.created_at, s.min_charge_supply
       FROM companies c LEFT JOIN company_billing_settings s ON s.company_id = c.id
      WHERE c.id = $1`,
    [company_id],
  );
  if (coRes.rows.length === 0) throw new BillingIssueError(404, { error: '고객사를 찾을 수 없습니다' });
  const co = coRes.rows[0];
  const minCharge = Number(co.min_charge_supply);
  if (!Number.isSafeInteger(minCharge) || minCharge <= 0) {
    throw new BillingIssueError(422, { error: `${co.company_name}은(는) 최소과금 회사로 등록돼 있지 않습니다.`, code: 'MIN_CHARGE_NOT_SET' });
  }
  if (String(co.billing_type) !== 'postpaid') {
    throw new BillingIssueError(400, { error: `${co.company_name}은(는) 후불 회사가 아닙니다.`, code: 'MIN_CHARGE_NOT_POSTPAID' });
  }

  const ledger = await loadBillingLedger(company_id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 발행·반영·취소와 같은 회사 잠금 — 한 회사·한 기간 = 발행 1건 불변식을 같은 축에서 지킨다.
    // ★ 2026-08-05 회사 행 잠금이 **요금제 이력을 읽기 전으로** 올라왔다(CT가 두 겹을 함께 잡는다).
    //   아래에서 잡으면 그 사이에 소급 요금제 변경이 커밋될 수 있고, 표기가 갈린 두 발행도 못 막는다.
    //   ★ Codex 2R 수용분(크레딧 승인·차감 경로 직렬화)은 그대로다 — 같은 행, 더 이른 시점일 뿐이다.
    await lockCompanyForBilling(client, company_id);

    // ★ 2026-08-04 일반 발행과 **같은 판정 문**(readBillingPeriodConflicts) — 정액 경로만 문구·필드가
    //   달라 운영자가 같은 사유를 다른 말로 받던 것을 함께 통일했다.
    assertNoBillingPeriodConflict(
      await readBillingPeriodConflicts(company_id, billing_start, billing_end, client),
    );

    // ★ 2026-08-05 (서수란 접수) 판정 축을 `plan_id`가 있는가에서 **요금제 요금이 실제로 청구되는가**로 옮긴다.
    //   체험이 끝난 회사는 Cron이 `plan_id`를 FREE(월정액 0)로 강등하므로 `plan_id`는 그대로 남는다 —
    //   그 축으로 막으면 화면에 "요금제 미가입"으로 보이는 회사가 정액 발행에서 거부된다
    //   (씨티케이이비전 실측: plan_code=FREE · monthly_price=0 · subscription_status=trial_expired).
    //   막아야 하는 것은 구독료와 정액이 같은 달에 겹치는 이중청구 하나뿐이고, 월정액 0원은 겹칠 것이 없다.
    //
    //   두 축을 함께 본다 — 어느 하나만으로는 사각이 남는다.
    //     · 기간 축 = 그 달엔 유료였다가 지금 FREE로 강등된 회사의 그 달 구독료를 잡는다.
    //     · 현재 축 = 유료인데 요금제 이력이 유실돼 기간 축이 0으로 나오는 회사를 잡는다.
    //   기간 축 계산은 발행 코어와 **같은 함수**(loadPlanChanges → buildPlanSegments → sumPlanSegments)다.
    //
    //   **잠금 안에서 읽는다** — 밖에서 판정하면 소급(backdated) 요금제 변경이 그 사이에 들어올 때
    //   구독료가 있는 달에 정액이 발행된다. 발행 코어가 요금제 이력을 트랜잭션 안에서 재검증하는 것과 같은 이유다.
    //   현재 축(`plan_monthly_price`)은 아래 원장 지문 재검증이 이미 감시한다(billing-ledger 지문 항목).
    const minChargePlanChanges = await loadPlanChanges(company_id, billing_end, client);
    const minChargePlanSegments = buildPlanSegments(minChargePlanChanges, billing_start, billing_end);
    const minChargePlanAmount = sumPlanSegments(minChargePlanSegments);
    const minChargePlanMonthly = Number(ledger.companyPriceRow?.plan_monthly_price) || 0;
    if (minChargePlanAmount > 0 || minChargePlanMonthly > 0) {
      throw new BillingIssueError(422, {
        error: `${co.company_name}은(는) 요금제(구독) 회사라 최소과금 정액 발행 대상이 아닙니다.`,
        code: 'MIN_CHARGE_PLAN_COMPANY',
        plan_amount: minChargePlanAmount,
        plan_monthly_price: minChargePlanMonthly,
      });
    }
    // ★ Codex 1R high 수용 — **두 축이 0이어도 이력이 손상됐으면 그 0을 믿을 수 없다.**
    //   그 달엔 유료였는데 이력이 끊겨 기간 축이 0으로 나오고 지금은 FREE인 회사가 그대로 통과한다
    //   (구독료가 조용히 빠진 채 정액만 청구된다). 판정을 새로 만들지 않고 **발행 코어가 쓰는 게이트를 그대로 지난다** —
    //   앞 공백(첫 배정 이전)은 사실이라 통과하고, 끊긴 이력·"플랜은 있는데 이력 0건"만 막는다.
    const minChargePlanGate = evaluatePlanHistoryGate({
      segments: minChargePlanSegments,
      billingStart: billing_start,
      billingEnd: billing_end,
      companyCreatedDay: co.created_at ? toDayKey(co.created_at) : null,
      monthlyPrice: minChargePlanMonthly,
      planAssigned: Boolean(ledger.companyPriceRow?.plan_id),
      historyTotal: await countPlanChanges(company_id, client),
    });
    if (!minChargePlanGate.ok) {
      throw new BillingIssueError(422, {
        error: `${co.company_name}은(는) 요금제 변경 이력이 온전하지 않아 정액 발행을 중단했습니다. 이대로 발행하면 그 기간 구독료가 청구서에서 빠진 채 정액만 나갑니다. 이력을 먼저 확인해 주세요.`,
        code: 'MIN_CHARGE_PLAN_HISTORY_MISSING',
        block_reason: minChargePlanGate.blockReason,
        plan_gap: minChargePlanGate.gap,
      });
    }
    // 커밋 직전에 다시 만들어 대조한다 — 사용량 집계가 도는 동안 요금제 이력이 바뀔 수 있다(발행 코어와 같은 계약).
    const minChargePlanFingerprint = planChangesFingerprint(minChargePlanChanges);
    // 안전핀 3 — 그 기간에 걸리는 미소비 추가 항목(080·부가서비스)이 있으면 정액과 섞지 않는다.
    //   ★ 2026-08-04 판정을 **발행과 같은 파생 함수**로 바꿨다(Codex 적대검증 medium 수용).
    //   그전에는 행이 있기만 하면 거부했는데, 전액 무료 080 번호는 파생 금액이 0줄이라 청구할 것이 없다.
    //   그런데 일반 발행은 청구 내용이 없어 `BILLING_NOTHING_TO_ISSUE`로 막히고 소비 마킹도 롤백되므로,
    //   그 회사는 어느 경로로도 그 달 청구서를 만들 수 없는 교착에 빠졌다.
    //   ⇒ **실제로 청구될 금액이 있는 행만** 거부하고, 0줄 스냅샷은 이 정액 발행이 함께 소비한다.
    //   ★ 2026-08-20 귀속 축 = 청구월 = 정산월(발행 코어와 같은 정정 — 역월 기간이라 겹침과 같은 답·동작 무변화).
    // ★ 2026-08-21 (Codex 1R high 수용) **고정료가 있는 활성 080 매핑 회사는 정액 발행 자체를 거부한다.**
    //   고정료 자동 파생(080_base)은 일반 발행 코어가 만드는데, 정액 발행은 그 생성을 지나지 않으므로
    //   행이 하나도 없는 달에 정액이 나가면 그 달 고정료가 영구 누락된다(기간 중복 차단 때문에 일반
    //   발행으로 회수도 불가). 정액과 추가 항목을 섞지 않는다는 기존 원칙의 매핑 판까지다.
    //   ★ Codex 2R high 수용 — 차단 축은 **고정료(이용료·부가서비스 > 0)뿐**이다. 통화료 축을 여기에
    //   넣으면 고정료 무료·통화료만 청구(0/0/true)인 매핑이 스냅샷 0원·부재인 달에 정액도 일반도 못 내는
    //   교착에 빠진다. 통화료 양수는 아래 기존 안전핀(스냅샷 파생 금액 거부)이 이미 소유하고,
    //   0원·부재는 청구할 것이 없어 정액 통과가 맞다(0줄 스냅샷 소비 계약 유지).
    //   080 고정료 회사를 정액으로 처리하려면 매핑을 비활성(청구 중단 명시)으로 바꾸는 것이 통제 경로다.
    const active080 = await client.query(
      `SELECT 1 FROM billing_080_numbers
        WHERE company_id = $1 AND is_active = TRUE
          AND (monthly_fee_supply > 0 OR kt_fee_supply > 0)
        LIMIT 1`,
      [company_id],
    );
    if (active080.rows.length > 0) {
      throw new BillingIssueError(422, {
        error: `${co.company_name}에 고정료가 설정된 활성 080 번호 매핑이 있습니다. 정액 발행은 080 고정료를 싣지 않아 그 달 이용료·부가서비스가 청구에서 빠집니다. 일반 발행으로 청구하거나, 080 청구를 중단하려면 매핑을 비활성으로 바꾼 뒤 발행해주세요.`,
        code: 'MIN_CHARGE_080_MAPPING_ACTIVE',
      });
    }
    const minChargeLabel = resolveBillingLabelMonth(null, billing_start, billing_end);
    const extras = await client.query(
      `SELECT e.id, e.kind, e.supply_amount, e.period_month, e.source_ref,
${EXTRA_ITEM_SOURCE_SELECT}
         FROM billing_extra_items e
${EXTRA_ITEM_SOURCE_JOIN}
        WHERE e.company_id = $1 AND e.billed_billing_id IS NULL
          AND e.period_month = $2::date
        FOR UPDATE OF e`,
      [company_id, `${minChargeLabel.year}-${String(minChargeLabel.month).padStart(2, '0')}-01`],
    );
    const minChargeBlocking = extraRowsBlockingIssue(extras.rows);
    if (minChargeBlocking.length > 0) {
      const shown = minChargeBlocking.slice(0, 5).map((b) => `${b.periodMonth.slice(0, 7)} ${b.sourceRef}`).join(', ');
      throw new BillingIssueError(422, {
        error: `${co.company_name}에 080 번호 매핑이 없는 반영분이 있어 발행을 중단했습니다 (${shown}). 매핑을 되살리거나 반영을 취소한 뒤 발행해주세요.`,
        code: 'BILLING_080_MAPPING_MISSING',
        numbers: minChargeBlocking,
      });
    }
    if (buildExtraBillingItems(extras.rows).length > 0) {
      throw new BillingIssueError(422, {
        error: `${co.company_name}에 이 기간 080·부가서비스 항목이 반영돼 있습니다. 정액 발행과 섞이면 이중청구가 되므로, 일반 발행으로 청구하거나 항목을 취소한 뒤 발행해주세요.`,
        code: 'MIN_CHARGE_EXTRA_EXISTS',
      });
    }
    // 남은 것은 청구액 0인 스냅샷뿐이다(전액 무료 번호·비활성 번호). 이 발행이 소비해 교착을 끊는다.
    const zeroExtraIds: string[] = extras.rows.map((r: any) => String(r.id));

    // 회사 행 잠금은 트랜잭션 초입으로 올라갔다(★2026-08-05 B-0805-1). 크레딧 승인·차감 경로와 줄을 세우는
    // Codex 2R 수용분은 그대로 성립한다 — KST 자정 경계의 미커밋 크레딧 트랜잭션은 그 잠금 뒤에 보인다.
    // ★ Codex 1R 수용 — 미청구 AI 크레딧(승인 충전·초과사용)이 있으면 정액 발행 거부(fail-closed).
    //   정액 청구서가 그 기간을 덮으면 겹침 차단 때문에 일반 발행이 막혀 크레딧이 영구 미청구가 된다.
    const unbilledCredit = await client.query(
      `SELECT 1 FROM ai_credit_requests
        WHERE company_id = $1::uuid AND status = 'approved' AND billed = false
          AND processed_at >= ($2 || ' 00:00:00+09')::timestamptz
          AND processed_at < (($3::date + INTERVAL '1 day')::date::text || ' 00:00:00+09')::timestamptz
        LIMIT 1`,
      [company_id, billing_start, billing_end],
    );
    const unbilledOverage = unbilledCredit.rows.length > 0 ? null : await client.query(
      `SELECT 1 FROM ai_credit_transactions
        WHERE company_id = $1::uuid AND type = 'deduct' AND overage_credits > 0
          AND billed_billing_id IS NULL
          AND created_at >= ($2 || ' 00:00:00+09')::timestamptz
          AND created_at < (($3::date + INTERVAL '1 day')::date::text || ' 00:00:00+09')::timestamptz
        LIMIT 1`,
      [company_id, billing_start, billing_end],
    );
    if (unbilledCredit.rows.length > 0 || (unbilledOverage && unbilledOverage.rows.length > 0)) {
      throw new BillingIssueError(422, {
        error: `${co.company_name}에 이 기간 미청구 AI 크레딧(충전·초과사용)이 있습니다. 정액으로 발행하면 크레딧이 영구 미청구가 되므로 일반 발행(일괄발급)으로 청구해주세요.`,
        code: 'MIN_CHARGE_CREDIT_EXISTS',
      });
    }

    // ★ Codex 1R 수용 — 실사용 공급가 판정을 **잠금 이후 단일 시점**으로. 일반 발행 코어와 같은
    //   차단 3종을 전부 본다: 회사 단가 미설정(findUnsetPricedTypes) · 에이전트 매핑 0(agentMappingMissing) ·
    //   단가 정의 없음/발송ID 단가 공백. 어느 하나라도 "5만 미만인지"를 계산할 수 없으면 발행하지 않는다 —
    //   0원으로 계산된 가짜 미달로 정액을 끊으면 겹침 차단 때문에 정정 경로가 없다.
    const { prices, unsetKeys: webUnsetPriceKeys } = resolveBillingUnitPricesDetailed(ledger.companyPriceRow);
    const allPrices: Record<string, number> = { ...prices, SPAM_SMS: prices.SMS, SPAM_LMS: prices.LMS };
    const usage = await buildBillingUsageRows({ companyId: company_id, startDate: billing_start, endDate: billing_end, ledger });
    if (usage.agentMappingMissing) {
      throw new BillingIssueError(422, {
        error: `${co.company_name}은(는) 에이전트 사용 회사인데 발송ID 매핑이 없어 사용량을 계산할 수 없습니다. 발송ID를 등록한 뒤 발행해주세요.`,
        code: 'MIN_CHARGE_AGENT_MAPPING_MISSING',
      });
    }
    const priced = priceBillingRows(
      usage.rows, allPrices, ledger.postpaidPriceRows,
      normalizeUnitPriceBasis(ledger.companyPriceRow?.unit_price_basis),
    );
    const webUnsetPriced = findUnsetPricedTypes(webUnsetPriceKeys, usage.rows);
    if (webUnsetPriced.length > 0 || priced.unbillableTypes.length > 0 || priced.missingAgentPrices.length > 0) {
      throw new BillingIssueError(422, {
        error: `${co.company_name}의 단가가 비어 있어 "사용량이 최소과금 미만인지"를 계산할 수 없습니다. 단가를 채운 뒤 발행해주세요.`,
        code: 'MIN_CHARGE_PRICE_UNSET',
      });
    }
    const usageSupply = priced.items.reduce((s, i) => s + (Number(i.amountExact) || 0), 0);
    if (usageSupply > minCharge) {
      throw new BillingIssueError(422, {
        error: `${co.company_name}의 이 기간 실사용 공급가가 ${Math.ceil(usageSupply).toLocaleString()}원으로 최소과금 ${minCharge.toLocaleString()}원을 넘습니다. 일반 발행(일괄발급)으로 청구해주세요.`,
        code: 'MIN_CHARGE_USAGE_EXCEEDS',
        usage_supply: usageSupply,
      });
    }

    // ★ Codex 2R 수용 — 원장 지문 재검증(일반 발행 코어와 같은 계약). ledger는 잠금 전에 읽었으므로
    //   집계 중 단가가 바뀌었으면 "이전 단가로는 미달"인 가짜 판정일 수 있다 — 변경 시 발행 거부.
    const fingerprintNow = await readBillingLedgerFingerprint(company_id, client);
    if (fingerprintNow !== ledger.fingerprint) {
      throw new BillingIssueError(422, {
        error: '발행 중에 단가 또는 선불 설정이 변경되어 중단했습니다. 방금 단가를 저장하셨다면 그대로 다시 발행해 주세요.',
        code: 'BILLING_LEDGER_CHANGED',
      });
    }
    // ★ Codex 1R high 수용 — 요금제 이력도 같은 자리에서 대조한다. 원장 지문은 이력을 감시하지 않아,
    //   소급(backdated) 변경이 집계가 도는 사이에 들어오면 "구독료 0"이라는 전제가 무너진 채 정액이 나간다.
    if (planChangesFingerprint(await loadPlanChanges(company_id, billing_end, client)) !== minChargePlanFingerprint) {
      throw new BillingIssueError(422, {
        error: '발행 중에 요금제 변경 이력이 바뀌어 중단했습니다. 방금 요금제를 변경하셨다면 그대로 다시 발행해 주세요.',
        code: 'PLAN_HISTORY_CHANGED',
      });
    }

    // 정산월 파생은 위 안전핀 3에서 이미 발행 코어와 같은 함수로 계산했다(minChargeLabel).
    const vat = vatOfSupply(minCharge);
    const billingResult = await client.query(
      `INSERT INTO billings (
        company_id, user_id, billing_year, billing_month, billing_start, billing_end,
        sms_success, lms_success, mms_success, kakao_success,
        sms_unit_price, lms_unit_price, mms_unit_price, kakao_unit_price,
        test_sms_count, test_lms_count, test_sms_unit_price, test_lms_unit_price,
        spam_filter_sms_count, spam_filter_lms_count, spam_filter_sms_unit_price, spam_filter_lms_unit_price,
        subtotal, vat, total_amount, ai_credit_count, ai_credit_supply, created_by, scope, batch_id
      ) VALUES ($1, NULL, $2, $3, $4, $5, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, $6, $7, $8, 0, 0, $9, 'combined', NULL)
      RETURNING *`,
      [
        company_id, minChargeLabel.year, minChargeLabel.month, billing_start, billing_end,
        minCharge, vat, minCharge + vat, input.adminId ?? null,
      ],
    );
    const billing = billingResult.rows[0];

    // 항목 1행 — 항목표(buildInvoiceLines)가 "기본요금 1건 × 금액"으로 인쇄하고, 항목합 = 공급가액이 정의상 성립.
    await client.query(
      `INSERT INTO billing_items (
        billing_id, company_id, user_id, agent_id, store_id, channel, item_date, message_type,
        total_count, success_count, fail_count, pending_count, unit_price, amount, plan_days, plan_month_days
      ) VALUES ($1, $2, NULL, NULL, NULL, 'extra', $3::date, 'EXTRA_BASE_FEE', 0,0,0,0, $4, $4, NULL, NULL)`,
      [billing.id, company_id, billing_start, minCharge],
    );

    // ★ 2026-08-04 청구액 0인 스냅샷(전액 무료·비활성 번호)을 이 청구서가 소비한다 — 같은 트랜잭션.
    //   안 하면 그 행이 다음 달에도 게이트에 걸려 이 회사는 영원히 정액 발행을 못 한다.
    //   FK `ON DELETE SET NULL`이라 이 청구서를 지우면 함께 미소비로 돌아온다.
    if (zeroExtraIds.length > 0) {
      await client.query(
        `UPDATE billing_extra_items SET billed_billing_id = $1::uuid
          WHERE id = ANY($2::uuid[]) AND billed_billing_id IS NULL`,
        [billing.id, zeroExtraIds],
      );
    }

    await client.query('COMMIT');
    return { billing, usage_supply: usageSupply, min_charge_supply: minCharge };
  } catch (txError: any) {
    try { await client.query('ROLLBACK'); } catch (rbError: any) {
      console.error('최소과금 발행 롤백 실패:', rbError?.message || rbError);
    }
    throw txError;
  } finally {
    client.release();
  }
}
