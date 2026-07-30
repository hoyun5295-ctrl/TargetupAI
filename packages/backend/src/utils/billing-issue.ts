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
  findUnsetPricedTypes, summarizeBlockList,
  resolveExistingUserIds, nullifyUnknownUserIds, checkBillingAmountIdentity, chunkArray,
  splitBillingSheets, checkSheetSumIdentity, buildPlanBillingItems, toDayKey,
  buildExtraBillingItems,
  type PricedBillingItem, type BillingScope,
} from './send-usage-aggregation';
// ★ 2026-07-30 절사 위치 정정 — 헤더·장 공급가액을 절사된 항목줄 합에서 파생(그룹핑·절사 단일원).
import { sumFlooredInvoiceLines } from './billing-invoice-lines';
import { loadBillingLedger, readBillingLedgerFingerprint } from './billing-ledger';
import { floorWon, vatOfSupply } from './money';
import { normalizeUnitPriceBasis } from './unit-price';
import {
  loadPlanChanges, buildPlanSegments, sumPlanSegments, evaluatePlanHistoryGate,
  countPlanChanges, planChangesFingerprint,
} from './plan-proration';

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

export interface IssueBillingInput {
  company_id: string;
  user_id?: string | null;
  billing_start: string;
  billing_end: string;
  /** 발행 단위. 미지정 시 user_id 유무로 유도(단 user_id+무scope는 422 — 옛 호출 차단 계약 유지) */
  scope?: string | null;
  /** 발행 실행자(billings.created_by) */
  adminId?: string | null;
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

  const startDate = new Date(billing_start);
  const billing_year = startDate.getFullYear();
  const billing_month = startDate.getMonth() + 1;

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
  const existCheck = await pool.query(
    `SELECT id, status, scope, user_id, billing_start, billing_end FROM billings
     WHERE company_id = $1
       AND billing_start <= $3::date AND billing_end >= $2::date`,
    [company_id, billing_start, billing_end]
  );
  if (existCheck.rows.length > 0) {
    const ex = existCheck.rows[0];
    throw new BillingIssueError(409, {
      error: `해당 기간과 겹치는 정산이 이미 존재합니다 (${String(ex.billing_start).slice(0, 10)} ~ ${String(ex.billing_end).slice(0, 10)})`,
      // ★ 2026-07-26 code 부여 — 차단 3종이 422로 빠지면서 409는 이 케이스 전용이 됐다.
      code: 'BILLING_PERIOD_OVERLAP',
      existing_id: ex.id,
      existing_status: ex.status,
      existing_scope: ex.scope,
      existing_user_id: ex.user_id,
    });
  }

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

  const priced = priceBillingRows(
    usage.rows, allPrices, ledger.postpaidPriceRows,
    normalizeUnitPriceBasis(ledger.companyPriceRow?.unit_price_basis),
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
        ? '요금제가 배정돼 있는데 요금제 변경 이력이 한 건도 없습니다. 이대로 발행하면 구독료가 0원으로 빠집니다 — 이력을 먼저 확인해 주세요.'
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
    // ★ 2026-07-26 잠금 축은 **회사 단위**다.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext('billing'))`, [String(company_id)]);

    // 잠금을 기다리는 동안 다른 요청이 먼저 만들었을 수 있다 — 잠금 획득 후 재검사.
    const dupInTx = await client.query(
      `SELECT id, status, scope, user_id, billing_start, billing_end FROM billings
       WHERE company_id = $1
         AND billing_start <= $3::date AND billing_end >= $2::date`,
      [company_id, billing_start, billing_end]
    );
    if (dupInTx.rows.length > 0) {
      const ex = dupInTx.rows[0];
      throw new BillingIssueError(409, {
        error: `해당 기간과 겹치는 정산이 이미 존재합니다 (${String(ex.billing_start).slice(0, 10)} ~ ${String(ex.billing_end).slice(0, 10)})`,
        code: 'BILLING_PERIOD_OVERLAP',
        existing_id: ex.id,
        existing_status: ex.status,
        existing_scope: ex.scope,
        existing_user_id: ex.user_id,
      });
    }

    // ★ 2026-07-29 수동 정산완료도 **같은 잠금 아래에서** 본다.
    //   사람이 따로 청구한 구간을 자동 청구서가 덮으면 이중청구다. 화면 목록은 "완전히 덮을 때만" 숨기지만
    //   발급 차단은 **조금이라도 겹치면** 막는다 — 숨김 기준과 차단 기준은 다르다(6월 수동완료 + 6/25~7/25 발행).
    //   판정을 이 트랜잭션 밖에 두면 검사와 커밋 사이가 항상 열린다. 그래서 여기에 둔다.
    const manualDone = await client.query(
      `SELECT period_start, period_end, reason FROM billing_manual_completions
        WHERE company_id = $1
          AND period_start <= $3::date AND period_end >= $2::date
        LIMIT 1`,
      [company_id, billing_start, billing_end]
    );
    if (manualDone.rows.length > 0) {
      const m = manualDone.rows[0];
      throw new BillingIssueError(409, {
        error: `해당 기간과 겹치는 구간이 수동 정산완료로 처리돼 있습니다 (${String(m.period_start).slice(0, 10)} ~ ${String(m.period_end).slice(0, 10)}${m.reason ? ` · ${String(m.reason).slice(0, 100)}` : ''}). 자동 발행하려면 일괄발급 화면에서 그 기록을 먼저 해제해 주세요.`,
        code: 'BILLING_MANUAL_COMPLETED',
      });
    }

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

    // ★ 2026-07-30 월별 추가 항목(080 이용료·부가서비스·통화료 — billing_extra_items, 서수란 접수).
    //   발행 기간과 겹치는 달의 **미소비** 항목만 싣는다 — 겹침 판정은 billings와 같은 식(월 = [1일, 말일]).
    //   소비 마커 = billed_billing_id(AI 크레딧 billed_billing_id 선례 미러 — Codex 1R critical 수용):
    //   분할 기간 발행(7/1~15 + 7/16~31)이 같은 달 항목을 두 번 싣는 이중청구를 마커가 구조로 막고,
    //   FK ON DELETE SET NULL이라 발행 삭제 시 자동으로 미소비 복귀한다. FOR UPDATE = 반영 취소(DELETE)와의 경합 차단.
    const extraRes = await client.query(
      `SELECT id, kind, supply_amount, period_month FROM billing_extra_items
        WHERE company_id = $1
          AND billed_billing_id IS NULL
          AND period_month <= $3::date
          AND (period_month + INTERVAL '1 month' - INTERVAL '1 day')::date >= $2::date
        ORDER BY period_month, kind
        FOR UPDATE`,
      [company_id, billing_start, billing_end],
    );
    const extraItems = buildExtraBillingItems(extraRes.rows);
    const extraIds: string[] = extraRes.rows.map((r: any) => String(r.id));
    const extraSupply = extraItems.reduce((s, i) => s + i.amountExact, 0);
    extraSupplyIssued = extraSupply;
    const allBillingItems = extraItems.length > 0 ? [...billingItems, ...extraItems] : billingItems;

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
    const COLS = 16;
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

      // ★ 2026-07-30 월별 추가 항목(080 등) 소비 마킹 — 크레딧과 같은 계약. 공통 장(carries)에 실리므로 그 장 id로.
      //   이 마커가 분할 기간 재발행의 이중청구를 막고, 발행 삭제 시 FK가 자동 복귀시킨다(Codex 1R critical 수용).
      if (carries && extraIds.length > 0) {
        await client.query(
          `UPDATE billing_extra_items SET billed_billing_id = $1::uuid WHERE id = ANY($2::uuid[])`,
          [sheetBilling.id, extraIds]
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
            plan_days, plan_month_days
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
