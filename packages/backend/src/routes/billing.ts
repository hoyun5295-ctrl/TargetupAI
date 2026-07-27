import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import nodemailer from 'nodemailer';
import { authenticate, requireSuperAdmin } from '../middlewares/auth';
import pool, { mysqlQuery } from '../config/database';
import { SUCCESS_CODES_SQL } from '../utils/sms-result-map';
import { INVITO_INFO } from '../config/defaults';
import { CREDIT_UNIT_PRICE } from '../utils/ai-credit-calc';
// ★ 2026-07-25 사용량 집계 CT — 청구서(이 파일)와 발송통계 엑셀이 같은 집계를 쓴다(정산 정합).
//   미리보기(/preview)도 여기를 거친다 — 미리보기와 발행 금액이 갈라지지 않게 하는 유일한 장치다.
import {
  buildCompanyUsageByDay, buildBillingTotals, selectBillingRunIds, resolveBillingUnitPrices,
  getTablesForBillingPeriod, getBillingCompanyTables, MSG_TYPE_TO_USAGE_KEY, logUnbillableUsageKeys,
} from '../utils/send-usage-aggregation';
// ★ 2026-07-26 정산 재구성 ② — 청구 상세를 채널 축(웹·에이전트·테스트·스팸)으로 저장한다.
//   그 전까지 청구 집계는 `sales.RSRM_SalesStts`를 전혀 읽지 않아 `usage_type='both'` 회사 17곳의
//   게이트웨이 발송분이 청구서에서 통째로 빠져 있었다.
import {
  buildBillingUsageRows, diffBillingRowsVsDayData, priceBillingRows,
  resolveBillingUnitPricesDetailed, findUnsetPricedTypes, summarizeBlockList,
  resolveExistingUserIds, nullifyUnknownUserIds, checkBillingAmountIdentity, chunkArray,
  splitBillingSheets, checkSheetSumIdentity, buildPlanBillingItems, toDayKey,
  type PricedBillingItem, type BillingScope,
} from '../utils/send-usage-aggregation';
import { loadBillingLedger, readBillingLedgerFingerprint } from '../utils/billing-ledger';
import { floorWon, vatOfSupply } from '../utils/money';
import { drawPartyBlock, drawThanksNote, THANKS_NOTE_HEIGHT } from '../utils/pdf-party-block';
import { normalizeUnitPriceBasis } from '../utils/unit-price';
import { buildInvoiceLines, checkInvoiceLinesAgainstHeader } from '../utils/billing-invoice-lines';
import {
  loadPlanChanges, buildPlanSegments, sumPlanSegments, evaluatePlanHistoryGate,
  countPlanChanges, planChangesFingerprint,
} from '../utils/plan-proration';
// ★ 2026-07-27 발송ID 표시명(발급명) 단일 소스 — 청구서 상세·미리보기도 화면과 같은 이름을 쓴다.
import { getAgentCustNameMap } from '../utils/pay-stats';

// SMTP transporter (재사용)
// ★ 2026-07-26 타임아웃 3종 명시 — 정산서 발송은 **행 잠금을 든 트랜잭션 안에서** SMTP를 부른다.
//   타임아웃이 없으면 메일 서버가 응답을 안 줄 때 그 트랜잭션이 커넥션과 잠금을 무한정 붙잡고,
//   그 회사의 삭제·상태변경이 함께 멈춘다. 값은 정산 발송(월 1회, 첨부 있음) 기준으로 넉넉히 잡았다.
const getTransporter = () => nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.hiworks.com',
  port: Number(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 40000,
});

async function smsAggByRunAndType(tables: string[], whereClause: string, params: any[]): Promise<any[]> {
  const allRows: any[] = [];
  for (const t of tables) {
    const rows = await mysqlQuery(
      `SELECT app_etc1 as run_id, msg_type,
              COUNT(*) as total_count,
              SUM(CASE WHEN status_code IN (${SUCCESS_CODES_SQL}) THEN 1 ELSE 0 END) as success_count
       FROM ${t} WHERE ${whereClause}
       GROUP BY app_etc1, msg_type`,
      params
    ) as any[];
    allRows.push(...rows);
  }
  return allRows;
}

// ※ 옛 `loadAgentUnitPriceRows`는 삭제했다(2026-07-26).
//   라우트 안에 정의한 인라인 헬퍼였고(`no_inline_duplication` 위반), 같은 원장을 집계 CT가 또 따로 읽어
//   두 조회 사이에 값이 바뀌면 조용히 어긋났다. 이제 `utils/billing-ledger.ts` 한 스냅샷을 쓴다.

const router = Router();

// ============================================================
//  정산(Billing) API — 슈퍼관리자 전용
//  마운트: /api/admin/billing
// ============================================================

// ★ 전체 라우트에 인증 + 슈퍼관리자 권한 적용
router.use(authenticate, requireSuperAdmin);

// ============================================================
//  정산(Billing) CRUD
// ============================================================

// POST /generate - 정산 데이터 생성 (월별 집계)
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const { company_id, user_id, billing_start, billing_end } = req.body;
    const adminId = (req as any).user?.userId;

    if (!company_id || !billing_start || !billing_end) {
      return res.status(400).json({ error: '필수: company_id, billing_start, billing_end' });
    }

    if (billing_start > billing_end) {
      return res.status(400).json({ error: '시작일이 종료일보다 늦을 수 없습니다' });
    }

    const startDate = new Date(billing_start);
    const billing_year = startDate.getFullYear();
    const billing_month = startDate.getMonth() + 1;

    // ★ 2026-07-26 발행 단위(scope). 지금은 `combined`(회사 1장)와 `by_user`(계정별)만 구현한다 —
    //   발송ID별(`by_agent`)은 Harold 결정으로 이월. 값만 나중에 추가하면 되도록 축은 지금 잡는다.
    const scope: string = String((req.body || {}).scope || (user_id ? 'by_user' : 'combined'));
    if (scope === 'by_agent') {
      return res.status(422).json({
        error: '발송ID별 발행은 아직 준비되지 않았습니다. 회사 합산으로 발행해 주세요.',
        code: 'BILLING_SCOPE_NOT_SUPPORTED',
      });
    }
    if (scope !== 'combined' && scope !== 'by_user') {
      return res.status(400).json({ error: `발행 단위 값이 올바르지 않습니다: ${scope}`, code: 'BILLING_SCOPE_INVALID' });
    }
    // ★ 2026-07-26 `user_id`의 의미가 바뀌었다. 그 전에는 "이 계정 발송분만 담은 한 장"이었고,
    //   그래서 테스트·스팸·에이전트·크레딧이 통째로 빠진 청구서가 나갔다(그 상태가 5개월 이상 유지됐다).
    //   이제 계정별 발행은 **회사 전체를 한 번에** 계정 장 N개 + 공통 장 1개로 낸다.
    //   옛 호출이 조용히 다른 동작을 하지 않도록, 단일 계정 지정은 받지 않고 새 흐름을 안내한다.
    if (user_id && !(req.body || {}).scope) {
      return res.status(422).json({
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
      return res.status(409).json({
        error: `해당 기간과 겹치는 정산이 이미 존재합니다 (${String(ex.billing_start).slice(0,10)} ~ ${String(ex.billing_end).slice(0,10)})`,
        // ★ 2026-07-26 code 부여 — 차단 3종이 422로 빠지면서 409는 이 케이스 전용이 됐다.
        //   가장 흔한 케이스만 무명으로 두면 화면이 필드 부재로 판별하게 되고, 그건 조용한 폴백을 부른다.
        code: 'BILLING_PERIOD_OVERLAP',
        existing_id: ex.id,
        existing_status: ex.status,
        // ★ 2026-07-26 기존 발행의 단위를 함께 알린다 — 회사 정산이 이미 있는데 계정별을 또 뽑으면
        //   그 계정 웹 발송분이 두 번 청구되고, 그 사실이 화면에 안 보이면 운영자가 그냥 다시 시도한다.
        existing_scope: ex.scope,
        existing_user_id: ex.user_id
      });
    }

    // 2) 고객사 단가 조회 (스냅샷)
    // ★ 2026-07-26 `created_at`을 함께 읽는다(SCHEMA.md 등재분·information_schema 실측 확인).
    //   요금제 이력 공백 검사의 기준일이다 — 기준선 141행이 `effective_date = created_at::date`로
    //   들어갔으므로, 회사가 생기기 전 날짜까지 이력을 요구하면 월 중간에 계약한 회사가 전부 막힌다.
    const companyResult = await pool.query(
      `SELECT company_name, billing_type, created_at,
              cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao,
              cost_per_test_sms, cost_per_test_lms
       FROM companies WHERE id = $1`,
      [company_id]
    );
    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: '고객사를 찾을 수 없습니다' });
    }
    const co = companyResult.rows[0];

    // ★ 2026-07-26 단가·선불여부를 **한 스냅샷으로 한 번만** 읽는다.
    //   그 전에는 회사 단가·후불 집합·발송ID 단가를 서로 다른 시점에 세 번 읽어,
    //   그 사이 값이 바뀌면 사용량은 빠졌는데 단가는 있는 식으로 조용히 어긋났다.
    //   금액에 쓰는 값과 지문에 들어가는 값이 **같은 읽기**여야 재검증이 의미를 갖는다.
    //   ★ 선불 판정보다 **먼저** 읽는다 — 판정 근거와 지문이 같은 스냅샷이라야
    //     "검사 후 선불로 바뀜"이 재검증에 걸린다(Codex 3차 CRITICAL).
    const ledger = await loadBillingLedger(company_id);

    // ★ 2026-07-25 선불 회사 이중 청구 차단.
    //   선불은 발송하는 순간 잔액에서 빠진다(prepaid.ts prepaidDeduct — 후불이면 그냥 통과한다).
    //   이미 받은 돈을 월 정산서로 또 청구하면 그대로 이중 청구다.
    //   화면은 선불·후불을 한 목록에 섞어 보여주고 회사를 하나씩 골라 뽑는 방식이라 오선택이 실제로 가능하다.
    // ★ 2026-07-26 판정 근거를 **원장 스냅샷**으로 옮겼다(Codex 3차 CRITICAL 수용).
    //   첫 회사 조회값으로 판정하면, 그 뒤 원장을 읽기 전에 선불로 바뀐 경우
    //   원장은 선불을 스냅샷하고 트랜잭션 재검증도 선불끼리 비교해 **그대로 통과한다.**
    //   금액·포함 여부를 정하는 값은 전부 지문에 들어간 그 스냅샷 하나로만 판정해야 한다.
    if (String(ledger.companyPriceRow?.billing_type) === 'prepaid') {
      return res.status(400).json({
        error: `${co.company_name || '해당 고객사'}는 선불 고객사입니다. 발송 시점에 잔액에서 이미 차감되었으므로 월 정산서를 발행하면 이중 청구가 됩니다.`,
        code: 'PREPAID_COMPANY_NOT_BILLABLE',
        billing_type: co.billing_type,
      });
    }

    // ★ 2026-07-25 단가 해석을 CT로 — 0원 설정이 `|| 일반단가` 폴백에 먹히던 결함 정정.
    // ★ 2026-07-26 미설정(NULL) 유형키도 함께 받는다 — `?? 0`으로 0원 청구되던 경로를 아래에서 막는다.
    const { prices, unsetKeys: webUnsetPriceKeys } = resolveBillingUnitPricesDetailed(ledger.companyPriceRow);

    // 3~6) 사용량 집계 — ★ 2026-07-25 컨트롤타워로 이동(utils/send-usage-aggregation.ts).
    //   발송통계 엑셀이 청구서와 **같은 함수**를 호출하게 하려고 뺐다. 로직을 복사하면 언젠가 갈라져
    //   "엑셀 유형 ≠ 청구 유형"이 되고 그러면 정산 대조가 성립하지 않는다.
    // ★ 2026-07-26 집계는 항상 **회사 전체**다. 계정별 발행은 이 결과를 장으로 쪼개서 내지,
    //   집계 단계에서 거르지 않는다 — 거르면 그 계정 장에 회사 단위 항목이 통째로 빠진다.
    // ★ 2026-07-26 단계별 소요 계측 — 느린 지점을 추측이 아니라 로그로 본다.
    //   금강제화 발행이 2분대였는데 인덱스는 이미 있었다(실측). 다음 개선은 이 로그 위에서 판단한다.
    const tStart = Date.now();
    const dayData = await buildCompanyUsageByDay({
      companyId: company_id,
      startDate: billing_start,
      endDate: billing_end,
    });
    const tDayData = Date.now();

    // 7) 합산 — ★ 2026-07-25 미리보기와 같은 함수로(금액 불일치 차단)
    const totals = buildBillingTotals(dayData);
    // 청구가 못 읽는 유형키가 섞여 있으면 그 유형은 조용히 0원이 된다 — 발행 시점에 로그로 드러낸다.
    logUnbillableUsageKeys(dayData, `정산생성 company=${company_id} ${billing_start}~${billing_end}`);
    const totalSms = totals.SMS, totalLms = totals.LMS, totalMms = totals.MMS, totalKakao = totals.KAKAO;
    const totalTestSms = totals.TEST_SMS, totalTestLms = totals.TEST_LMS;
    const totalSpamSms = totals.SPAM_SMS, totalSpamLms = totals.SPAM_LMS;

    // 스팸필터 단가 = 일반 단가와 동일 (D16 결정)
    const spamSmsCost = prices.SMS;
    const spamLmsCost = prices.LMS;
    const allPrices: Record<string, number> = { ...prices, SPAM_SMS: spamSmsCost, SPAM_LMS: spamLmsCost };

    // ★ 2026-07-26 청구 상세 — 채널 × 일자 × (계정 | 발송ID) × 유형.
    //   여기서 처음으로 에이전트(게이트웨이) 발송분이 청구에 들어온다.
    const usage = await buildBillingUsageRows({
      companyId: company_id,
      startDate: billing_start,
      endDate: billing_end,
      ledger,
    });
    console.log(`[정산][소요] company=${company_id} ${billing_start}~${billing_end} — 일자축 집계 ${tDayData - tStart}ms · 상세축 집계 ${Date.now() - tDayData}ms`);

    // 새 상세와 기존 집계가 갈라지면 화면·엑셀 숫자와 청구서 금액이 어긋난다.
    // 0725에 맞춰놓은 축을 이번 재구성이 조용히 되돌리는 것을 여기서 막는다.
    const axisDiffs = diffBillingRowsVsDayData(usage.rows, dayData);
    if (axisDiffs.length > 0) {
      console.log(`[정산][축불일치] company=${company_id} ${billing_start}~${billing_end} — ${axisDiffs.map((d) => `${d.typeKey}: 상세 ${d.rowsSuccess} vs 집계 ${d.dayDataSuccess}`).join(', ')}`);
      // ★ 2026-07-26 409 → 422. 관리자 화면이 **409만** "해당 월 정산이 이미 존재합니다. 삭제 후 재생성해주세요"로
      //   덮어쓰기 때문에(AdminDashboard handleBillingGenerate), 차단 사유가 그 문구에 전부 가려졌다.
      //   그 안내대로 삭제하면 `ai_credit_requests.billed`가 얽혀 돈이 새는 경로로 들어간다.
      //   409는 "기간 중복" 하나에만 남기고 차단은 422로 낸다 — 화면 수정 없이 서버 문구가 그대로 표시된다.
      return res.status(422).json({
        error: '청구 상세와 사용량 집계의 수량이 일치하지 않아 발행을 중단했습니다. 두 경로가 갈라진 상태로 발행하면 화면·엑셀과 청구서 금액이 어긋납니다.',
        code: 'BILLING_AXIS_MISMATCH',
        mismatches: axisDiffs,
      });
    }

    const priced = priceBillingRows(
      usage.rows, allPrices, ledger.postpaidPriceRows,
      normalizeUnitPriceBasis(ledger.companyPriceRow?.unit_price_basis),
    );

    // ★ 2026-07-26 회사 단가 미설정 — 그 전에는 `?? 0`으로 조용히 0원 청구됐다(MMS 308,043건과 같은 계열).
    //   성공 수량이 있는 유형만 막는다. 수량 0인 유형까지 막으면 발행이 이유 없이 멈춘다.
    const webUnsetPriced = findUnsetPricedTypes(webUnsetPriceKeys, usage.rows);
    if (webUnsetPriced.length > 0) {
      return res.status(422).json({
        error: `고객사 단가가 설정되지 않은 발송 유형이 있어 발행을 중단했습니다. 고객사 관리에서 단가를 채운 뒤 다시 발행해 주세요: ${summarizeBlockList(webUnsetPriced.map((u) => `${u.key}(성공 ${u.success.toLocaleString()})`))}`,
        code: 'WEB_UNIT_PRICE_UNSET',
        unset_price_types: webUnsetPriced,
      });
    }

    // 단가를 못 정하는 유형이 남아 있으면 그 유형은 0원으로 청구된다 — 발행 전에 막는다.
    if (priced.unbillableTypes.length > 0) {
      return res.status(422).json({
        error: `청구 단가가 정의되지 않은 발송 유형이 있어 발행을 중단했습니다: ${summarizeBlockList(priced.unbillableTypes.map((u) => `${u.key}(성공 ${u.success.toLocaleString()})`))}. 그대로 발행하면 이 유형이 0원으로 청구됩니다.`,
        code: 'UNBILLABLE_TYPE_KEY',
        unbillable_types: priced.unbillableTypes,
      });
    }
    if (priced.missingAgentPrices.length > 0) {
      return res.status(422).json({
        error: `에이전트 발송ID 단가가 설정되지 않아 발행을 중단했습니다. 발송ID별 단가를 채운 뒤 다시 발행해 주세요: ${summarizeBlockList(priced.missingAgentPrices.map((m) => `${m.agentSendId} ${m.typeKey}(성공 ${m.success.toLocaleString()})`))}`,
        code: 'AGENT_UNIT_PRICE_MISSING',
        missing_agent_prices: priced.missingAgentPrices,
      });
    }

    // ★ 2026-07-26 계정 실재 확인. 퇴사자 계정을 지우면(하드 삭제) 그 사람 발송분의 uuid가 남아 있어
    //   `billing_items.user_id` FK 위반으로 **그 회사 청구서를 통째로 못 뽑는다.**
    //   차단하지 않고 계정만 미상으로 내린다 — 수량·금액은 그대로 청구된다.
    const existingUserIds = await resolveExistingUserIds(
      company_id,
      priced.items.map((i) => i.userId).filter(Boolean) as string[],
    );
    const { items: sendingItems, unknownUserIds } = nullifyUnknownUserIds(priced.items, existingUserIds);
    if (unknownUserIds.length > 0) {
      console.log(`[정산][계정미상] company=${company_id} 삭제되었거나 이 회사 소속이 아닌 계정 ${unknownUserIds.length}건 — 해당 행은 계정 미상으로 청구한다: ${summarizeBlockList(unknownUserIds)}`);
    }

    // ★ 2026-07-26 ④ 요금제(구독) 이용요금 — Harold 정의 청구서 항목 1번.
    //   그 전에는 이 항목 자체가 청구서에 없었다(5항목 중 1번이 통째로 빠져 있었다).
    //   `company_plan_changes`를 읽어 구간별 일할로 낸다. **기간 이전 이력까지** 읽어야 시작 시점 플랜을 안다.
    //   요금제 행은 수량 축이 없고 금액이 이미 정해져 있어 단가 계산기(`priceBillingRows`)를 거치지 않는다.
    const planChanges = await loadPlanChanges(company_id, billing_end);
    const planSegments = buildPlanSegments(planChanges, billing_start, billing_end);
    const planItems = buildPlanBillingItems(planSegments);
    const planAmount = sumPlanSegments(planSegments);
    // 이 기간에 걸리는 이력의 지문 — 발행 트랜잭션 안에서 다시 만들어 대조한다(그 사이 변경 차단).
    const planFingerprint = planChangesFingerprint(planChanges);
    // 전 기간 이력 건수 — "기간 안 0건"과 "아예 0건"을 가른다(전자는 최초 배정 전이라 정상).
    const planHistoryTotal = await countPlanChanges(company_id);
    if (planChanges.length === 0) {
      console.log(`[정산][요금제이력없음] company=${company_id} — 이 기간에 걸리는 요금제 이력이 없다(전 기간 이력 ${planHistoryTotal}건). 요금제 이용요금을 청구하지 않는다.`);
    }

    // ★ 2026-07-26 에이전트 매핑 0 차단(Codex 2차 수용). 로그만 남기면 게이트웨이 발송분이
    //   통째로 빠진 청구서가 조용히 나가고, 금액 검사 3중이 전부 0을 기준으로 통과한다.
    if (usage.agentMappingMissing) {
      return res.status(422).json({
        error: '이 고객사는 에이전트를 사용하는 것으로 설정돼 있는데 발송ID 매핑이 하나도 없습니다. 이대로 발행하면 게이트웨이 발송분이 통째로 빠집니다. 발송ID를 등록하거나, 실제로 안 쓴다면 사용 구분을 웹으로 바꿔 주세요.',
        code: 'AGENT_MAPPING_MISSING',
        usage_type: ledger.usageType,
      });
    }

    // ★ 2026-07-26 요금제 이력이 **끊겨 있으면** 막는다 — 그 구간 구독료가 0원으로 조용히 빠지고
    //   합계 검사 3중은 빠진 값을 기준으로 전부 통과하기 때문이다.
    //   판정 축은 "공백의 종류"다(Codex 6차 수용). 첫 이력 이전 공백은 요금제가 없던 사실이므로
    //   막지 않고 로그로만 드러낸다 — 기간 중 최초 배정·플랜 미지정 회사가 정상 발행돼야 한다.
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
      return res.status(422).json({
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
    // 헤더 공급가액 교차검증(A-8)은 **절사 전** 값으로 한다 — 절사 후끼리 비교하면 헤더를 상세에서
    // 파생시킨 셈이라 "두 코드가 갈라졌는가"를 못 본다.
    const agentAmountExact = priced.amountExactByChannel.agent;
    // 실제 청구된 요금제 금액 — 구간별 절사 후 합. 응답·화면에는 이 값이 나간다.
    const planAmountBilled = planItems.reduce((s, i) => s + (Number(i.amount) || 0), 0);
    if (usage.excludedPrepaidSendIds.length > 0) {
      console.log(`[정산] company=${company_id} 선불 발송ID ${usage.excludedPrepaidSendIds.join(',')} 청구 제외(게이트웨이 잔액에서 이미 차감)`);
    }

    // ★ 2026-07-25 7~9) 정산 쓰기를 단일 트랜잭션으로 묶는다.
    //   기존에는 billings INSERT → ai_credit_requests.billed=true → billing_items INSERT가 각각 따로 커밋됐다.
    //   중간에 실패하면 헤더만 남고 위 기간 중복검사(1번)가 재발행을 막는다.
    //   더 나쁜 쪽은 회복 경로다 — 화면 안내대로 "삭제 후 재생성"을 하면 billed=true는 되돌아오지 않아
    //   그 후불 크레딧 충전분이 영구 미청구가 된다(billed_invoice_id는 FK가 아니라 삭제에 반응하지 않는다).
    //   무거운 사용량 집계(MySQL 멀티테이블)는 트랜잭션 밖에 두고, 쓰기와 그 근거가 되는 PG 조회만 안에 넣는다.
    //   ※ config/database.ts의 `query`는 pool.query라 BEGIN/COMMIT이 서로 다른 커넥션에 나뉜다 — 반드시 client 고정.
    const client = await pool.connect();
    let billing: any;
    let itemsCount = 0;
    let aiCreditCount = 0, aiCreditSupply = 0;
    let subtotal = 0, vat = 0, totalAmount = 0;
    let sheetsIssued: any[] = [];
    let batchIdIssued: string | null = null;
    try {
      await client.query('BEGIN');

      // 같은 회사 정산을 동시에 생성하면 위 1번 중복검사를 양쪽 다 통과할 수 있다 — 직렬화한다.
      // ★ 2026-07-26 잠금 축을 **회사 단위로** 되돌렸다. 사용자를 두 번째 축에 넣으면
      //   회사 정산과 계정별 정산이 서로 다른 잠금을 잡아 동시에 통과한다 — 중복검사와 같은 구멍이다.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext('billing'))`, [String(company_id)]);

      // 잠금을 기다리는 동안 다른 요청이 먼저 만들었을 수 있다 — 잠금 획득 후 재검사.
      const dupInTx = await client.query(
        `SELECT id, status, scope, user_id, billing_start, billing_end FROM billings
         WHERE company_id = $1
           AND billing_start <= $3::date AND billing_end >= $2::date`,
        [company_id, billing_start, billing_end]
      );
      if (dupInTx.rows.length > 0) {
        await client.query('ROLLBACK');
        const ex = dupInTx.rows[0];
        return res.status(409).json({
          error: `해당 기간과 겹치는 정산이 이미 존재합니다 (${String(ex.billing_start).slice(0,10)} ~ ${String(ex.billing_end).slice(0,10)})`,
          // ★ 2026-07-26 잠금 후 재검사 경로에도 같은 계약을 준다. 여기만 code가 없으면
          //   동시 발행에서 진 쪽이 "알 수 없는 오류"로 떨어져 원인을 못 밝힌다.
          code: 'BILLING_PERIOD_OVERLAP',
          existing_id: ex.id,
          existing_status: ex.status,
          existing_scope: ex.scope,
          existing_user_id: ex.user_id
        });
      }

      // ★ 2026-07-26 원장 재검증. 집계와 금액 계산은 무거워서 트랜잭션 밖에서 돌았다.
      //   그 사이 단가나 선불여부가 바뀌었으면 지금 계산한 금액은 이미 낡은 값이다.
      //   지금은 283개 발송ID 단가를 직원들이 채워 넣는 중이라 발행과 저장이 겹칠 확률이 구조적으로 높다.
      //   잠금 대신 지문 대조를 쓰는 이유는, 원장이 화면에서 수시로 갱신되는 축이라
      //   잠금을 걸면 발행이 그 화면을 붙잡기 때문이다.
      //   문구에 "방금 저장했다면 다시"를 명시한다 — 없으면 사람이 자기가 한 일과 충돌한 걸 버그로 오인한다.
      const fingerprintNow = await readBillingLedgerFingerprint(company_id, client);
      if (fingerprintNow !== ledger.fingerprint) {
        await client.query('ROLLBACK');
        return res.status(422).json({
          error: '발행 중에 단가 또는 선불 설정이 변경되어 중단했습니다. 방금 단가를 저장하셨다면 그대로 다시 발행해 주세요.',
          code: 'BILLING_LEDGER_CHANGED',
        });
      }

      // ★ 2026-07-26 요금제 이력 재검증(Codex 7차 ②-2 수용). 구간·금액은 트랜잭션 밖에서 계산됐고,
      //   그 사이 `recordPlanChange`가 **이 기간에 걸리는** 변경을 넣으면(호출부가 `effectiveDate`를
      //   과거로 줄 수 있다) 우리가 든 구간은 낡은 값이 된다. 원장 지문은 그걸 못 잡는다 —
      //   `plan_id`를 지문에 넣었다가 무관한 다음 달 변경까지 막아서 되돌렸기 때문이다(6차 ②).
      //   기간에 걸리는 이력만으로 대조하면 이 청구서 금액을 바꾸는 변경만 정확히 걸린다.
      const planFingerprintNow = planChangesFingerprint(await loadPlanChanges(company_id, billing_end, client));
      if (planFingerprintNow !== planFingerprint) {
        await client.query('ROLLBACK');
        return res.status(422).json({
          error: '발행 중에 요금제 변경 이력이 바뀌어 중단했습니다. 방금 요금제를 변경하셨다면 그대로 다시 발행해 주세요.',
          code: 'BILLING_PLAN_HISTORY_CHANGED',
        });
      }

      // ★ D229+ 후불 AI 크레딧 충전 합산 — 이 기간 승인·미청구분(supply=공급가 VAT 별도)을 정산서에 합산.
      //   선불 충전은 status='completed'(즉시 결제)라 미포함 — 후불(status='approved')만 월말 청구 대상.
      //   FOR UPDATE = 합산에 넣은 행과 아래 billed 처리 대상 행이 같음을 보장(그 사이 상태 변경 차단).
      //
      // ★ 2026-07-25 사용자 지정 정산에서는 크레딧을 청구하지 않는다.
      //   발송 사용량은 `created_by`로 그 사용자 것만 거르는데 크레딧 조회는 `company_id`만 봤다.
      //   축이 어긋나 한 사용자의 청구서에 회사 전체 크레딧이 붙었고, 더 나쁜 건 그 행에 billed=true가 찍혀
      //   정작 회사 정산에서는 그만큼 빠져 버린 점이다(한 번 찍히면 되돌아오지 않는다).
      //   크레딧 충전은 회사 단위 행위라 사용자별로 나눌 근거 자체가 없다 — 회사 정산에서만 청구한다.
      // ★ 2026-07-26 크레딧은 **항상** 청구한다. 그 전에는 사용자 지정이면 통째로 빼서,
      //   계정별 정산만 뽑는 회사는 크레딧이 영영 청구되지 않았다.
      //   이제 발행이 회사 전체 단위라 크레딧은 공통 장(회사 단위 항목을 싣는 장)에 들어간다.
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
      // ★ #3 후불 overage(기본 크레딧 초과해 한도 음수로 쓴 분)도 같은 기간 합산 — 솔루션 이용요금 통합(단가 동일 2,000원)
      //   이중 방지: 위 기간 겹침 중복 차단(409)으로 월 1회만 생성 → created_at 기간 집계가 다음 달과 안 겹침.
      let overageCount = 0;
      let overageTxIds: string[] = [];
      {
        // ★ 2026-07-26 청구 완료 마커(`billed_billing_id`)를 붙였다(Codex 3차 HIGH 수용).
        //   그 전에는 기간으로만 합산해서, 기간 경계를 UTC→KST로 옮긴 이번 변경 때문에
        //   옛 경계로 발행된 청구서와 **KST 00~09시 9시간 구간이 두 번 청구**될 수 있었다
        //   (기간 중복검사는 날짜만 보므로 6/1~6/30과 7/1~7/31은 겹치지 않는다고 판단한다).
        //   충전분(`ai_credit_requests.billed`)에는 이미 있던 안전장치가 초과사용분에만 없었다.
        //   FOR UPDATE = 합산에 넣은 행과 아래에서 마커를 찍는 행이 같음을 보장한다.
        const overageRes = await client.query(
          `SELECT id, overage_credits FROM ai_credit_transactions
            WHERE company_id = $1::uuid AND type = 'deduct' AND overage_credits > 0
              AND billed_billing_id IS NULL
              -- ★ 2026-07-26 KST 경계. PG 세션 TZ가 Etc/UTC라 date 캐스트로 쓰면 경계가 KST 09:00이 된다.
              -- 발송 집계는 KST 자정으로 고쳤는데 크레딧만 UTC로 남아 있어 청구 월이 또 어긋났다.
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

      // ★ 2026-07-26 에이전트 금액 합산. 헤더(`billings`)에는 에이전트 수량 컬럼이 없지만 컬럼을 늘리지 않는다 —
      //   항목별 수량·금액의 진실은 `billing_items`이고 청구서 1페이지는 거기서 채널별로 집계한다.
      //   헤더는 합계(subtotal·vat·total_amount)만 정확히 담는다.
      // ★ 2026-07-26 금액 항등식 — 헤더는 `totals × 단가`로, 상세는 `priceBillingRows`로
      //   **서로 다른 코드가 계산한다.** 축이 어긋나면 청구서 항목 합계와 공급가액이 안 맞는다.
      //   AI 크레딧은 발송이 아니라 `billing_items` 행이 없으므로 따로 더한다.
      //   대조는 **절사 전** 값끼리 한다 — 절사는 그 뒤 한 번만 적용하므로 탐지력이 줄지 않는다.
      const subtotalExact =
        (totalSms * prices.SMS) + (totalLms * prices.LMS) +
        (totalMms * prices.MMS) + (totalKakao * prices.KAKAO) +
        (totalTestSms * prices.TEST_SMS) + (totalTestLms * prices.TEST_LMS) +
        (totalSpamSms * spamSmsCost) + (totalSpamLms * spamLmsCost) +
        agentAmountExact +
        planAmount +
        aiCreditSupply;
      const amountCheck = checkBillingAmountIdentity(
        billingItems.map((i) => ({ amount: i.amountExact })), aiCreditSupply, subtotalExact,
      );
      if (!amountCheck.ok) {
        await client.query('ROLLBACK');
        console.log(`[정산][금액불일치] company=${company_id} ${billing_start}~${billing_end} — 상세합 ${amountCheck.itemsSum} + 크레딧 ${amountCheck.aiCreditSupply} ≠ 공급가액 ${amountCheck.subtotal} (차이 ${amountCheck.diff})`);
        return res.status(422).json({
          error: '청구 상세 금액의 합이 공급가액과 일치하지 않아 발행을 중단했습니다. 그대로 발행하면 청구서 항목을 더한 값과 합계가 어긋납니다.',
          code: 'BILLING_AMOUNT_MISMATCH',
          amount_check: amountCheck,
        });
      }

      // ★ 2026-07-26 저장 금액은 **원 미만 절사 후 정수 덧셈**이다(Harold 지시).
      //   상세 행(`billing_items.amount`)이 이미 절사돼 있으므로 공급가액은 그 정수들의 합이고,
      //   장 소계·부가세·합계까지 전부 정수가 된다 — 청구서 1페이지 항목표와 2페이지 일자별 상세를
      //   각각 세로로 더한 값이 둘 다 공급가액과 정확히 맞는다.
      subtotal = billingItems.reduce((s, i) => s + (Number(i.amount) || 0), 0) + aiCreditSupply;
      vat = vatOfSupply(subtotal);
      totalAmount = subtotal + vat;

      // 8~9) 장별 발행 — 한 요청이 N+1장을 **원자적으로** 만든다.
      //   장 단위로 반복 발행하면 "N장 중 3장까지 만들고 4장째에서 단가 미설정으로 막힌 상태"가 허용된다.
      //   그러면 그 회사는 부분 청구로 남고, 나머지를 뽑으려면 앞 장들과의 겹침을 매번 검사해야 하며,
      //   고객은 받은 것이 전부인지 알 수 없다. 한 트랜잭션에서 전부 만들거나 전부 안 만든다.
      const sheets = splitBillingSheets(billingItems, scope as BillingScope);

      // 장으로 쪼갠 합이 회사 합산과 같은지 — 분산 발행이 회사 총액을 다 담았는지 보는 유일한 장치다.
      // 안분이 없으므로 정수 덧셈이고, 오차 허용 없이 같아야 한다.
      const sheetSum = checkSheetSumIdentity(sheets, aiCreditSupply, subtotal);
      if (!sheetSum.ok) {
        await client.query('ROLLBACK');
        console.log(`[정산][장합불일치] company=${company_id} ${billing_start}~${billing_end} — 장합 ${sheetSum.itemsSum} + 크레딧 ${sheetSum.aiCreditSupply} ≠ 공급가액 ${sheetSum.subtotal} (차이 ${sheetSum.diff})`);
        return res.status(422).json({
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

      for (const sheet of sheets) {
        const carries = sheet.carriesCompanyItems;
        // 청구할 내용이 없는 장은 만들지 않는다 — 0원 청구서가 나가는 것을 막는다.
        // ★ 2026-07-26 조건을 "항목 0건"에서 **"청구 내용 0"**으로 넓혔다(Harold 지시).
        //   요금제 기준선 141행이 들어가면서 모든 회사에 요금제 행이 최소 1건 생기는데,
        //   FREE(0원) 구간 행도 항목이라서 발송 0건인 무료 회사가 전부 0원 청구서 발행 대상이 됐다.
        //   금액이 있거나(유료 요금제 포함), 성공 수량이 있거나(명시 0원 단가 사용량은 문서화 대상),
        //   크레딧을 싣는 장만 발행한다.
        const hasBillableContent =
          sheet.amount > 0 || sheet.items.some((i) => (Number(i.success) || 0) > 0);
        if (!hasBillableContent && !(carries && (aiCreditSupply > 0 || aiCreditCount > 0))) continue;

        const sheetSubtotal = sheet.amount + (carries ? aiCreditSupply : 0);
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
        //   크레딧을 실은 장에만 건다. 여러 장에 걸면 그 충전분이 어느 청구서 것인지가 갈린다.
        if (carries && creditChargeRes.rows.length > 0) {
          await client.query(
            `UPDATE ai_credit_requests SET billed = true, billed_invoice_id = $1::uuid WHERE id = ANY($2::uuid[])`,
            [sheetBilling.id, creditChargeRes.rows.map((r: any) => r.id)]
          );
        }

        // ★ 2026-07-26 초과사용 크레딧에도 같은 마커. 이 청구서가 지워지면
        //   FK(`ON DELETE SET NULL`)가 자동으로 되돌려 다시 청구 대상이 된다 —
        //   충전분처럼 "삭제해도 마커가 남아 영구 미청구"가 되는 구조를 애초에 만들지 않는다.
        if (carries && overageTxIds.length > 0) {
          await client.query(
            `UPDATE ai_credit_transactions SET billed_billing_id = $1::uuid WHERE id = ANY($2::uuid[])`,
            [sheetBilling.id, overageTxIds]
          );
        }

        // billing_items INSERT (채널 × 일자 × 계정|발송ID × 유형 상세)
        //   ★ `user_id`는 헤더값 복사가 아니라 **행별 실제 계정**이고, 에이전트 행은 `agent_id`가 발송ID를 가리킨다.
        //   `store_id`(대상ID)는 청구 축이 아니다 — 계정마다 의미가 갈리고 카디널리티를 통제할 수 없다
        //   (제이씨패밀리 7월 29,598개). 지점별 확인은 발송통계 엑셀이 담당한다.
        const itemValues: any[][] = sheet.items.map((it: PricedBillingItem) => ([
          sheetBilling.id, company_id,
          it.channel === 'agent' ? null : it.userId,
          it.agentId,
          null,                 // store_id — 청구 축 아님
          it.channel,
          it.itemDate, it.typeKey,
          it.total, it.success, it.fail, it.pending,
          it.unitPrice, it.amount,
          // ★ 2026-07-26 요금제 일수는 전용 컬럼으로. 발송 행은 null이다 —
          //   발송 수량 컬럼에 일수를 실으면 PDF '전송'·'실패' 열과 화면 합계가 오염된다.
          it.planDays, it.planMonthDays,
        ]));

        // ★ 청크 INSERT. 14컬럼이라 4,681행이면 PG 바인드 파라미터 상한(65,535)을 넘어 **발행 자체가 실패**한다.
        //   1,000행이면 배치당 14,000개라 상한의 1/4 수준이다. 전 배치가 같은 트랜잭션 안이라 원자성은 유지된다.
        //   검증은 `count(*)`가 아니라 **`rowCount` 합**으로 한다 — 같은 트랜잭션 안 count는 자기 INSERT를
        //   전부 보고 PG는 부분 INSERT가 없어서, 그 대조는 항상 통과하는 장식이 된다.
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
        await client.query('ROLLBACK');
        return res.status(422).json({
          error: '이 기간에 청구할 발송·크레딧이 없어 발행할 내용이 없습니다.',
          code: 'BILLING_NOTHING_TO_ISSUE',
        });
      }
      sheetsIssued = issuedSheets;
      batchIdIssued = batchId;

      await client.query('COMMIT');
    } catch (txError: any) {
      try { await client.query('ROLLBACK'); } catch (rbError: any) {
        console.error('정산 생성 롤백 실패:', rbError?.message || rbError);
      }
      throw txError;
    } finally {
      client.release();
    }

    return res.json({
      billing,
      items_count: itemsCount,
      summary: { totalSms, totalLms, totalMms, totalKakao, totalTestSms, totalTestLms, totalSpamSms, totalSpamLms, subtotal, vat, totalAmount },
      // ★ 2026-07-26 발행 단위 결과 — 계정별이면 계정 장 N개 + 공통 장 1개가 한 묶음으로 나온다.
      scope,
      batch_id: batchIdIssued,
      sheet_count: sheetsIssued.length,
      sheets: sheetsIssued.map((b: any) => ({
        id: b.id, scope: b.scope, user_id: b.user_id,
        subtotal: b.subtotal, total_amount: b.total_amount,
      })),
      // ★ 2026-07-26 채널별 소계 — 청구서 1페이지 항목이 이 값이다(헤더 컬럼이 아니라 billing_items가 진실).
      //   요금제는 단가 계산기를 안 거치므로 여기서 합쳐 넣는다.
      //   전부 **절사 후 청구된 값**이다 — 응답에 절사 전 값을 섞으면 화면 합계가 청구서와 갈라진다.
      channel_amounts: { ...priced.amountByChannel, plan: planAmountBilled },
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
    });
  } catch (error: any) {
    const emsg = error?.message || '';
    if (emsg.includes('column') && emsg.includes('does not exist')) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — billing_items.channel·store_id·plan_days·plan_month_days, billings.scope·batch_id, ai_credit_transactions.overage_credits·billed_billing_id 컬럼 ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('정산 생성 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /list - 정산 목록
router.get('/list', async (req: Request, res: Response) => {
  try {
    const { company_id, year, status } = req.query;
    let sql = `SELECT b.*, c.company_name, u.name as user_name
               FROM billings b
               JOIN companies c ON c.id = b.company_id
               LEFT JOIN users u ON u.id = b.user_id
               WHERE 1=1`;
    const params: any[] = [];

    if (company_id) { params.push(company_id); sql += ` AND b.company_id = $${params.length}`; }
    if (year) { params.push(year); sql += ` AND b.billing_year = $${params.length}`; }
    if (status) { params.push(status); sql += ` AND b.status = $${params.length}`; }
    sql += ' ORDER BY b.billing_year DESC, b.billing_month DESC, b.created_at DESC';

    const result = await pool.query(sql, params);
    return res.json(result.rows);
  } catch (error: any) {
    console.error('정산 목록 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /company-users/:companyId - 고객사 사용자 목록
router.get('/company-users/:companyId', async (req: Request, res: Response) => {
  try {
    // ★ D131 후속: billing 고객사 사용자 목록에서 system 가상 계정 제외
    const result = await pool.query(
      `SELECT id, name, login_id, department, role
       FROM users WHERE company_id = $1 AND is_active = true AND COALESCE(is_system, false) = false
       ORDER BY name`,
      [req.params.companyId]
    );
    return res.json(result.rows);
  } catch (error: any) {
    console.error('사용자 목록 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /agent-price-gaps - 단가가 비어 있는 에이전트 발송ID 목록
//   ★ 2026-07-26 신설. 발송ID 단가가 비면 그 회사 발행이 422로 막히는데, 어디가 빈지 알 방법이
//   "회사를 하나씩 발행해 본다"뿐이었다. 실측(2026-07-26) 283개 발송ID 단가가 전부 미설정이라
//   마감일에 그걸 하나씩 찾아다니게 된다.
//   선불 발송ID는 청구 대상이 아니므로 제외한다.
router.get('/agent-price-gaps', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT c.id AS company_id, c.company_name, c.usage_type,
              cai.agent_send_id,
              cai.cost_per_sms IS NULL AS sms_unset,
              cai.cost_per_lms IS NULL AS lms_unset,
              cai.cost_per_mms IS NULL AS mms_unset,
              cai.cost_per_kakao IS NULL AS kakao_unset
         FROM company_agent_ids cai
         JOIN companies c ON c.id = cai.company_id
        WHERE cai.billing_type = 'postpaid'
          AND (cai.cost_per_sms IS NULL OR cai.cost_per_lms IS NULL
               OR cai.cost_per_mms IS NULL OR cai.cost_per_kakao IS NULL)
        ORDER BY c.company_name, cai.agent_send_id`,
    );

    const byCompany = new Map<string, any>();
    for (const r of result.rows as any[]) {
      const key = String(r.company_id);
      if (!byCompany.has(key)) {
        byCompany.set(key, {
          company_id: key, company_name: r.company_name, usage_type: r.usage_type, send_ids: [],
        });
      }
      byCompany.get(key).send_ids.push({
        agent_send_id: r.agent_send_id,
        unset: [
          r.sms_unset ? 'SMS' : '', r.lms_unset ? 'LMS' : '',
          r.mms_unset ? 'MMS' : '', r.kakao_unset ? 'KAKAO' : '',
        ].filter(Boolean),
      });
    }
    const companies = Array.from(byCompany.values());
    return res.json({
      companies,
      company_count: companies.length,
      send_id_count: result.rows.length,
    });
  } catch (error: any) {
    const emsg = error?.message || '';
    if (emsg.includes('column') && emsg.includes('does not exist')) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — company_agent_ids.billing_type·cost_per_* 컬럼 ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('에이전트 단가 공백 조회 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================
//  정산 파라미터 라우트 (/:id — 리터럴 라우트 뒤에 배치)
// ============================================================

// GET /:id/items - 정산 일자별 상세
router.get('/:id/items', async (req: Request, res: Response) => {
  try {
    const billing = await pool.query(
      `SELECT b.*, c.company_name, u.name as user_name
       FROM billings b
       JOIN companies c ON c.id = b.company_id
       LEFT JOIN users u ON u.id = b.user_id
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (billing.rows.length === 0) {
      return res.status(404).json({ error: '정산을 찾을 수 없습니다' });
    }

    const items = await pool.query(
      // ★ 2026-07-26 정렬에 channel·발송ID 추가. 축이 계정·발송ID로 쪼개지면서 같은 날 같은 유형 행이
      //   여러 줄 생기는데 tie-breaker가 없어 순서가 비결정적이었다(D150-4와 같은 계열).
      // ★ 2026-07-26 발송ID 병기 — 에이전트 행이 어느 발송ID 것인지가 정산 대조의 근거다.
      //   JOIN 대상(`company_agent_ids.id`)·FK(`billing_items_agent_id_fkey`)는 pg_constraint 실측 확인분.
      `SELECT bi.*, cai.agent_send_id
         FROM billing_items bi
         LEFT JOIN company_agent_ids cai ON cai.id = bi.agent_id
        WHERE bi.billing_id = $1
        ORDER BY bi.channel ASC, bi.item_date ASC, bi.message_type ASC,
                 cai.agent_send_id ASC NULLS FIRST, bi.user_id ASC NULLS FIRST, bi.id ASC`,
      [req.params.id]
    );

    // ★ 2026-07-26 항목 줄을 서버가 함께 내린다. 화면이 따로 합산하면 그 값이 청구서와 갈릴 수 있고,
    //   "화면 금액 ≠ 청구서 금액"은 정산에서 가장 나쁜 부류다. PDF·이메일과 같은 함수를 쓴다.
    const lines = buildInvoiceLines(items.rows);
    const headerCheck = checkInvoiceLinesAgainstHeader(
      lines, Number(billing.rows[0]?.ai_credit_supply) || 0, Number(billing.rows[0]?.subtotal) || 0,
    );

    // ★ 2026-07-26 날짜를 문자열로 내린다(Codex 3차 MEDIUM 수용).
    //   PG `date`는 드라이버가 **로컬 자정 Date**로 주고, JSON 직렬화는 그걸 UTC ISO로 바꾼다.
    //   그래서 화면(`String(item.item_date).slice(5,10)`)에 하루 앞선 날짜가 찍혔다 —
    //   집계·PDF는 `toDayKey`로 고쳤는데 이 응답만 원본 Date를 그대로 흘려보내고 있었다.
    //   같은 이유로 헤더의 청구 기간도 함께 내린다(모달·엑셀 파일명이 이 값을 쓴다).
    const bil = billing.rows[0];
    // ★ 2026-07-27 발급명 병기 — 상세 모달의 '구분' 칸이 발송ID만 보여주면 어느 계정인지 사람이 못 읽는다.
    //   이름 소스는 게이트웨이 원장 하나(RSRM_SalesMst.CustNm). 조회 실패해도 발송ID는 그대로 나온다.
    const custNameMap = await getAgentCustNameMap();
    return res.json({
      billing: {
        ...bil,
        billing_start: toDayKey(bil.billing_start),
        billing_end: toDayKey(bil.billing_end),
      },
      items: items.rows.map((r: any) => ({
        ...r,
        item_date: toDayKey(r.item_date),
        cust_name: r.agent_send_id ? custNameMap.get(String(r.agent_send_id)) || null : null,
      })),
      lines,
      header_check: headerCheck,
    });
  } catch (error: any) {
    console.error('정산 상세 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// PUT /:id/status - 정산 상태 변경
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    if (!['draft', 'confirmed', 'paid'].includes(status)) {
      return res.status(400).json({ error: '유효한 상태: draft, confirmed, paid' });
    }
    const result = await pool.query(
      `UPDATE billings SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '정산을 찾을 수 없습니다' });
    }
    return res.json(result.rows[0]);
  } catch (error: any) {
    console.error('정산 상태 변경 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// DELETE /:id - 정산 삭제
router.delete('/:id', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    // ★ 2026-07-25 삭제와 후불 크레딧 billed 되돌림을 한 트랜잭션으로.
    //   billed_invoice_id는 FK가 아니라 정산이 지워져도 billed=true가 그대로 남는다.
    //   화면은 기간 겹침 409에서 "삭제 후 재생성"을 안내하는데, 그대로 두면 재생성 시
    //   `billed = false` 필터에 걸려 그 충전분이 영구히 청구되지 않는다(정상 운영 동작에서 돈이 샌다).
    await client.query('BEGIN');

    // 1) 대상 식별 — **여기서는 잠그지 않는다.**
    //   ★ 2026-07-26 개별 행을 먼저 잠그고 그 다음 묶음 전체를 잠그면, 같은 묶음의 서로 다른 장을
    //   동시에 지울 때 A가 1번 장을, B가 2번 장을 쥔 채 서로의 행을 기다려 데드락이 된다(Codex 3차 MEDIUM).
    //   묶음 축(회사·기간·batch_id)만 읽고, 잠금은 아래에서 **한 문장·id 순서로 한 번만** 잡는다.
    const check = await client.query(
      `SELECT id, status, emailed_at, email_sent_at, batch_id, company_id, billing_start, billing_end
         FROM billings WHERE id = $1::uuid`,
      [req.params.id],
    );
    if (check.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '정산을 찾을 수 없습니다' });
    }

    const target = check.rows[0];

    // 2) 삭제 대상 묶음을 **한 문장으로, id 순서로** 잠근다.
    //   ★ 2026-07-26 CRITICAL 정정 — 그 전에는 `batch_id`만으로 형제를 찾았다.
    //   `batch_id`는 발행이 만드는 UUID라 지금 다른 회사와 충돌할 일은 없지만,
    //   **다른 회사의 청구서를 지울 수 있는 SQL이 돈 경로에 남아 있는 것 자체**가 결함이다.
    //   회사·기간을 함께 걸면 그 구조가 사라진다(묶음은 정의상 한 회사·한 기간이다).
    //   ★ 정렬 고정 = 데드락 회피. PG는 Sort 위에서 LockRows를 돌려 정렬된 순서로 잠근다.
    const batchSql = `SELECT id, status, emailed_at, email_sent_at FROM billings
                       WHERE batch_id = $1::uuid AND company_id = $2::uuid
                         AND billing_start = $3::date AND billing_end = $4::date
                       ORDER BY id FOR UPDATE`;
    const singleSql = `SELECT id, status, emailed_at, email_sent_at FROM billings
                        WHERE id = $1::uuid ORDER BY id FOR UPDATE`;
    // 날짜는 `toDayKey`로 내린다 — Date를 그대로 넘기면 드라이버가 오프셋 포함 문자열로 보내고
    // 세션 TZ(Etc/UTC)의 `::date` 캐스트가 하루 앞으로 밀어 형제 조회가 0행이 된다.
    const targetsRes = await client.query(
      target.batch_id ? batchSql : singleSql,
      target.batch_id
        ? [target.batch_id, target.company_id, toDayKey(target.billing_start), toDayKey(target.billing_end)]
        : [req.params.id],
    );
    if (targetsRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '정산을 찾을 수 없습니다' });
    }

    // 3) 상태 판정은 **잠근 뒤** 그 행들로만 한다.
    //   ★ 2026-07-26 HIGH 정정 — 그 전에는 형제 상태 집계가 잠금 전에 돌아서,
    //   집계와 잠금 사이에 형제가 confirmed로 바뀌거나 메일이 나가면 그걸 못 보고 그냥 지웠다.
    const locked = targetsRes.rows as any[];
    // 잠금을 기다리는 동안 대상 자체가 지워졌으면 그대로 끝낸다 — 형제만 남은 상태로 지우면 안 된다.
    if (!locked.some((r) => String(r.id) === String(req.params.id))) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '정산을 찾을 수 없습니다' });
    }
    const isIssued = locked.some((r) => String(r.status) !== 'draft');
    const isEmailed = locked.some((r) => r.emailed_at || r.email_sent_at);
    const issuedStatuses = Array.from(new Set(locked.map((r) => String(r.status)))).join(',');

    // ★ 2026-07-26 상태 가드. 그 전에는 확정(confirmed)·수금(paid)된 청구서도, 이미 고객에게
    //   메일로 나간 청구서도 아무 확인 없이 지워졌다. 화면이 기간 중복 시 "삭제 후 재생성"을
    //   안내하고 있어서 그 경로가 실제로 눌린다.
    //
    //   완전히 거부하지는 않는다 — 틀린 금액이 이미 나갔으면 **반드시 지우고 다시 보내야** 하고,
    //   삭제가 막히면 `ai_credit_requests.billed` 되돌림 경로까지 함께 막혀 크레딧이 영구 미청구가 된다.
    //   대신 사유를 받아 기록으로 남긴다.
    const deleteReason = String((req.body || {}).reason || '').trim();
    if ((isIssued || isEmailed) && !deleteReason) {
      await client.query('ROLLBACK');
      const why = [
        isIssued ? `상태가 ${issuedStatuses}` : '',
        isEmailed ? '고객에게 메일 발송됨' : '',
      ].filter(Boolean).join(' / ');
      return res.status(422).json({
        error: `이미 발행이 끝난 정산입니다 (${why}). 삭제하려면 사유를 입력해 주세요. 잘못된 금액이 나갔다면 삭제 후 재발행이 맞습니다.`,
        code: 'BILLING_DELETE_NEEDS_REASON',
        status: target.status,
        emailed: isEmailed,
      });
    }
    if (deleteReason) {
      console.log(`[정산삭제][사유] billing=${req.params.id} status=${target.status} emailed=${isEmailed} reason=${deleteReason.slice(0, 200)}`);
    }

    // 4) 묶음 단위 삭제(Codex 2차 수용). 계정별 발행은 계정 장 N + 공통 장 1이 한 묶음인데,
    //   개별 삭제를 허용하면 공통 장만 지워지고 계정 장은 남는다. 그 상태에서 회사+기간 중복검사가
    //   재발행을 막으므로 **부분 청구가 영구화**된다. 원자적으로 만들었으면 원자적으로 지워야 한다.
    const targetIds = locked.map((r) => String(r.id));

    const restored = await client.query(
      `UPDATE ai_credit_requests
          SET billed = false, billed_invoice_id = NULL
        WHERE billed_invoice_id = ANY($1::uuid[])
        RETURNING id`,
      [targetIds]
    );

    // ★ 2026-07-26 초과사용 크레딧 마커 되돌림. FK가 `ON DELETE SET NULL`이라 아래 DELETE만으로도
    //   풀리지만, 몇 건이 다시 청구 대상이 됐는지 로그로 남기려면 명시 UPDATE가 필요하다.
    const restoredOverage = await client.query(
      `UPDATE ai_credit_transactions SET billed_billing_id = NULL
        WHERE billed_billing_id = ANY($1::uuid[])
        RETURNING id`,
      [targetIds]
    );

    // billing_items는 ON DELETE CASCADE로 자동 삭제 (billing_items_billing_id_fkey confdeltype='c' 실측)
    await client.query('DELETE FROM billings WHERE id = ANY($1::uuid[])', [targetIds]);

    await client.query('COMMIT');
    if (restored.rowCount) {
      console.log(`[정산삭제] billing=${req.params.id} 후불 크레딧 충전 ${restored.rowCount}건 미청구 상태로 복구`);
    }
    if (restoredOverage.rowCount) {
      console.log(`[정산삭제] billing=${req.params.id} 초과사용 크레딧 ${restoredOverage.rowCount}건 미청구 상태로 복구`);
    }
    return res.json({
      success: true,
      restored_credit_requests: restored.rowCount || 0,
      restored_overage_transactions: restoredOverage.rowCount || 0,
      deleted_ids: targetIds,
      batch_id: target.batch_id || null,
    });
  } catch (error: any) {
    try { await client.query('ROLLBACK'); } catch (rbError: any) {
      console.error('정산 삭제 롤백 실패:', rbError?.message || rbError);
    }
    const emsg = error?.message || '';
    if (emsg.includes('column') && emsg.includes('does not exist')) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — billings.batch_id·ai_credit_transactions.billed_billing_id 컬럼 ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('정산 삭제 오류:', error);
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// ============================================================
//  정산 PDF 생성
//  TODO: PDF 렌더링 로직을 services/pdfService.ts로 분리
// ============================================================

// GET /:id/pdf - 정산 PDF (2페이지: 요약 + 일자별 상세)
router.get('/:id/pdf', async (req: Request, res: Response) => {
  try {
    // 1) 정산 + 회사 정보
    const result = await pool.query(
      `SELECT b.*, c.company_name, c.business_number, c.ceo_name, c.address,
              c.contact_name, c.contact_phone, c.contact_email,
              c.business_type, c.business_category,
              u.name as user_name
       FROM billings b
       JOIN companies c ON c.id = b.company_id
       LEFT JOIN users u ON u.id = b.user_id
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '정산을 찾을 수 없습니다' });
    }
    const bil = result.rows[0];

    // 2) 일자별 상세
    const itemsResult = await pool.query(
      // ★ 2026-07-26 정렬에 channel·발송ID 추가. 축이 계정·발송ID로 쪼개지면서 같은 날 같은 유형 행이
      //   여러 줄 생기는데 tie-breaker가 없어 순서가 비결정적이었다(D150-4와 같은 계열).
      // ★ 2026-07-26 발송ID 병기 — 에이전트 행이 어느 발송ID 것인지가 정산 대조의 근거다.
      //   JOIN 대상(`company_agent_ids.id`)·FK(`billing_items_agent_id_fkey`)는 pg_constraint 실측 확인분.
      `SELECT bi.*, cai.agent_send_id
         FROM billing_items bi
         LEFT JOIN company_agent_ids cai ON cai.id = bi.agent_id
        WHERE bi.billing_id = $1
        ORDER BY bi.channel ASC, bi.item_date ASC, bi.message_type ASC,
                 cai.agent_send_id ASC NULLS FIRST, bi.user_id ASC NULLS FIRST, bi.id ASC`,
      [req.params.id]
    );
    const items = itemsResult.rows;

    // ★ 2026-07-26 렌더 전 정합 검사. PDF는 고객에게 나가고 이메일은 회수가 안 된다.
    //   항목 줄 합 + AI 크레딧이 헤더 공급가액과 다르면 그 청구서는 세로 합이 안 맞는 문서다.
    const headerCheck = checkInvoiceLinesAgainstHeader(
      buildInvoiceLines(items), Number(bil.ai_credit_supply) || 0, Number(bil.subtotal) || 0,
    );
    if (!headerCheck.ok) {
      console.log(`[정산][PDF정합실패] billing=${req.params.id} — 항목합 ${headerCheck.linesSum} + 크레딧 ${headerCheck.aiCreditSupply} ≠ 공급가액 ${headerCheck.subtotal} (차이 ${headerCheck.diff})`);
      return res.status(422).json({
        error: '청구서 항목 합계가 공급가액과 일치하지 않아 PDF 생성을 중단했습니다. 이대로 내보내면 고객이 항목을 더한 값과 합계가 어긋납니다.',
        code: 'BILLING_ITEM_HEADER_MISMATCH',
        check: headerCheck,
      });
    }

    // 3) PDF 생성
    const PDFDocument = require('pdfkit');
    const fs = require('fs');
    const path = require('path');

    const fontPath = path.join(__dirname, '../../fonts/malgun.ttf');
    const fontBoldPath = path.join(__dirname, '../../fonts/malgunbd.ttf');
    const hasFont = fs.existsSync(fontPath);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    const pdfDir = path.join(__dirname, '../../pdfs');
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
    const pdfFilename = `billing_${bil.id.slice(0, 8)}_${bil.billing_year}_${String(bil.billing_month).padStart(2, '0')}.pdf`;
    const pdfPath = path.join(pdfDir, pdfFilename);
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    const setFont = (bold = false) => { if (hasFont) doc.font(bold ? fontBoldPath : fontPath); };
    const primary = '#4338ca';
    const dark = '#1f2937';
    const gray = '#6b7280';
    const n = (v: any) => Number(v) || 0;

    // ============================
    // PAGE 1 — 요약
    // ============================
    setFont(true);
    doc.fontSize(22).fillColor(primary).text('정산서', 50, 50);
    setFont(false);
    doc.fontSize(9).fillColor(gray).text('BILLING STATEMENT', 50, 78);

    const rightX = 350;
    setFont(false);
    doc.fontSize(9).fillColor(gray);
    doc.text('정산번호:', rightX, 50, { continued: true });
    setFont(true);
    doc.fillColor(dark).text(`  BIL-${bil.id.slice(0, 8).toUpperCase()}`);
    setFont(false);
    doc.fontSize(9).fillColor(gray);
    doc.text('발행일:', rightX, 65, { continued: true });
    doc.fillColor(dark).text(`  ${toDayKey(new Date())}`);
    // ★ 2026-07-26 `toISOString()` 폐기. PG `date`는 로컬 자정 Date로 오므로 ISO로 바꾸면 하루 밀린다.
    //   집계(`toDayKey`)만 고치고 렌더를 안 고치면 청구서에 찍히는 날짜가 그대로 밀린 채 나간다.
    const fmtDate = (d: any) => toDayKey(d);
    doc.text('정산기간:', rightX, 80, { continued: true });
    doc.fillColor(dark).text(`  ${fmtDate(bil.billing_start)} ~ ${fmtDate(bil.billing_end)}`);

    if (bil.user_name) {
      setFont(false);
      doc.fontSize(9).fillColor(gray);
      doc.text('사용자:', rightX, 98, { continued: true });
      doc.fillColor(dark).text(`  ${bil.user_name}`);
    }

    doc.moveTo(50, bil.user_name ? 118 : 115).lineTo(545, bil.user_name ? 118 : 115).strokeColor('#e5e7eb').stroke();

    // 공급자 / 공급받는자
    // ★ 2026-07-26 고정 y 증가(+14) 폐기. 대표자가 두 명인 회사(각자대표)는 대표 줄이 칸 폭을 넘어
    //   두 줄로 흐르는데 다음 줄을 14pt만 내려서 사업자번호 줄과 겹쳐 인쇄됐다(Harold 실측).
    //   블록이 실제로 끝난 y를 받아 구분선·항목표 시작을 거기서 잡는다 — 고정 좌표를 남기면 재발한다.
    const partyTop = 130;
    const leftBottom = drawPartyBlock(doc, {
      x: 50, y: partyTop, width: rightX - 50 - 20, title: '공급자', primary, dark, setFont,
      lines: [
        { label: '상호', value: INVITO_INFO.companyName },
        { label: '대표', value: INVITO_INFO.ceoName },
        { label: '사업자번호', value: INVITO_INFO.bizNumber },
        { label: '업태/종목', value: INVITO_INFO.bizType },
        { label: '주소', value: INVITO_INFO.address },
        { label: '연락처', value: `${INVITO_INFO.phone} / ${INVITO_INFO.email}` },
      ],
    });
    const rightBottom = drawPartyBlock(doc, {
      x: rightX, y: partyTop, width: 545 - rightX, title: '공급받는자', primary, dark, setFont,
      lines: [
        { label: '상호', value: bil.company_name || '-' },
        { label: '대표', value: bil.ceo_name || '-' },
        { label: '사업자번호', value: bil.business_number || '-' },
        { label: '업태/종목', value: `${bil.business_type || '-'} / ${bil.business_category || '-'}` },
        { label: '주소', value: bil.address || '-' },
        { label: '연락처', value: `${bil.contact_phone || '-'} / ${bil.contact_email || '-'}` },
      ],
    });

    const partyBottom = Math.max(leftBottom, rightBottom);
    doc.moveTo(50, partyBottom + 4).lineTo(545, partyBottom + 4).strokeColor('#e5e7eb').stroke();

    // 내역 테이블
    // ★ 2026-07-26 항목표에 **페이지 넘김**을 넣는다. 그 전에는 줄 수와 무관하게 y만 늘려서,
    //   항목이 많은 회사(웹+에이전트 병용·발송ID 여러 개)는 합계·감사 인사·하단 안내를 뚫고 인쇄됐다.
    //   웹만 쓰는 회사는 11줄이라 안 터지고, 에이전트가 섞이는 순간 터지는 구조였다.
    const ITEM_ROW_H = 22;
    const ITEM_TABLE_BOTTOM = 620;   // 이 아래로는 새 줄을 그리지 않는다(합계 블록·감사 인사 자리 확보)
    let y = partyBottom + 19;

    const drawItemHeader = () => {
      doc.rect(50, y, 495, 25).fill(primary);
      setFont(true);
      doc.fontSize(9).fillColor('white');
      doc.text('항목', 60, y + 7);
      doc.text('수량', 250, y + 7, { width: 80, align: 'right' });
      doc.text('단가', 340, y + 7, { width: 80, align: 'right' });
      doc.text('금액', 430, y + 7, { width: 105, align: 'right' });
      y += 25;
    };
    drawItemHeader();

    // ★ 2026-07-26 `quantityText`가 있으면 수량 칸을 그 문구로 쓴다 — 요금제는 `9일 / 31일`이다.
    //   없으면 `0건 × ₩350,000 = ₩101,613`이라는 거짓 산식이 인쇄된다.
    const drawRow = (label: string, count: number, price: number, amount: number, bg = 'white', quantityText?: string) => {
      if (count <= 0 && !quantityText) return;
      if (y + ITEM_ROW_H > ITEM_TABLE_BOTTOM) {
        doc.addPage();
        y = 50;
        setFont(true);
        doc.fontSize(10).fillColor(primary).text('청구 내역 (계속)', 50, y);
        y += 25;
        drawItemHeader();
      }
      if (bg !== 'white') doc.rect(50, y, 495, ITEM_ROW_H).fill(bg);
      setFont(false);
      doc.fontSize(9).fillColor(dark);
      doc.text(label, 60, y + 6, { width: 185, lineBreak: false });
      doc.text(quantityText || count.toLocaleString(), 250, y + 6, { width: 80, align: 'right', lineBreak: false });
      doc.text(`₩${price.toLocaleString()}`, 340, y + 6, { width: 80, align: 'right', lineBreak: false });
      setFont(true);
      doc.text(`₩${amount.toLocaleString()}`, 430, y + 6, { width: 105, align: 'right', lineBreak: false });
      y += ITEM_ROW_H;
      doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke();
    };

    // ★ 2026-07-26 항목표를 헤더 컬럼이 아니라 `billing_items`에서 만든다.
    //   헤더에는 에이전트 칸이 없는데 공급가액에는 에이전트 금액이 더해져,
    //   **고객이 항목을 세로로 더하면 공급가액과 안 맞는** 상태였다(1페이지↔2페이지 합계도 갈렸다).
    const invoiceLines = buildInvoiceLines(items);
    const CHANNEL_BG: Record<string, string> = { web: 'white', agent: '#eff6ff', test: '#fefce8', spam: '#fef3c7' };
    invoiceLines.forEach((line) => {
      drawRow(line.label, line.count, line.unitPrice, line.amount, CHANNEL_BG[line.channel] || 'white', line.quantityText);
    });
    drawRow('AI 크레딧', n(bil.ai_credit_count), n(bil.ai_credit_count) > 0 ? Math.round(n(bil.ai_credit_supply) / n(bil.ai_credit_count)) : 0, n(bil.ai_credit_supply), '#f5f3ff');

    // 합계
    y += 15;
    const summaryX = 340;
    setFont(false);
    doc.fontSize(9).fillColor(gray);
    doc.text('공급가액:', summaryX, y, { width: 80, align: 'right' });
    setFont(true);
    doc.fillColor(dark).text(`₩${n(bil.subtotal).toLocaleString()}`, 430, y, { width: 105, align: 'right' });
    y += 18;
    setFont(false);
    doc.fillColor(gray);
    doc.text('부가세 (10%):', summaryX, y, { width: 80, align: 'right' });
    setFont(true);
    doc.fillColor(dark).text(`₩${n(bil.vat).toLocaleString()}`, 430, y, { width: 105, align: 'right' });
    y += 22;

    doc.rect(summaryX - 10, y - 2, 225, 28).fill('#eef2ff');
    setFont(true);
    doc.fontSize(11).fillColor(primary);
    doc.text('합계:', summaryX, y + 5, { width: 80, align: 'right' });
    doc.fontSize(13).text(`₩${n(bil.total_amount).toLocaleString()}`, 430, y + 3, { width: 105, align: 'right' });

    // 합계 박스가 끝난 지점 — 감사 인사 위치를 여기서부터 잡는다(고정 y를 쓰면 항목 많은 회사에서 겹친다).
    let contentBottom = y + 28;
    if (bil.notes) {
      y += 50;
      setFont(true);
      doc.fontSize(9).fillColor(gray).text('비고:', 50, y);
      setFont(false);
      doc.fillColor(dark).text(bil.notes, 50, y + 15, { width: 495 });
      contentBottom = y + 15 + Math.ceil(doc.heightOfString(String(bil.notes), { width: 495 }));
    }

    // ★ 2026-07-26 감사 인사(Harold 지시). 청구서는 매달 고객에게 나가는 유일한 정기 문서다.
    //   합계·비고 아래, 자동생성 안내(y=770) 위에 둔다. 728 = 770 − 블록 높이 34 − 여백 8.
    // ★ 2026-07-26 자리가 없으면 **그리지 않는다**(Codex #11). 고정 728로 밀어 넣으면
    //   항목·비고가 길 때 기존 내용 위에 겹쳐 인쇄된다 — 없는 것보다 나쁘다.
    const thanksY = Math.max(contentBottom + 16, 690);
    if (thanksY + THANKS_NOTE_HEIGHT <= 762) {
      drawThanksNote(doc, {
        x: 50, y: thanksY, width: 495, primary, gray, setFont,
        message: `${bil.billing_month}월도 한줄로를 이용해 주셔서 감사합니다.`,
      });
    }


    // ============================
    // PAGE 2+ — 일자별 상세
    // ============================
    if (items.length > 0) {
      doc.addPage();

      setFont(true);
      doc.fontSize(14).fillColor(primary).text('일자별 상세 내역', 50, 50);
      setFont(false);
      doc.fontSize(9).fillColor(gray).text(
        `${bil.company_name} | ${bil.billing_year}년 ${bil.billing_month}월${bil.user_name ? ' | ' + bil.user_name : ''}`,
        50, 72
      );

      doc.moveTo(50, 90).lineTo(545, 90).strokeColor('#e5e7eb').stroke();

      // 테이블 헤더
      // ★ 2026-07-26 '구분' 열 추가. 축이 채널·계정·발송ID로 쪼개지면서 같은 날 같은 유형 행이
      //   여러 줄 생기는데, 구분이 없으면 고객 눈에 중복 오류로 보인다.
      //   에이전트 행은 발송ID를 그대로 적는다 — 고객이 게이트웨이 쪽 통계와 대조하는 근거다.
      const cols = [
        { label: '일자', x: 50, w: 55, align: 'left' as const },
        { label: '구분', x: 105, w: 70, align: 'left' as const },
        { label: '유형', x: 175, w: 55, align: 'left' as const },
        { label: '전송', x: 230, w: 48, align: 'right' as const },
        { label: '성공', x: 278, w: 48, align: 'right' as const },
        { label: '실패', x: 326, w: 45, align: 'right' as const },
        { label: '대기', x: 371, w: 45, align: 'right' as const },
        { label: '단가', x: 416, w: 55, align: 'right' as const },
        { label: '금액', x: 471, w: 74, align: 'right' as const },
      ];

      let iy = 95;
      const rowH = 18;
      const pageBottom = 760;

      const drawDetailHeader = () => {
        doc.rect(50, iy, 495, 22).fill('#f3f4f6');
        setFont(true);
        doc.fontSize(8).fillColor(gray);
        cols.forEach(c => doc.text(c.label, c.x + 4, iy + 6, { width: c.w - 8, align: c.align }));
        iy += 22;
      };

      drawDetailHeader();

      const typeLabel: Record<string, string> = {
        SMS: 'SMS', LMS: 'LMS', MMS: 'MMS', KAKAO: '카카오',
        TEST_SMS: '테스트SMS', TEST_LMS: '테스트LMS',
        SPAM_SMS: '스팸SMS', SPAM_LMS: '스팸LMS'
      };

      let detailSubtotal = 0;
      items.forEach((item: any, idx: number) => {
        // 페이지 넘김 체크
        if (iy + rowH > pageBottom) {
          setFont(false);
          doc.fontSize(8).fillColor(gray).text('(다음 페이지에 계속)', 50, iy + 5, { align: 'center', width: 495 });
          doc.addPage();
          iy = 50;
          setFont(true);
          doc.fontSize(10).fillColor(primary).text('일자별 상세 내역 (계속)', 50, iy);
          iy += 25;
          drawDetailHeader();
        }

        // ★ 2026-07-26 판정을 유형키 접두가 아니라 `channel`로. 접두 판정은 새 유형이 생기면 조용히 어긋난다.
        const ch = String(item.channel || 'web');
        if (ch === 'plan') doc.rect(50, iy, 495, rowH).fill('#f5f3ff');
        else if (ch === 'spam') doc.rect(50, iy, 495, rowH).fill('#fef3c7');
        else if (ch === 'test') doc.rect(50, iy, 495, rowH).fill('#fefce8');
        else if (ch === 'agent') doc.rect(50, iy, 495, rowH).fill('#eff6ff');
        else if (idx % 2 === 0) doc.rect(50, iy, 495, rowH).fill('#fafafa');

        setFont(false);
        doc.fontSize(8).fillColor(dark);
        // ★ 2026-07-26 요금제 행은 발송 수량 축이 없다(plan_days 전용 컬럼으로 분리).
        //   수량 4칸에는 '-'를 찍는다 — 0을 찍으면 "전송 0건인데 35만원"으로 읽힌다.
        // ★ 2026-07-26 일자 칸은 **모든 행이 시작일만**이다. 요금제 행에만 적용 구간(`07-01~07-26`, 11자)을
        //   넣었더니 칸 폭(55pt, 안쪽 47pt)을 넘겨 `lineBreak: false`로도 안 막히고 두 줄로 흘러
        //   다음 행과 겹쳤다(Harold 스크린샷 실측). 적용 구간은 1페이지 항목표가
        //   `요금제 FREE (07-01~07-26)` + `26일 / 31일`로 이미 담고 있어 정보 손실이 없고,
        //   2페이지는 다른 행과 같은 폭·형식을 유지하는 게 표로서 맞다.
        const dateStr = toDayKey(item.item_date).slice(5, 10);
        // 에이전트는 발송ID, 그 외는 채널 이름. 계정은 장 자체가 계정 단위라 행마다 반복하지 않는다.
        const scopeLabel = ch === 'agent'
          ? String(item.agent_send_id || '(발송ID 미상)')
          : ch === 'plan' ? '요금제'
          : ch === 'test' ? '테스트'
          : ch === 'spam' ? '스팸필터'
          : '한줄로';
        // 요금제 행의 '유형' 칸은 플랜 코드다 — `PLAN_` 접두는 내부 키라 고객에게 보일 값이 아니다.
        const typeText = ch === 'plan'
          ? String(item.message_type || '').replace(/^PLAN_/, '')
          : (typeLabel[item.message_type] || item.message_type);
        doc.text(dateStr, cols[0].x + 4, iy + 5, { width: cols[0].w - 8, lineBreak: false });
        doc.text(scopeLabel, cols[1].x + 4, iy + 5, { width: cols[1].w - 8, lineBreak: false });
        doc.text(typeText, cols[2].x + 4, iy + 5, { width: cols[2].w - 8, lineBreak: false });

        if (ch === 'plan') {
          // 수량 4칸 = '-'. 일수는 1페이지 항목표의 `9일 / 31일`이 담당한다.
          [3, 4, 5, 6].forEach((c) => doc.text('-', cols[c].x + 4, iy + 5, { width: cols[c].w - 8, align: 'right' }));
        } else {
          doc.text(n(item.total_count).toLocaleString(), cols[3].x + 4, iy + 5, { width: cols[3].w - 8, align: 'right' });
          doc.text(n(item.success_count).toLocaleString(), cols[4].x + 4, iy + 5, { width: cols[4].w - 8, align: 'right' });

          if (n(item.fail_count) > 0) doc.fillColor('#dc2626');
          doc.text(n(item.fail_count).toLocaleString(), cols[5].x + 4, iy + 5, { width: cols[5].w - 8, align: 'right' });
          doc.fillColor(dark);

          doc.text(n(item.pending_count).toLocaleString(), cols[6].x + 4, iy + 5, { width: cols[6].w - 8, align: 'right' });
        }
        // ★ 2026-07-26 금액 칸은 `lineBreak: false`다. 원 단위 절사로 소수는 사라졌지만,
        //   자릿수가 큰 회사에서 다시 두 줄로 흘러 아래 행과 겹치는 사고를 구조적으로 막는다.
        doc.text(`₩${n(item.unit_price).toLocaleString()}`, cols[7].x + 4, iy + 5, { width: cols[7].w - 8, align: 'right', lineBreak: false });
        setFont(true);
        doc.text(`₩${n(item.amount).toLocaleString()}`, cols[8].x + 4, iy + 5, { width: cols[8].w - 8, align: 'right', lineBreak: false });

        detailSubtotal += n(item.amount);
        iy += rowH;
        doc.moveTo(50, iy).lineTo(545, iy).strokeColor('#eeeeee').stroke();
      });

      // 합계 행 — Harold 실측(2026-07-26): `₩13,397,454.84`가 칸 폭을 넘겨 두 줄로 흘렀다.
      iy += 4;
      doc.rect(50, iy, 495, 22).fill('#eef2ff');
      setFont(true);
      doc.fontSize(9).fillColor(primary);
      doc.text('합계', cols[0].x + 4, iy + 6);
      doc.text(`₩${detailSubtotal.toLocaleString()}`, cols[8].x + 4, iy + 6, { width: cols[8].w - 8, align: 'right', lineBreak: false });
    }

    doc.end();
    await new Promise<void>((resolve) => stream.on('finish', resolve));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(pdfFilename)}"`);
    const fileStream = fs.createReadStream(pdfPath);
    fileStream.pipe(res);

  } catch (error: any) {
    console.error('정산 PDF 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});


// ============================================================
//  거래내역서(Invoice) API
// ============================================================

// GET /preview - 정산 미리보기 = 발행 드라이런
//   ★ 2026-07-25 전면 재작성. 자체 SQL을 전부 버리고 발행(`POST /generate`)과 **같은 함수**를 호출한다.
//   기존 미리보기는 발행과 네 축이 달라 같은 기간인데 금액이 어긋났다:
//     ① campaign_runs 상태조건 없음(발행은 status='completed'만) → 미완료 발송까지 셈
//     ② 일반발송에 sendreq_time 기간조건을 덧붙임(발행은 run 집합으로만 기간을 정함)
//     ③ 브랜드메시지 REQUEST_DATE 기간조건 없음(발행은 있음)
//     ④ 후불 AI 크레딧 미포함(발행은 청구에 합산)
//   미리보기가 실제 청구액과 다르면 그걸 보고 발행하는 사람이 틀린 금액을 승인하게 된다.
//   여기서는 계산만 하고 아무것도 쓰지 않는다 — billed 플래그는 발행에서만 바뀐다.
router.get('/preview', async (req: Request, res: Response) => {
  try {
    const { company_id, start, end, type = 'combined', user_id } = req.query;

    if (!company_id || !start || !end) {
      return res.status(400).json({ error: '필수 파라미터: company_id, start, end' });
    }
    const companyId = String(company_id);
    const startDate = String(start);
    const endDate = String(end);
    const userId = user_id ? String(user_id) : undefined;

    // 1) 회사 단가 — 발행과 같은 해석(명시된 0원 보존)
    const companyResult = await pool.query(
      `SELECT company_name, billing_type, created_at,
              cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao,
              cost_per_test_sms, cost_per_test_lms, service_type
       FROM companies WHERE id = $1`,
      [companyId]
    );
    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: '고객사를 찾을 수 없습니다' });
    }
    const company = companyResult.rows[0];
    // 발행과 같은 스냅샷 경로를 쓴다 — 미리보기만 다른 값을 읽으면 금액이 갈라진다.
    const ledger = await loadBillingLedger(companyId);
    const { prices, unsetKeys: webUnsetPriceKeys } = resolveBillingUnitPricesDetailed(ledger.companyPriceRow);
    // 미리보기는 계산만 하므로 선불 회사도 막지 않는다. 대신 발행이 차단된다는 사실을 함께 돌려준다.
    const billable = company.billing_type !== 'prepaid';

    // 2) 사용량 — 발행과 완전히 같은 집계(일반·테스트·스팸·브랜드메시지 전부 포함)
    const dayData = await buildCompanyUsageByDay({ companyId, startDate, endDate, userId });
    const totals = buildBillingTotals(dayData);
    logUnbillableUsageKeys(dayData, `미리보기 company=${companyId} ${startDate}~${endDate}`);

    // ★ 2026-07-26 에이전트 포함 청구 상세 — 발행과 **같은 함수**를 쓴다.
    //   미리보기만 에이전트를 빼면 미리보기 금액과 실제 청구액이 갈라진다(0725에 고친 결함과 같은 계열).
    //   여기서는 막지 않고 발행이 막힐 이유를 billing_guard로 함께 알린다.
    const usage = await buildBillingUsageRows({ companyId, startDate, endDate, userId, ledger });
    const axisDiffs = diffBillingRowsVsDayData(usage.rows, dayData);
    const priced = priceBillingRows(
      usage.rows, prices, ledger.postpaidPriceRows,
      normalizeUnitPriceBasis(ledger.companyPriceRow?.unit_price_basis),
    );
    const unbillable = priced.unbillableTypes;
    const webUnsetPriced = findUnsetPricedTypes(webUnsetPriceKeys, usage.rows);
    const agentAmount = priced.amountByChannel.agent;
    // ★ 2026-07-26 요금제 일할 — 발행과 같은 함수. 미리보기만 빼면 금액이 갈라진다.
    const planSegments = buildPlanSegments(await loadPlanChanges(companyId, endDate), startDate, endDate);
    // 원 단위 절사가 행 단위라, 미리보기 총액도 **발행이 저장할 그 행들**에서 더해야 값이 갈라지지 않는다.
    // (구 `sumPlanSegments` 합계는 절사 전 값이라 발행 금액과 몇 원 어긋난다 — 쓰지 않는다.)
    const previewItems = [...buildPlanBillingItems(planSegments), ...priced.items];
    // 발행이 막힐 이유를 미리보기에서 **같은 함수로** 판정한다 — 다른 기준으로 판정하면
    // 미리보기는 통과인데 발행만 422가 되고, 마감일에 그 차이를 찾을 시간이 없다.
    const planGate = evaluatePlanHistoryGate({
      segments: planSegments,
      billingStart: startDate,
      billingEnd: endDate,
      companyCreatedDay: company.created_at ? toDayKey(company.created_at) : null,
      monthlyPrice: Number(ledger.companyPriceRow?.plan_monthly_price) || 0,
      // 발행과 같은 입력 — 여기만 빼면 미리보기는 통과하고 발행만 422가 된다.
      planAssigned: Boolean(ledger.companyPriceRow?.plan_id),
      historyTotal: await countPlanChanges(companyId),
    });

    // 3) 후불 AI 크레딧 — 발행과 같은 기준. 읽기만 하고 billed는 건드리지 않는다.
    //    사용자 지정이면 발행이 크레딧을 청구하지 않으므로 미리보기도 0으로 둔다(금액 일치).
    let chargeSupply = 0, chargeCount = 0, overageCount = 0;
    if (!userId) {
      const creditChargeRes = await pool.query(
        `SELECT credits, supply_amount FROM ai_credit_requests
          WHERE company_id = $1::uuid AND status = 'approved' AND billed = false
            -- ★ 2026-07-26 KST 경계 — 발행과 같은 축이라야 미리보기 금액이 갈라지지 않는다.
            AND processed_at >= ($2 || ' 00:00:00+09')::timestamptz
            AND processed_at < (($3::date + INTERVAL '1 day')::date::text || ' 00:00:00+09')::timestamptz`,
        [companyId, startDate, endDate]
      );
      chargeSupply = creditChargeRes.rows.reduce((s: number, r: any) => s + Number(r.supply_amount || 0), 0);
      chargeCount = creditChargeRes.rows.reduce((s: number, r: any) => s + Number(r.credits || 0), 0);
      const overageRes = await pool.query(
        `SELECT COALESCE(SUM(overage_credits), 0) AS oc FROM ai_credit_transactions
          WHERE company_id = $1::uuid AND type = 'deduct' AND overage_credits > 0
            -- ★ 2026-07-26 청구 완료 마커를 발행과 같은 기준으로 본다 — 이미 청구된 초과사용분을
            -- 미리보기가 다시 세면 미리보기 금액과 실제 청구액이 갈라진다.
            AND billed_billing_id IS NULL
            -- ★ 2026-07-26 KST 경계. PG 세션 TZ가 Etc/UTC라 date 캐스트로 쓰면 경계가 KST 09:00이 된다.
            -- 발송 집계는 KST 자정으로 고쳤는데 크레딧만 UTC로 남아 있어 청구 월이 또 어긋났다.
            AND created_at >= ($2 || ' 00:00:00+09')::timestamptz
            AND created_at < (($3::date + INTERVAL '1 day')::date::text || ' 00:00:00+09')::timestamptz`,
        [companyId, startDate, endDate]
      );
      overageCount = Number(overageRes.rows[0]?.oc) || 0;
    }
    const aiCreditCount = chargeCount + overageCount;
    const aiCreditSupply = chargeSupply + overageCount * CREDIT_UNIT_PRICE;

    // 4) 금액 — 발행과 같은 식(에이전트·요금제 포함, 원 미만 절사 후 정수 덧셈)
    const subtotal = previewItems.reduce((s, i) => s + (Number(i.amount) || 0), 0) + aiCreditSupply;
    const vat = vatOfSupply(subtotal);
    const totalAmount = subtotal + vat;

    const test = {
      test_sms: totals.TEST_SMS,
      test_lms: totals.TEST_LMS,
      test_sms_amount: floorWon(totals.TEST_SMS * prices.TEST_SMS),
      test_lms_amount: floorWon(totals.TEST_LMS * prices.TEST_LMS),
    };
    const spam = {
      spam_sms: totals.SPAM_SMS,
      spam_lms: totals.SPAM_LMS,
      spam_sms_amount: floorWon(totals.SPAM_SMS * prices.SPAM_SMS),
      spam_lms_amount: floorWon(totals.SPAM_LMS * prices.SPAM_LMS),
    };
    const ai_credit = { count: aiCreditCount, supply_amount: aiCreditSupply };
    const amounts = { subtotal, vat, total_amount: totalAmount };
    // ★ 2026-07-26 에이전트(게이트웨이) 항목 — 일자 × 발송ID × 유형. 대상ID는 청구 축이 아니다.
    // ★ 2026-07-27 발급명 병기 — 발송ID만으론 어느 계정인지 안 읽힌다(이름 규칙은 전 화면 공통).
    const previewCustNames = await getAgentCustNameMap();
    const agent = {
      amount: agentAmount,
      rows: priced.items
        .filter((it) => it.channel === 'agent')
        .map((it) => ({
          item_date: it.itemDate, agent_send_id: it.agentSendId, type_key: it.typeKey,
          cust_name: it.agentSendId ? previewCustNames.get(String(it.agentSendId)) || null : null,
          sent: it.total, success: it.success, unit_price: it.unitPrice, amount: it.amount,
        })),
      excluded_prepaid_send_ids: usage.excludedPrepaidSendIds,
    };
    // ★ 2026-07-26 요금제 항목 — 플랜 × 적용기간, 변경 시 일할. 청구서 항목 1번.
    //   금액은 발행이 저장할 값(구간별 원 미만 절사)과 같아야 한다.
    const plan = {
      amount: previewItems.filter((i) => i.channel === 'plan').reduce((s, i) => s + (Number(i.amount) || 0), 0),
      segments: planSegments.map((s) => ({
        plan_code: s.planCode, monthly_price: s.monthlyPrice,
        from: s.from, to: s.to, days: s.days, month_days: s.monthDays, amount: floorWon(s.amount),
      })),
    };
    // 발행 가능 여부를 미리보기에서 먼저 알린다 — 선불 회사·축 불일치·단가 미설정은 발행이 막힌다.
    // ★ 2026-07-26 차단 사유를 **발행과 전건 일치**시켰다(Codex 3차 MEDIUM 수용).
    //   에이전트 매핑 0과 요금제 이력 공백은 발행에서 422로 막는데 미리보기에는 없어서,
    //   미리보기로 확인하고 발행을 눌렀는데 막히는 상태였다 — 미리보기의 존재 이유가 그 반대다.
    const blockers: string[] = [];
    const blockerCodes: string[] = [];
    const block = (code: string, msg: string) => { blockerCodes.push(code); blockers.push(msg); };
    if (!billable) block('PREPAID_COMPANY_NOT_BILLABLE', '선불 고객사 — 발송 시점에 잔액에서 이미 차감되어 월 정산서 발행 시 이중 청구');
    if (axisDiffs.length > 0) block('BILLING_AXIS_MISMATCH', '청구 상세와 사용량 집계 수량 불일치');
    if (unbillable.length > 0) block('UNBILLABLE_TYPE_KEY', `청구 단가가 정의되지 않은 유형: ${summarizeBlockList(unbillable.map((u) => u.key))}`);
    if (webUnsetPriced.length > 0) block('WEB_UNIT_PRICE_UNSET', `고객사 단가 미설정: ${summarizeBlockList(webUnsetPriced.map((u) => u.key))}`);
    if (priced.missingAgentPrices.length > 0) block('AGENT_UNIT_PRICE_MISSING', `에이전트 발송ID 단가 미설정: ${summarizeBlockList(priced.missingAgentPrices.map((m) => `${m.agentSendId} ${m.typeKey}`))}`);
    if (usage.agentMappingMissing) block('AGENT_MAPPING_MISSING', `에이전트 사용 설정(usage_type=${ledger.usageType})인데 발송ID 매핑 0건 — 게이트웨이 발송분이 통째로 빠진다`);
    if (!planGate.ok) {
      block('PLAN_HISTORY_MISSING', planGate.blockReason === 'history_absent'
        ? '요금제가 배정돼 있는데 요금제 변경 이력이 0건 — 구독료가 0원으로 빠진다'
        : `요금제 이력이 중간에 끊김 ${planGate.gap!.from}~${planGate.gap!.to} (${planGate.gap!.days}일) — 그 구간 구독료가 0원으로 빠진다`);
    }
    const billing_guard = {
      billable: billable && blockers.length === 0,
      billing_type: company.billing_type || null,
      reason: blockers.length > 0 ? blockers.join(' / ') : null,
      blocker_codes: blockerCodes,
      unbillable_types: unbillable,
      unset_price_types: webUnsetPriced,
      axis_mismatches: axisDiffs,
      missing_agent_prices: priced.missingAgentPrices,
      agent_mapping_missing: usage.agentMappingMissing,
      plan_gap: planGate.gap,
      // 차단은 아니지만 금액에 영향이 있다 — "그 기간 앞부분은 요금제 없음"을 미리보기에서 보여준다.
      plan_uncovered_head: planGate.uncoveredHead,
    };

    if (type === 'brand') {
      // 매장(발신번호) 축은 청구 집계에 없다. 그래서 **같은 run 집합·같은 테이블·같은 where**를 매장별로
      // 나누기만 한다 — 그러면 매장 합계가 아래 combined 합계와 항상 일치한다.
      // (기간조건을 덧붙이면 그 순간 두 숫자가 갈라진다. 그게 이번에 고친 결함이다.)
      const runIds = await selectBillingRunIds({ companyId, startDate, endDate, userId });
      const brandMap: Record<string, any> = {};
      const ensureStore = (code: string, name: string) => {
        if (!brandMap[code]) {
          brandMap[code] = { store_code: code, store_name: name, sms_success: 0, lms_success: 0, mms_success: 0, kakao_success: 0 };
        }
        return brandMap[code];
      };

      let queueKakao = 0;
      if (runIds.length > 0) {
        const storeRes = await pool.query(
          `SELECT cr.id AS run_id, cb.store_code, cb.store_name
             FROM campaign_runs cr
             JOIN campaigns c ON c.id = cr.campaign_id
             LEFT JOIN callback_numbers cb ON cb.phone = c.callback_number AND cb.company_id = c.company_id
            WHERE cr.id = ANY($1::uuid[])
            UNION
           SELECT c2.id AS run_id, cb2.store_code, cb2.store_name
             FROM campaigns c2
             LEFT JOIN callback_numbers cb2 ON cb2.phone = c2.callback_number AND cb2.company_id = c2.company_id
            WHERE c2.id = ANY($1::uuid[])`,
          [runIds]
        );
        const storeMap: Record<string, { store_code: string; store_name: string }> = {};
        storeRes.rows.forEach((r: any) => {
          storeMap[r.run_id] = { store_code: r.store_code || 'default', store_name: r.store_name || '본사' };
        });

        const companyTables = await getBillingCompanyTables(companyId);
        const billingTables = await getTablesForBillingPeriod(companyTables, startDate, endDate);
        const ph = runIds.map(() => '?').join(',');
        const rows = await smsAggByRunAndType(billingTables, `app_etc1 IN (${ph})`, runIds);
        rows.forEach((row: any) => {
          const store = storeMap[row.run_id] || { store_code: 'default', store_name: '본사' };
          const b = ensureStore(store.store_code, store.store_name);
          const n = Number(row.success_count) || 0;
          switch (MSG_TYPE_TO_USAGE_KEY[row.msg_type]) {
            case 'SMS': b.sms_success += n; break;
            case 'LMS': b.lms_success += n; break;
            case 'MMS': b.mms_success += n; break;
            case 'KAKAO': b.kakao_success += n; queueKakao += n; break;
          }
        });
      }

      // 브랜드메시지(IMC)는 매장 축이 없다 — 큐에서 센 알림톡을 뺀 차액을 본사로 몰아 합계를 맞춘다.
      const imcKakao = Math.max(0, totals.KAKAO - queueKakao);
      if (imcKakao > 0) ensureStore('default', '본사').kakao_success += imcKakao;

      const brands = Object.values(brandMap).map((b: any) => ({
        ...b,
        sms_amount: b.sms_success * prices.SMS,
        lms_amount: b.lms_success * prices.LMS,
        mms_amount: b.mms_success * prices.MMS,
        kakao_amount: b.kakao_success * prices.KAKAO,
      }));

      return res.json({ type: 'brand', brands, test, spam, agent, plan, ai_credit, amounts, billing_guard });
    }

    const summary = {
      sms_success: totals.SMS,
      lms_success: totals.LMS,
      mms_success: totals.MMS,
      kakao_success: totals.KAKAO,
      sms_amount: totals.SMS * prices.SMS,
      lms_amount: totals.LMS * prices.LMS,
      mms_amount: totals.MMS * prices.MMS,
      kakao_amount: totals.KAKAO * prices.KAKAO,
    };

    return res.json({ type: 'combined', summary, test, spam, agent, plan, ai_credit, amounts, billing_guard });
  } catch (error: any) {
    const emsg = error?.message || '';
    if (emsg.includes('column') && emsg.includes('does not exist')) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — company_agent_ids.billing_type·cost_per_* 및 ai_credit_transactions.overage_credits 컬럼 ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('정산 미리보기 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ※ 옛 buildTestSummary·buildSpamSummary는 삭제했다(2026-07-25).
//   테스트·스팸 수량도 발행과 같은 집계(buildCompanyUsageByDay의 TEST_*/SPAM_* 유형키)에서 나온다.
//   같은 숫자를 두 군데서 따로 세면 언젠가 갈라진다.

// POST /invoices - 거래내역서 생성
router.post('/invoices', async (req: Request, res: Response) => {
  try {
    const {
      company_id, store_code, store_name, billing_start, billing_end,
      invoice_type = 'combined', billing_id,
      sms_success_count = 0, sms_unit_price = 0,
      lms_success_count = 0, lms_unit_price = 0,
      mms_success_count = 0, mms_unit_price = 0,
      kakao_success_count = 0, kakao_unit_price = 0,
      test_sms_count = 0, test_sms_unit_price = 0,
      test_lms_count = 0, test_lms_unit_price = 0,
      spam_filter_count = 0, spam_filter_unit_price = 0,
      notes, created_by
    } = req.body;

    if (!company_id || !billing_start || !billing_end) {
      return res.status(400).json({ error: '필수: company_id, billing_start, billing_end' });
    }

    // ★ 2026-07-26 거래내역서도 **항목별 원 미만 절사**다(Harold 지시). 단가가 소수 둘째 자리라
    //   유형별 금액이 소수로 떨어지고, 고객이 항목을 세로로 더한 값이 공급가액과 맞아야 한다.
    //   PDF의 유형별 행도 같은 함수를 거치므로 표와 합계가 정확히 일치한다.
    const subtotal =
      floorWon(sms_success_count * sms_unit_price) +
      floorWon(lms_success_count * lms_unit_price) +
      floorWon(mms_success_count * mms_unit_price) +
      floorWon(kakao_success_count * kakao_unit_price) +
      floorWon(test_sms_count * test_sms_unit_price) +
      floorWon(test_lms_count * test_lms_unit_price) +
      floorWon(spam_filter_count * spam_filter_unit_price);
    const vat = vatOfSupply(subtotal);
    const total_amount = subtotal + vat;

    const result = await pool.query(
      `INSERT INTO billing_invoices (
        company_id, store_code, store_name, billing_start, billing_end, invoice_type, billing_id,
        sms_success_count, sms_unit_price, lms_success_count, lms_unit_price,
        mms_success_count, mms_unit_price, kakao_success_count, kakao_unit_price,
        test_sms_count, test_sms_unit_price, test_lms_count, test_lms_unit_price,
        spam_filter_count, spam_filter_unit_price,
        subtotal, vat, total_amount, status, notes, created_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'draft',$25,$26
      ) RETURNING *`,
      [
        company_id, store_code || null, store_name || null, billing_start, billing_end, invoice_type, billing_id || null,
        sms_success_count, sms_unit_price, lms_success_count, lms_unit_price,
        mms_success_count, mms_unit_price, kakao_success_count, kakao_unit_price,
        test_sms_count, test_sms_unit_price, test_lms_count, test_lms_unit_price,
        spam_filter_count, spam_filter_unit_price,
        subtotal, vat, total_amount, notes || null, created_by || null
      ]
    );

    return res.json(result.rows[0]);
  } catch (error: any) {
    console.error('거래내역서 생성 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /invoices - 거래내역서 목록
router.get('/invoices', async (req: Request, res: Response) => {
  try {
    const { company_id, status } = req.query;
    // ★ 수정: c.name → c.company_name (companies 테이블 컬럼명 일치)
    let sql = `SELECT bi.*, c.company_name
               FROM billing_invoices bi
               JOIN companies c ON c.id = bi.company_id
               WHERE 1=1`;
    const params: any[] = [];

    if (company_id) { params.push(company_id); sql += ` AND bi.company_id = $${params.length}`; }
    if (status) { params.push(status); sql += ` AND bi.status = $${params.length}`; }
    sql += ' ORDER BY bi.created_at DESC';

    const result = await pool.query(sql, params);
    return res.json(result.rows);
  } catch (error: any) {
    console.error('거래내역서 목록 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /invoices/:id - 거래내역서 상세
router.get('/invoices/:id', async (req: Request, res: Response) => {
  try {
    // ★ 수정: c.name → c.company_name
    const result = await pool.query(
      `SELECT bi.*, c.company_name, c.business_number, c.ceo_name, c.address
       FROM billing_invoices bi
       JOIN companies c ON c.id = bi.company_id
       WHERE bi.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '거래내역서를 찾을 수 없습니다' });
    }
    return res.json(result.rows[0]);
  } catch (error: any) {
    console.error('거래내역서 상세 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// PUT /invoices/:id/status - 상태 변경
router.put('/invoices/:id/status', async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    if (!['draft', 'confirmed', 'paid'].includes(status)) {
      return res.status(400).json({ error: '유효한 상태: draft, confirmed, paid' });
    }
    const result = await pool.query(
      `UPDATE billing_invoices SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '거래내역서를 찾을 수 없습니다' });
    }
    return res.json(result.rows[0]);
  } catch (error: any) {
    console.error('상태 변경 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================
//  거래내역서 PDF
//  TODO: 정산 PDF와 공통 렌더링 로직을 services/pdfService.ts로 분리
// ============================================================

// GET /invoices/:id/pdf - PDF 거래내역서 생성 & 다운로드
router.get('/invoices/:id/pdf', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT bi.*, c.company_name, c.business_number, c.ceo_name, c.address,
              c.contact_name, c.contact_phone, c.contact_email, c.business_type, c.business_category
       FROM billing_invoices bi
       JOIN companies c ON c.id = bi.company_id
       WHERE bi.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '거래내역서를 찾을 수 없습니다' });
    }
    const inv = result.rows[0];

    const PDFDocument = require('pdfkit');
    const fs = require('fs');
    const path = require('path');

    const fontPath = path.join(__dirname, '../../fonts/malgun.ttf');
    const fontBoldPath = path.join(__dirname, '../../fonts/malgunbd.ttf');
    const hasFont = fs.existsSync(fontPath);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    const pdfDir = path.join(__dirname, '../../pdfs');
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
    const bStart = toDayKey(inv.billing_start);
    const bEnd = toDayKey(inv.billing_end);
    const pdfFilename = `invoice_${inv.id.slice(0, 8)}_${bStart}_${bEnd}.pdf`;
    const pdfPath = path.join(pdfDir, pdfFilename);
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    const setFont = (bold = false) => { if (hasFont) doc.font(bold ? fontBoldPath : fontPath); };
    const primary = '#4338ca';
    const dark = '#1f2937';
    const gray = '#6b7280';

    // 헤더
    setFont(true);
    doc.fontSize(22).fillColor(primary).text('거래내역서', 50, 50);
    setFont(false);
    doc.fontSize(9).fillColor(gray).text('INVOICE', 50, 78);

    const rightX = 350;
    setFont(false);
    doc.fontSize(9).fillColor(gray);
    doc.text('내역서 번호:', rightX, 50, { continued: true });
    setFont(true);
    doc.fillColor(dark).text(`  INV-${inv.id.slice(0, 8).toUpperCase()}`);
    setFont(false);
    doc.fontSize(9).fillColor(gray);
    doc.text('발행일:', rightX, 65, { continued: true });
    doc.fillColor(dark).text(`  ${toDayKey(new Date())}`);
    doc.text('정산기간:', rightX, 80, { continued: true });
    doc.fillColor(dark).text(`  ${bStart} ~ ${bEnd}`);

    doc.moveTo(50, 105).lineTo(545, 105).strokeColor('#e5e7eb').stroke();

    // 공급자 / 공급받는자 — 정산서와 같은 CT. 대표자 2명 줄바꿈 겹침(2026-07-26)이 여기도 그대로 있었다.
    const invPartyTop = 120;
    const invLeftBottom = drawPartyBlock(doc, {
      x: 50, y: invPartyTop, width: rightX - 50 - 20, title: '공급자', primary, dark, setFont,
      lines: [
        { label: '상호', value: INVITO_INFO.companyName },
        { label: '대표', value: INVITO_INFO.ceoName },
        { label: '사업자번호', value: INVITO_INFO.bizNumber },
        { label: '업태/종목', value: INVITO_INFO.bizType },
        { label: '주소', value: INVITO_INFO.address },
        { label: '연락처', value: `${INVITO_INFO.phone} / ${INVITO_INFO.email}` },
      ],
    });
    const invRightBottom = drawPartyBlock(doc, {
      x: rightX, y: invPartyTop, width: 545 - rightX, title: '공급받는자', primary, dark, setFont,
      lines: [
        { label: '상호', value: inv.company_name || '-' },
        { label: '대표', value: inv.ceo_name || '-' },
        { label: '사업자번호', value: inv.business_number || '-' },
        { label: '업태/종목', value: `${inv.business_type || '-'} / ${inv.business_category || '-'}` },
        { label: '주소', value: inv.address || '-' },
        { label: '연락처', value: `${inv.contact_phone || '-'} / ${inv.contact_email || '-'}` },
      ],
    });

    const invPartyBottom = Math.max(invLeftBottom, invRightBottom);
    doc.moveTo(50, invPartyBottom + 4).lineTo(545, invPartyBottom + 4).strokeColor('#e5e7eb').stroke();

    let iy = invPartyBottom + 14;
    if (inv.store_name && inv.invoice_type === 'brand') {
      setFont(false);
      doc.fontSize(9).fillColor(gray).text(`브랜드: ${inv.store_name} (${inv.store_code || ''})`, 50, iy);
      iy += 20;
    }

    // 내역 테이블
    doc.rect(50, iy, 495, 25).fill(primary);
    setFont(true);
    doc.fontSize(9).fillColor('white');
    doc.text('항목', 60, iy + 7);
    doc.text('수량', 250, iy + 7, { width: 80, align: 'right' });
    doc.text('단가', 340, iy + 7, { width: 80, align: 'right' });
    doc.text('금액', 430, iy + 7, { width: 105, align: 'right' });
    iy += 25;

    const drawInvRow = (label: string, count: number, price: number, amount: number, bg = 'white') => {
      if (count <= 0) return;
      if (bg !== 'white') doc.rect(50, iy, 495, 22).fill(bg);
      setFont(false);
      doc.fontSize(9).fillColor(dark);
      doc.text(label, 60, iy + 6);
      doc.text(count.toLocaleString(), 250, iy + 6, { width: 80, align: 'right' });
      doc.text(`₩${price.toLocaleString()}`, 340, iy + 6, { width: 80, align: 'right' });
      setFont(true);
      doc.text(`₩${amount.toLocaleString()}`, 430, iy + 6, { width: 105, align: 'right' });
      iy += 22;
      doc.moveTo(50, iy).lineTo(545, iy).strokeColor('#e5e7eb').stroke();
    };

    const n = (v: any) => Number(v) || 0;
    // ★ 2026-07-26 행 금액은 저장 시점과 **같은 절사 함수**를 거친다. 다른 규칙으로 그리면
    //   표의 세로합이 아래 공급가액과 어긋난다(고객이 가장 먼저 검산하는 자리다).
    drawInvRow('SMS', n(inv.sms_success_count), n(inv.sms_unit_price), floorWon(n(inv.sms_success_count) * n(inv.sms_unit_price)));
    drawInvRow('LMS', n(inv.lms_success_count), n(inv.lms_unit_price), floorWon(n(inv.lms_success_count) * n(inv.lms_unit_price)));
    drawInvRow('MMS', n(inv.mms_success_count), n(inv.mms_unit_price), floorWon(n(inv.mms_success_count) * n(inv.mms_unit_price)));
    drawInvRow('카카오', n(inv.kakao_success_count), n(inv.kakao_unit_price), floorWon(n(inv.kakao_success_count) * n(inv.kakao_unit_price)));
    drawInvRow('테스트 SMS', n(inv.test_sms_count), n(inv.test_sms_unit_price), floorWon(n(inv.test_sms_count) * n(inv.test_sms_unit_price)), '#fefce8');
    drawInvRow('테스트 LMS', n(inv.test_lms_count), n(inv.test_lms_unit_price), floorWon(n(inv.test_lms_count) * n(inv.test_lms_unit_price)), '#fefce8');
    drawInvRow('스팸필터', n(inv.spam_filter_count), n(inv.spam_filter_unit_price), floorWon(n(inv.spam_filter_count) * n(inv.spam_filter_unit_price)), '#fef3c7');

    // 합계
    iy += 15;
    const invSummaryX = 340;
    setFont(false);
    doc.fontSize(9).fillColor(gray);
    doc.text('공급가액:', invSummaryX, iy, { width: 80, align: 'right' });
    setFont(true);
    doc.fillColor(dark).text(`₩${n(inv.subtotal).toLocaleString()}`, 430, iy, { width: 105, align: 'right' });
    iy += 18;
    setFont(false);
    doc.fillColor(gray);
    doc.text('부가세 (10%):', invSummaryX, iy, { width: 80, align: 'right' });
    setFont(true);
    doc.fillColor(dark).text(`₩${n(inv.vat).toLocaleString()}`, 430, iy, { width: 105, align: 'right' });
    iy += 22;

    doc.rect(invSummaryX - 10, iy - 2, 225, 28).fill('#eef2ff');
    setFont(true);
    doc.fontSize(11).fillColor(primary);
    doc.text('합계:', invSummaryX, iy + 5, { width: 80, align: 'right' });
    doc.fontSize(13).text(`₩${n(inv.total_amount).toLocaleString()}`, 430, iy + 3, { width: 105, align: 'right' });

    let invContentBottom = iy + 28;
    if (inv.notes) {
      iy += 50;
      setFont(true);
      doc.fontSize(9).fillColor(gray).text('비고:', 50, iy);
      setFont(false);
      doc.fillColor(dark).text(inv.notes, 50, iy + 15, { width: 495 });
      invContentBottom = iy + 15 + Math.ceil(doc.heightOfString(String(inv.notes), { width: 495 }));
    }

    // ★ 2026-07-26 감사 인사 — 정산서와 같은 CT·같은 배치(문서 간 톤이 갈리지 않게).
    const invThanksY = Math.max(invContentBottom + 16, 690);
    if (invThanksY + THANKS_NOTE_HEIGHT <= 762) {
      drawThanksNote(doc, {
        x: 50, y: invThanksY, width: 495, primary, gray, setFont,
        message: `${Number(String(bEnd).slice(5, 7))}월도 한줄로를 이용해 주셔서 감사합니다.`,
      });
    }


    doc.end();
    await new Promise<void>((resolve) => stream.on('finish', resolve));

    await pool.query(
      'UPDATE billing_invoices SET pdf_path = $1, updated_at = now() WHERE id = $2',
      [pdfPath, req.params.id]
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(pdfFilename)}"`);
    const fileStream = fs.createReadStream(pdfPath);
    fileStream.pipe(res);

  } catch (error: any) {
    console.error('PDF 생성 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================
//  정산서 메일 발송
// ============================================================

// POST /:id/send-email - 정산서 PDF 메일 발송
//
// ★ 2026-07-26 이 라우트가 **화면이 실제로 부르는 그 라우트**다.
//   `app.ts:319`가 `/api/admin/billing`에 이 라우터를, 323이 `/api/admin`에 admin 라우터를 마운트하므로
//   `POST /api/admin/billing/:id/send-email`은 여기서 잡히고 admin.ts의 동명 라우트는 **닿지 않는다.**
//   그 사실을 몰라서 두 가지가 어긋나 있었다:
//     ① 응답에 `success`가 없어 화면이 `if (!res.data?.success)`로 **실발송을 "발송 실패"로 표시** →
//        운영자가 재발송 → 고객이 같은 청구서를 두 번 받는다.
//     ② 화면이 넘긴 수신자·제목을 무시하고 `contact_email`로만 보냈고,
//        화면이 표시하는 발송 이력 컬럼(`emailed_at`)은 아무도 채우지 않아 영구 공백이었다.
//   본문은 **서버가 만든다** — 항목표가 `billing_items`에서 나오고 정합 검사를 통과해야 하므로
//   화면이 만든 본문을 그대로 보내면 그 검사를 우회한다(LESSONS_META §19 이메일 본문).
router.post('/:id/send-email', async (req: Request, res: Response) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const adminId = (req as any).user?.userId || null;

    // 1) 정산 + 회사 정보 조회
    const result = await pool.query(
      `SELECT b.*, c.company_name, c.contact_email, c.contact_name
       FROM billings b
       JOIN companies c ON c.id = b.company_id
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '정산을 찾을 수 없습니다' });
    }
    const bil = result.rows[0];

    // 수신자·제목은 화면에서 그 자리에 고칠 수 있다(담당자가 바뀌는 일이 흔하다). 없으면 등록된 담당자.
    const toOverride = String((req.body || {}).to || '').trim();
    if (toOverride && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toOverride)) {
      return res.status(400).json({ error: `수신자 이메일 형식이 올바르지 않습니다: ${toOverride}` });
    }
    const sendTo = toOverride || bil.contact_email;
    const subjectOverride = String((req.body || {}).subject || '').trim();

    if (!sendTo) {
      return res.status(400).json({ error: '고객사 담당자 이메일이 등록되어 있지 않습니다. 수신자를 직접 입력해 주세요.' });
    }

    // 2) PDF 파일 확인 — 없으면 생성 요청
    const pdfDir = path.join(__dirname, '../../pdfs');
    const pdfFilename = `billing_${bil.id.slice(0, 8)}_${bil.billing_year}_${String(bil.billing_month).padStart(2, '0')}.pdf`;
    const pdfPath = path.join(pdfDir, pdfFilename);

    if (!fs.existsSync(pdfPath)) {
      // 화면은 이 코드를 보고 PDF 생성을 먼저 호출한 뒤 재시도한다 — 운영자가 순서를 외울 일이 아니다.
      return res.status(400).json({
        error: 'PDF가 아직 생성되지 않았습니다. 청구서 PDF를 먼저 생성한 뒤 다시 발송해 주세요.',
        code: 'BILLING_PDF_NOT_READY',
      });
    }

    const n = (v: any) => Number(v) || 0;
    const bStart = toDayKey(bil.billing_start);
    const bEnd = toDayKey(bil.billing_end);

    // ★ 2026-07-26 메일 항목표도 `billing_items`에서 만든다 — PDF와 **같은 함수**.
    //   그 전에는 헤더 컬럼을 직접 그려서 에이전트 줄이 없었고, PDF와 별개 코드라
    //   PDF만 고치면 메일에서만 틀린 청구서가 나가는 구조였다.
    //   메일은 회수가 안 되므로 보내기 전에 정합을 확인한다.
    const emailItems = await pool.query(
      `SELECT * FROM billing_items WHERE billing_id = $1
        ORDER BY channel ASC, item_date ASC, message_type ASC, id ASC`,
      [req.params.id],
    );
    const emailLines = buildInvoiceLines(emailItems.rows);
    const emailCheck = checkInvoiceLinesAgainstHeader(emailLines, n(bil.ai_credit_supply), n(bil.subtotal));
    if (!emailCheck.ok) {
      console.log(`[정산][메일정합실패] billing=${req.params.id} — 항목합 ${emailCheck.linesSum} + 크레딧 ${emailCheck.aiCreditSupply} ≠ 공급가액 ${emailCheck.subtotal}`);
      return res.status(422).json({
        error: '청구서 항목 합계가 공급가액과 일치하지 않아 메일 발송을 중단했습니다. 보낸 메일은 되돌릴 수 없습니다.',
        code: 'BILLING_ITEM_HEADER_MISMATCH',
        check: emailCheck,
      });
    }
    const LINE_BG: Record<string, string> = { web: '', agent: ' background: #EFF6FF;', test: ' background: #FFFBEB;', spam: ' background: #FEF3C7;' };
    const lineRowsHtml = emailLines.map((l) => `<tr style="border-bottom: 1px solid #F3F4F6;${LINE_BG[l.channel] || ''}">
              <td style="padding: 8px 0; color: #6B7280;">${l.label}</td>
              <td style="padding: 8px 0; text-align: right;">${l.quantityText ? `${l.quantityText} × ₩${l.unitPrice.toLocaleString()}/월` : `${l.count.toLocaleString()}건 × ₩${l.unitPrice.toLocaleString()}`}</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">₩${l.amount.toLocaleString()}</td>
            </tr>`).join('');

    // 3) 메일 발송
    const htmlBody = `
      <div style="font-family: 'Apple SD Gothic Neo', sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #4338ca, #6366F1); padding: 24px; border-radius: 12px 12px 0 0;">
          <h2 style="color: white; margin: 0; font-size: 20px;">📊 정산서 안내</h2>
          <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 14px;">${bil.company_name} | ${bil.billing_year}년 ${bil.billing_month}월</p>
        </div>
        <div style="background: #ffffff; padding: 24px; border: 1px solid #E5E7EB; border-top: none;">
          <p style="font-size: 14px; color: #374151; margin: 0 0 16px;">
            안녕하세요, ${bil.contact_name || bil.company_name} 담당자님.<br/>
            <strong>${bStart} ~ ${bEnd}</strong> 기간 정산서를 안내드립니다.
          </p>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 16px;">
            ${lineRowsHtml}
            ${n(bil.ai_credit_supply) > 0 ? `<tr style="border-bottom: 1px solid #F3F4F6; background: #F5F3FF;">
              <td style="padding: 8px 0; color: #6B7280;">AI 크레딧</td>
              <td style="padding: 8px 0; text-align: right;">${n(bil.ai_credit_count).toLocaleString()} 크레딧</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">₩${n(bil.ai_credit_supply).toLocaleString()}</td>
            </tr>` : ''}
          </table>
          <div style="background: #EEF2FF; padding: 16px; border-radius: 8px; text-align: right;">
            <span style="font-size: 13px; color: #6B7280;">공급가액 ₩${n(bil.subtotal).toLocaleString()} + VAT ₩${n(bil.vat).toLocaleString()}</span><br/>
            <span style="font-size: 20px; font-weight: 700; color: #4338CA;">합계 ₩${n(bil.total_amount).toLocaleString()}</span>
          </div>
          <p style="font-size: 13px; color: #9CA3AF; margin-top: 16px;">
            상세 내역은 첨부된 PDF를 확인해주세요.<br/>
            문의사항이 있으시면 ${INVITO_INFO.phone}로 연락 부탁드립니다.
          </p>
        </div>
        <div style="padding: 16px; text-align: center; font-size: 11px; color: #9CA3AF; border: 1px solid #E5E7EB; border-top: none; border-radius: 0 0 12px 12px; background: #F9FAFB;">
          본 메일은 INVITO 한줄로 시스템에서 자동 발송되었습니다.
        </div>
      </div>
    `;

    // ★ 2026-07-26 발송 표시와 SMTP를 **한 트랜잭션 안에서, 행 잠금을 든 채로** 한다(Codex 5차 #1·#2 수용).
    //   4차 수정은 표시를 SMTP 앞으로 옮기고 곧바로 COMMIT했다. 그러면 잠금이 발송 전에 풀려서,
    //   SMTP가 도는 몇 초 동안 사유를 적은 삭제가 통과한다 — 고객은 **이미 삭제된 청구서**를 받고
    //   크레딧 마커는 풀려 재발행에 다시 들어간다. 표시를 앞으로 옮긴 것만으로는 그 창이 닫히지 않는다.
    //   잠금을 든 채 보내면 삭제는 발송이 끝날 때까지 기다렸다가 "이미 메일 나감" 상태를 보게 된다.
    //
    //   실패 시 되돌림도 손으로 하지 않는다 — `ROLLBACK` 하나가 표시를 원상복구한다.
    //   손으로 되돌리면 잠금 전에 읽은 낡은 값을 쓰게 되어 **다른 요청의 성공 이력까지 지운다**(5차 #2).
    //
    //   재발송은 막지 않되 확인을 받는다. 잠금 후 이미 발송 이력이 있으면 409로 되돌려
    //   화면이 "언제·누구에게 나갔다"를 보여주고 다시 누르게 한다(`resend: true`).
    // 재발송 확인은 **확인한 그 이력에 묶는다**(Codex 6차 ①-4). `resend: true`만 보면,
    // A가 확인 화면을 보는 동안 B가 먼저 재발송한 경우 A의 클릭이 B의 발송을 못 보고 그대로 또 보낸다.
    // 화면은 409에서 받은 `emailed_at`을 `resend_of`로 되돌려주고, 서버는 잠근 행의 값과 같을 때만 통과시킨다.
    const allowResend = (req.body || {}).resend === true;
    const resendOf = String((req.body || {}).resend_of || '').trim();
    const mailClient = await pool.connect();
    let emailedAt: any = null;
    let mailSent = false;   // SMTP가 메일을 넘긴 뒤인가 — COMMIT 실패 시 안내를 가르는 축
    // 타임아웃은 "실패"가 아니라 **발송 여부 미확정**이다 — 우리가 기다리기를 그만둔 것이고
    // SMTP는 그 뒤에도 전달을 끝낼 수 있다. 일반 실패로 내리면 운영자가 다시 눌러 중복 발송한다.
    let mailTimedOut = false;
    const MAIL_TOTAL_TIMEOUT_MS = 60000;
    try {
      await mailClient.query('BEGIN');
      // 잠금 대기 상한 — SMTP를 잠금 안에서 하므로 대기자가 커넥션을 무한정 물면 풀이 마른다(기본 20).
      // 10초면 정상 발송(수 초)은 통과하고, 앞 건이 길어질 때 뒤 요청은 커넥션을 놓고 물러난다.
      await mailClient.query(`SET LOCAL lock_timeout = '10s'`);
      const locked = await mailClient.query(
        'SELECT id, emailed_at, emailed_to, email_sent_at FROM billings WHERE id = $1::uuid FOR UPDATE',
        [req.params.id],
      );
      if (locked.rows.length === 0) {
        await mailClient.query('ROLLBACK');
        return res.status(404).json({ error: '발송 준비 중 정산이 삭제되었습니다. 메일은 발송되지 않았습니다.' });
      }
      // 판정은 **잠근 행**으로 한다 — 트랜잭션 밖에서 읽은 값으로 판정하면 그 사이 나간 메일을 못 본다.
      const already = locked.rows[0];
      const lastSentAt = already.emailed_at || already.email_sent_at || null;
      const alreadySent = Boolean(lastSentAt);
      const confirmedThisOne = allowResend && !!resendOf && !!lastSentAt
        && new Date(resendOf).getTime() === new Date(lastSentAt).getTime();
      if (alreadySent && !confirmedThisOne) {
        await mailClient.query('ROLLBACK');
        return res.status(409).json({
          error: allowResend && resendOf
            ? `확인한 뒤 다른 발송이 있었습니다 (${already.emailed_to || '수신자 미상'}). 최신 발송 이력을 확인하고 다시 시도해 주세요.`
            : `이미 발송된 정산서입니다 (${already.emailed_to || '수신자 미상'}). 다시 보내려면 재발송을 확인해 주세요.`,
          code: 'BILLING_ALREADY_EMAILED',
          emailed_at: lastSentAt,
          emailed_to: already.emailed_to,
        });
      }

      const marked = await mailClient.query(
        `UPDATE billings SET email_sent_at = now(), emailed_at = now(), emailed_to = $2, emailed_by = $3, updated_at = now()
          WHERE id = $1::uuid RETURNING emailed_at`,
        [req.params.id, sendTo, adminId],
      );
      emailedAt = marked.rows[0]?.emailed_at || null;

      // SMTP는 잠금 안에서. 타임아웃이 없으면 이 트랜잭션이 커넥션과 잠금을 무한정 붙잡는다.
      //   nodemailer의 `socketTimeout`은 **비활동** 상한이라 총 소요 시간을 못 막는다(6차 ①-1) —
      //   조금씩 계속 오가면 40초를 넘길 수 있다. 그래서 총 시간 상한을 여기서 따로 건다.
      const transporter = getTransporter();
      let mailTimer: NodeJS.Timeout | undefined;
      await Promise.race([
        transporter.sendMail({
          from: `"INVITO 정산" <${process.env.SMTP_USER}>`,
          to: sendTo,
          bcc: process.env.SMTP_BCC || '',
          subject: subjectOverride || `[INVITO] ${bil.company_name} ${bil.billing_year}년 ${bil.billing_month}월 정산서`,
          html: htmlBody,
          attachments: [{ filename: pdfFilename, path: pdfPath }],
        }).then(() => { mailSent = true; }),
        new Promise((_, reject) => {
          mailTimer = setTimeout(() => {
            mailTimedOut = true;
            reject(new Error(`메일 발송이 ${MAIL_TOTAL_TIMEOUT_MS / 1000}초를 넘겨 기다리기를 중단했습니다`));
          }, MAIL_TOTAL_TIMEOUT_MS);
        }),
      ]).finally(() => { if (mailTimer) clearTimeout(mailTimer); });

      await mailClient.query('COMMIT');
    } catch (mailErr: any) {
      // ★ 2026-07-26 Codex 7차 ① — 타임아웃은 **되돌리지 않고 커밋한다.**
      //   `Promise.race`는 우리가 기다리기를 그만두게 할 뿐 `sendMail`을 취소하지 못한다.
      //   그래서 이력을 롤백하면 "메일은 뒤이어 전달됐는데 이력은 없음"이 되고, 다음 클릭이
      //   409 확인을 만나지 못해 **중복 발송**이 된다.
      //   두 불확실 중 고객에게 두 번 가는 쪽을 막는다 — 표시를 남기면 다음 클릭은 반드시 재발송 확인을 거친다.
      if (mailTimedOut) {
        try {
          await mailClient.query('COMMIT');
          console.error(`[정산][메일발송미확정] billing=${req.params.id} to=${sendTo} — ${MAIL_TOTAL_TIMEOUT_MS / 1000}초 초과로 대기 중단. 발송 여부 불명이라 발송 표시는 남긴다(중복 발송 차단).`);
        } catch (commitErr: any) {
          try { await mailClient.query('ROLLBACK'); } catch { /* 이미 종료된 트랜잭션 */ }
          console.error(`[정산][메일발송미확정·이력유실] billing=${req.params.id} to=${sendTo}:`, commitErr?.message || commitErr);
        }
        // 커넥션 반납은 아래 `finally`가 한다 — 여기서 또 부르면 이중 release로 터진다.
        return res.status(504).json({
          error: '메일 서버 응답이 늦어 발송 여부를 확인할 수 없습니다. 고객에게 메일이 갔을 수 있어 발송 이력을 남겨 두었습니다. 수신 확인 후 필요하면 재발송해 주세요.',
          code: 'BILLING_EMAIL_SEND_UNCERTAIN',
        });
      }
      try { await mailClient.query('ROLLBACK'); } catch { /* 이미 종료된 트랜잭션 */ }
      console.error(`[정산][메일발송실패] billing=${req.params.id} to=${sendTo} 발송여부=${mailSent ? '나감' : '미발송'}:`, mailErr?.message || mailErr);
      // ★ 발송은 됐는데 COMMIT이 실패한 경우(6차 ①-3) — 메일은 회수 불가인데 이력은 롤백됐다.
      //   이걸 일반 실패로 내리면 운영자가 다시 눌러 **중복 발송**한다(409 확인도 이력이 없어 안 걸린다).
      //   그래서 전용 코드로 "나갔을 수 있다"를 알린다. 되돌릴 수 없는 상태는 숨기지 않는다.
      if (mailSent) {
        console.error(`[정산][메일이력유실] billing=${req.params.id} to=${sendTo} — 메일은 발송됐고 발송 이력은 기록되지 않았다. 수동 확인 필요.`);
        return res.status(500).json({
          error: '메일은 발송됐지만 발송 이력 기록에 실패했습니다. 고객에게는 메일이 갔을 수 있으니 수신 확인 후 재발송을 판단해 주세요.',
          code: 'BILLING_EMAIL_LOG_LOST',
        });
      }
      // ★ 타임아웃 = 발송 여부 미확정. 우리가 기다리기를 그만뒀을 뿐이고 SMTP는 뒤이어 전달을 끝낼 수 있다.
      //   이력은 롤백됐으므로 재발송 확인(409)도 걸리지 않는다 — 그 사실을 그대로 알려 중복 발송을 막는다.
      if (mailTimedOut) {
        console.error(`[정산][메일발송미확정] billing=${req.params.id} to=${sendTo} — ${MAIL_TOTAL_TIMEOUT_MS / 1000}초 초과로 대기 중단. 발송 여부 불명, 이력 미기록.`);
        return res.status(504).json({
          error: '메일 서버 응답이 늦어 발송 여부를 확인할 수 없습니다. 고객에게 메일이 갔을 수 있으니 수신 확인 후 재발송을 판단해 주세요.',
          code: 'BILLING_EMAIL_SEND_UNCERTAIN',
        });
      }
      throw mailErr;
    } finally {
      mailClient.release();
    }

    // ★ `success: true`를 반드시 담는다 — 화면이 이 필드로 성공을 판정한다(없으면 실발송을 실패로 표시).
    return res.json({
      success: true,
      message: '정산서 메일이 발송되었습니다.',
      sent_to: sendTo,
      emailed_to: sendTo,
      emailed_at: emailedAt,
    });
  } catch (error: any) {
    console.error('정산서 메일 발송 오류:', error);
    return res.status(500).json({ error: '메일 발송에 실패했습니다: ' + error.message });
  }
});

// ============================================================
//  거래내역서 메일 발송 (리터럴 라우트 — /:id 보다 먼저!)
// ============================================================

// POST /invoices/:id/send-email - 거래내역서 PDF 메일 발송
router.post('/invoices/:id/send-email', async (req: Request, res: Response) => {
  try {
    const fs = require('fs');
    const path = require('path');

    // 1) 거래내역서 + 회사 정보 조회
    const result = await pool.query(
      `SELECT bi.*, c.company_name, c.contact_email, c.contact_name
       FROM billing_invoices bi
       JOIN companies c ON c.id = bi.company_id
       WHERE bi.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '거래내역서를 찾을 수 없습니다' });
    }
    const inv = result.rows[0];

    if (!inv.contact_email) {
      return res.status(400).json({ error: '고객사 담당자 이메일이 등록되어 있지 않습니다.' });
    }

    // 2) PDF 파일 확인
    const pdfDir = path.join(__dirname, '../../pdfs');
    const bStart = toDayKey(inv.billing_start);
    const bEnd = toDayKey(inv.billing_end);
    const pdfFilename = `invoice_${inv.id.slice(0, 8)}_${bStart}_${bEnd}.pdf`;
    const pdfPath = path.join(pdfDir, pdfFilename);

    if (!fs.existsSync(pdfPath)) {
      return res.status(400).json({ error: 'PDF가 아직 생성되지 않았습니다. 먼저 PDF를 다운로드해주세요.' });
    }

    const n = (v: any) => Number(v) || 0;

    // 3) 메일 발송
    const htmlBody = `
      <div style="font-family: 'Apple SD Gothic Neo', sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #4338ca, #6366F1); padding: 24px; border-radius: 12px 12px 0 0;">
          <h2 style="color: white; margin: 0; font-size: 20px;">📋 거래내역서 안내</h2>
          <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 14px;">${inv.company_name}${inv.store_name ? ` / ${inv.store_name}` : ''} | ${bStart} ~ ${bEnd}</p>
        </div>
        <div style="background: #ffffff; padding: 24px; border: 1px solid #E5E7EB; border-top: none;">
          <p style="font-size: 14px; color: #374151; margin: 0 0 16px;">
            안녕하세요, ${inv.contact_name || inv.company_name} 담당자님.<br/>
            <strong>${bStart} ~ ${bEnd}</strong> 기간 거래내역서를 안내드립니다.
          </p>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 16px;">
            ${n(inv.sms_success_count) > 0 ? `<tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 8px 0; color: #6B7280;">SMS</td>
              <td style="padding: 8px 0; text-align: right;">${n(inv.sms_success_count).toLocaleString()}건</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">₩${(n(inv.sms_success_count) * n(inv.sms_unit_price)).toLocaleString()}</td>
            </tr>` : ''}
            ${n(inv.lms_success_count) > 0 ? `<tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 8px 0; color: #6B7280;">LMS</td>
              <td style="padding: 8px 0; text-align: right;">${n(inv.lms_success_count).toLocaleString()}건</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">₩${(n(inv.lms_success_count) * n(inv.lms_unit_price)).toLocaleString()}</td>
            </tr>` : ''}
            ${n(inv.mms_success_count) > 0 ? `<tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 8px 0; color: #6B7280;">MMS</td>
              <td style="padding: 8px 0; text-align: right;">${n(inv.mms_success_count).toLocaleString()}건</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">₩${(n(inv.mms_success_count) * n(inv.mms_unit_price)).toLocaleString()}</td>
            </tr>` : ''}
            ${n(inv.spam_filter_count) > 0 ? `<tr style="border-bottom: 1px solid #F3F4F6; background: #FEF3C7;">
              <td style="padding: 8px 0; color: #6B7280;">스팸필터</td>
              <td style="padding: 8px 0; text-align: right;">${n(inv.spam_filter_count).toLocaleString()}건</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">₩${(n(inv.spam_filter_count) * n(inv.spam_filter_unit_price)).toLocaleString()}</td>
            </tr>` : ''}
          </table>
          <div style="background: #EEF2FF; padding: 16px; border-radius: 8px; text-align: right;">
            <span style="font-size: 13px; color: #6B7280;">공급가액 ₩${n(inv.subtotal).toLocaleString()} + VAT ₩${n(inv.vat).toLocaleString()}</span><br/>
            <span style="font-size: 20px; font-weight: 700; color: #4338CA;">합계 ₩${n(inv.total_amount).toLocaleString()}</span>
          </div>
          <p style="font-size: 13px; color: #9CA3AF; margin-top: 16px;">
            상세 내역은 첨부된 PDF를 확인해주세요.<br/>
            문의사항이 있으시면 ${INVITO_INFO.phone}로 연락 부탁드립니다.
          </p>
        </div>
        <div style="padding: 16px; text-align: center; font-size: 11px; color: #9CA3AF; border: 1px solid #E5E7EB; border-top: none; border-radius: 0 0 12px 12px; background: #F9FAFB;">
          본 메일은 INVITO 한줄로 시스템에서 자동 발송되었습니다.
        </div>
      </div>
    `;

    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"INVITO 정산" <${process.env.SMTP_USER}>`,
      to: inv.contact_email,
      bcc: process.env.SMTP_BCC || '',
      subject: `[INVITO] ${inv.company_name}${inv.store_name ? ` (${inv.store_name})` : ''} 거래내역서 (${bStart} ~ ${bEnd})`,
      html: htmlBody,
      attachments: [{ filename: pdfFilename, path: pdfPath }],
    });

    // 4) 발송 기록
    await pool.query(
      'UPDATE billing_invoices SET email_sent_at = now(), updated_at = now() WHERE id = $1',
      [req.params.id]
    );

    return res.json({ message: '거래내역서 메일이 발송되었습니다.', sent_to: inv.contact_email });
  } catch (error: any) {
    console.error('거래내역서 메일 발송 오류:', error);
    return res.status(500).json({ error: '메일 발송에 실패했습니다: ' + error.message });
  }
});

export default router;
