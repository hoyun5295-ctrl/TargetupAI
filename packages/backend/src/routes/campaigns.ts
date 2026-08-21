import { randomUUID } from 'crypto';
import { Request, Response, Router } from 'express';
import { mysqlQuery, query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { extractVarCatalog, validatePersonalizationVars, VarCatalogEntry } from '../services/ai';
import { buildGenderFilter, buildGradeFilter, buildRegionFilter, getRegionVariants } from '../utils/normalize';
import { getSourceRef, logTrainingData, updateTrainingMetrics } from '../utils/training-logger';
// ★ 2026-07-03 Gap5 Layer2: 고객별 발송 카운터 (예측 분모 전용 — 타겟 선정 무관)
import { recordCustomerSends } from '../utils/customer-send-stats';
import { replaceVariables, enrichWithCustomFields, getOpt080Number, buildAdMessage, prepareFieldMappings, prepareSendMessage, stripAdParts } from '../utils/messageUtils';
import { SUCCESS_CODES, PENDING_CODES, isSuccess, isFail, SPAM_RESULT } from '../utils/sms-result-map';
import { DEFAULT_COSTS, getCompanyCosts, redis, CACHE_TTL, BATCH_SIZES, SEND_HOURS } from '../config/defaults';
import { isValidSmsTable } from '../utils/sms-table-validator';
import { normalizePhone } from '../utils/normalize-phone';
import { isValidCustomFieldKey } from '../utils/safe-field-name';
import { convertButtonsToQTmsg } from '../utils/alimtalk-button';
import { buildAlimtalkEtcJson } from '../utils/alimtalk-emphasize';
import { decideKakaoTemplateSendable, getImcTemplateStatusSafe } from '../utils/kakao-template-guard';
import { getStoreScope } from '../utils/store-scope';
import { CAMPAIGN_OPT080_SELECT_EXPR, CAMPAIGN_OPT080_LEFT_JOIN } from '../utils/unsubscribe-helper';
// ★ 메시징 컨트롤타워 import
import {
  toKoreaTimeStr,
  getCompanySmsTables, hasCompanyLineGroup, getTestSmsTables, getAuthSmsTable,
  invalidateLineGroupCache, getNextSmsTable,
  smsCountAll, smsAggAll, smsSelectAll, smsMinAll, smsExecAll,
  getCompanySmsTablesWithLogs, getCampaignQueueTables,
  insertBrandQueue, BrandQueueInsertError, type BrandQueueRow,
  bulkInsertSmsQueue, insertAlimtalkQueue, AlimtalkQueueInsertError, toQtmsgType, insertTestSmsQueue
} from '../utils/sms-queue';
// ★ 2026-07-30 브랜드 msg_contents 조립·대체발송 매핑은 CT-12에서만 — 라우트 인라인 금지
import { buildBrandQueuePayload, resolveBrandFallback, resolveBrandCallback } from '../utils/brand-message';
import { prepaidDeduct, prepaidRefund, REFUND_KEYS } from '../utils/prepaid';
// ★ 2026-07-29 브랜드메시지 판정은 CT 하나에서만 한다 — 채널 리터럴을 라우트에 다시 적으면
//   집계(일자·상세)와 차감·환불이 서로 다른 기준을 갖게 되고, 그 차이가 곧 미청구나 발행 차단이다.
import { isBrandOnlyChannel, resolveRefundAxes, resolveSendChannel, resolveChargeMessageType } from '../utils/billing-types';
import { markRefundPending, markRefundPendingAxes } from '../utils/refund-pending';
// ★ 2026-07-30 (2R): 테스트 경로 환불 미완 경보 — 캠페인 레코드가 없어 durable 의무 대신 사람 호출
import { sendSystemAlert } from '../utils/system-alert';
import { normalizeMmsImagePaths, type MmsImageItem } from '../utils/mms-image-util';
import { validateMmsPayload } from '../utils/mms-validator';
import { buildDateRangeFilter, getCampaignResultCounts, aggregateSmsSendTimesByCampaign } from '../utils/stats-aggregation';
import { cancelCampaign, syncCampaignResults, cleanupScheduledCampaigns, failCampaignRun } from '../utils/campaign-lifecycle';
import { buildFilterQueryCompat } from '../utils/customer-filter';
import { findUnfilledAlimtalkVars, fillAlimtalkVarMap } from '../utils/alimtalk-vars';
import { resolveAlimtalkFallback, validateAlimtalkFallback } from '../utils/alimtalk-fallback';
import { filterByIndividualCallback, buildCallbackErrorResponse, buildCallbackConfirmResponse, resolveCustomerCallback } from '../utils/callback-filter';
// ★ 2026-07-05: 발송 피로도 보호 — 회사 opt-in "최근 N일 광고 M건" 게이트(차감 전 제외) + 광고 발송 카운터
import { getFatigueCap, getFatigueBlockedSet, recordFatigueSends } from '../utils/fatigue-guard';
import { deduplicateByPhone } from '../utils/deduplicate';
import { getUserTestContacts } from '../utils/test-contact-helper';
import { validateScheduledAt } from '../utils/campaign-validation';
import { calcSplitSendTime } from '../utils/send-time-util';
import { countStagingFiltered, createDirectSendCampaign } from '../utils/direct-send-core';
import { DirectSendError } from '../utils/direct-send-spec';
import { hasUneditedLinkPlaceholder, LINK_PLACEHOLDER } from '../utils/brand-link-core';
import { isDirectPipelineSendType } from '../utils/send-type-axis';

// ★ toKoreaTimeStr → utils/sms-queue.ts로 이동 (import 사용)

/**
 * ★ C3: 분할발송 시간 계산 (오버플로우 방지)
 * batchIndex분 만큼 baseTime에서 앞으로 밀되,
 * SEND_HOURS.end를 초과하면 다음날 SEND_HOURS.start로 이월
 *
 * @param baseTime - 발송 시작 시간
 * @param batchIndex - 현재 배치 인덱스 (0부터)
 * @param sendStartHour - 발송 시작 시각 (회사별 또는 기본값)
 * @param sendEndHour - 발송 종료 시각 (회사별 또는 기본값)
 * @returns 조정된 발송 시간
 */
// calcSplitSendTime → utils/send-time-util.ts로 이동 (2026-05-30 worker 공용, import 사용)

// ★ GP-04: MySQL TZ는 database.ts의 mysqlQuery 헬퍼에서 매 커넥션마다 자동 설정
// (커넥션 풀 전체 보장 — 단일 SET으로는 1개 커넥션에만 적용되므로 제거)

// ★ 라인그룹/MySQL 큐/카카오/선불 함수 → utils/sms-queue.ts, utils/prepaid.ts로 이동 (import 사용)
// ★ 캠페인 취소/결과동기화 → utils/campaign-lifecycle.ts로 이동 (import 사용)

const router = Router();

router.use(authenticate);

// GET /api/campaigns - 캠페인 목록 (캘린더용)
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const companyTables = await getCompanySmsTables(companyId, userId);
    const { status, page = 1, limit = 20, year, month } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let whereClause = 'WHERE company_id = $1';
    const params: any[] = [companyId];
    let paramIndex = 2;

    // ★ D120: 미확정 draft는 DELETE되므로 sent_count=0 제외 조건 불필요. cancelled 전부 표시.
    if (!status) {
      whereClause += ` AND status NOT IN ('draft')`;
    }

    // 일반 사용자는 본인이 만든 캠페인만
    if (userType === 'company_user' && userId) {
      whereClause += ` AND created_by = $${paramIndex++}`;
      params.push(userId);
    }

    // 고객사 관리자: 특정 사용자 필터
    if (userType === 'company_admin' && req.query.filter_user_id) {
      whereClause += ` AND created_by = $${paramIndex++}`;
      params.push(req.query.filter_user_id);
    }

    if (status) {
      // ★ D227+ (2026-05-28): cleanupScheduledCampaigns 동기 호출 제거 — 6만건 안 30~40초 사고 정정.
      //   = utils/scheduled-cleanup-worker.ts 안 1분 cron 영역 통합 (app.ts:startScheduledCleanupWorker).
      //   옛 응답 직전 동기 cleanup 영역 → 백그라운드 worker 영역 진행 = 응답 영역 즉시.
      whereClause += ` AND status = $${paramIndex++}`;
      params.push(status);
    }

    // 월별 필터링 (캘린더용) - 이벤트 기간도 포함
    if (year && month) {
      const monthStart = `${year}-${month}-01`;
      const monthEnd = `${year}-${month}-${new Date(Number(year), Number(month), 0).getDate()}`;

      whereClause += ` AND (
        DATE_TRUNC('month', scheduled_at) = $${paramIndex}::date
        OR DATE_TRUNC('month', created_at) = $${paramIndex}::date
        OR (event_start_date <= $${paramIndex + 1}::date AND event_end_date >= $${paramIndex}::date)
      )`;
      params.push(monthStart, monthEnd);
      paramIndex += 2;
    }

    // count 쿼리용 파라미터 복사
    const countParams = [...params];

    const tPg0 = Date.now(); // ★ 2026-07-17 구간 계측 (PG 카운트+목록)
    const countResult = await query(
      `SELECT COUNT(*) FROM campaigns ${whereClause}`,
      countParams
    );
    const total = parseInt(countResult.rows[0].count);

    params.push(Number(limit), offset);
    // ★ B2: opt_out_080_number 포함을 위해 alias 'c' + LEFT JOIN
    const aliasedWhereClause = whereClause
      .replace(/\bcompany_id\b/g, 'c.company_id')
      .replace(/\bstatus\b/g, 'c.status')
      .replace(/\bcreated_by\b/g, 'c.created_by')
      .replace(/\bscheduled_at\b/g, 'c.scheduled_at')
      .replace(/\bcreated_at\b/g, 'c.created_at')
      .replace(/\bevent_start_date\b/g, 'c.event_start_date')
      .replace(/\bevent_end_date\b/g, 'c.event_end_date');
    // ★ D144: PG c.sent_count/success_count/fail_count 캐시 의존 제거.
    //   페이지된 캠페인을 PG에서 메타만 SELECT → MySQL 큐 + 카카오 직접 카운트 매핑.
    const result = await query(
      `SELECT
        c.id, c.company_id, c.created_by, c.campaign_name, c.status, c.message_type, c.send_type,
        -- ★ 2026-07-31 send_channel 동반. 이 응답을 쓰는 화면(최근 캠페인·캘린더)이 채널 판정 CT를
        --   호출하는데 값이 없으면 message_type('LMS')으로 폴백해 알림톡·브랜드가 LMS로 보인다.
        c.send_channel,
        c.target_count,
        c.scheduled_at, c.sent_at, c.created_at,
        TO_CHAR(c.event_start_date, 'YYYY-MM-DD') as event_start_date,
        TO_CHAR(c.event_end_date, 'YYYY-MM-DD') as event_end_date,
        c.message_content, c.message_template, c.subject, c.message_subject, c.is_ad, c.callback_number,
        c.mms_image_paths,
        c.send_config, c.result_final, c.sent_count, c.success_count, c.fail_count,
        ${CAMPAIGN_OPT080_SELECT_EXPR}
       FROM campaigns c
       ${CAMPAIGN_OPT080_LEFT_JOIN}
       ${aliasedWhereClause}
       ORDER BY c.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      params
    );
    if (Date.now() - tPg0 >= 300) {
      console.log(`[SLOW-STAGE] /campaigns PG 카운트+목록 — ${Date.now() - tPg0}ms company=${companyId}`);
    }

    // ★ 2026-07-17 성능(SLOW 2,960ms 실측) — 독립 집계 3개 중 2개(SMS 카운트·카카오)를 병렬, 발송시각은 후속.
    //   각 함수·쿼리·산식 무접촉, 실행 시점만 조정. ★ Codex 정정: 셋 다 MySQL 공용 풀(limit 10 — 발송 INSERT와
    //   공유)이라 3개 완전 병렬은 대시보드 1진입(목록 3콜+stats)만으로 풀 포화(3×3+2=11>10) → 요청당 동시 2 상한.
    // ★ 2026-07-17 구간 계측 — 병렬화 후에도 3,052ms 실측(개선 0) = 지배 구간이 따로 있다는 뜻.
    //   SQL·인덱스(app_etc1)는 실측 정상이라, 어느 구간이 먹는지 로그로 확정 후 수정(추측 수정 금지). 응답 무변경.
    const tAgg0 = Date.now();
    // ★ 2026-07-17(2) — 카운트 단일 진입점 합류: 확정(result_final)=PG 캐시, 진행 중만 MySQL 실시간.
    //   getCampaignResultCounts = 발송결과·발송통계·관리자 화면과 동일 소스(SMS+카카오 합산 완료값).
    //   진행 중 잔여분은 CT 내부 집계가 send_config(sentTables) 라인 축 축소를 그대로 탄다.
    const listCountMap = await getCampaignResultCounts(result.rows);
    const tAgg1 = Date.now();
    const listSentTimeMap = await aggregateSmsSendTimesByCampaign(result.rows);
    const tAgg2 = Date.now();
    if (tAgg2 - tAgg0 >= 300) {
      console.log(`[SLOW-STAGE] /campaigns 목록 집계 — counts=${tAgg1 - tAgg0}ms sendTimes=${tAgg2 - tAgg1}ms n=${result.rows.length} status=${status || 'all'} company=${companyId}`);
    }

    // ★ D144 P4/P7 후속 (2026-05-07): 사용자 캠페인 목록에서도 status='sending' 자동 정리
    //   Dashboard 진입 시 fire-and-forget sync-results가 호출되지만, 사용자가 캠페인 목록만 보고
    //   Dashboard 안 들어갈 수 있음. 목록 조회 시점에도 MySQL 결과 도착(pending=0 + success/fail>0) 시
    //   PG status를 'completed'로 자동 정리.
    const userAutoCompleteIds: string[] = [];
    const campaigns = result.rows.map((c: any) => {
      const counts = listCountMap.get(c.id) || { sent: 0, success: 0, fail: 0, pending: 0 };
      const totalSuccess = counts.success;
      const totalFail = counts.fail;
      const totalPending = counts.pending;
      let effectiveStatus = c.status;
      if (c.status === 'sending' && totalPending === 0 && (totalSuccess > 0 || totalFail > 0)) {
        effectiveStatus = 'completed';
        userAutoCompleteIds.push(c.id);
      }
      // ★ 2026-07-17: send_config·result_final은 집계 전용 내부 데이터 — 응답에 미노출(현행 응답 형태 유지.
      //   sent/success/fail_count는 지금도 계산값으로 덮어쓰는 자리라 raw 컬럼 추가의 응답 영향 0)
      const { send_config: _sendConfig, result_final: _resultFinal, ...rest } = c;
      return {
        ...rest,
        status: effectiveStatus,
        sent_count: counts.sent,
        success_count: totalSuccess,
        fail_count: totalFail,
        sent_at: listSentTimeMap.get(c.id) ?? c.sent_at,
      };
    });

    // 백그라운드 fire-and-forget으로 PG status UPDATE
    if (userAutoCompleteIds.length > 0) {
      query(
        `UPDATE campaigns SET status = 'completed', updated_at = NOW()
         WHERE id = ANY($1::uuid[]) AND status = 'sending'`,
        [userAutoCompleteIds]
      ).catch((e) => console.warn('[campaigns] sending→completed 자동 정리 실패:', e?.message));
    }

    return res.json({
      campaigns,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('캠페인 목록 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/campaigns/test-send - 담당자 사전수신 (테스트 발송)
router.post('/test-send', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    // ★ B16-01: 브랜드 격리 — store-scope 컨트롤타워
    let storeFilter = '';
    let storeParams: any[] = [];

    if (userType === 'company_user' && userId) {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'filtered') {
        storeFilter = ' AND c.id IN (SELECT customer_id FROM customer_stores WHERE company_id = c.company_id AND store_code = ANY($STORE_IDX::text[]))';
        storeParams = [scope.storeCodes];
      } else if (scope.type === 'blocked') {
        return res.status(403).json({ error: '소속 브랜드가 지정되지 않았습니다. 관리자에게 문의하세요.' });
      }
    }

    const { messageContent, messageType, isAd } = req.body;
    if (!messageContent) {
      return res.status(400).json({ error: '메시지 내용이 필요합니다.' });
    }

    // ★ D131: MMS 이미지 첨부 필수 가드 — mms-validator 컨트롤타워 (9007 파일 오류 방지)
    const testMmsCheck = validateMmsPayload(messageType, req.body.mmsImagePaths);
    if (!testMmsCheck.ok) {
      return res.status(400).json({ error: testMmsCheck.error, code: testMmsCheck.code });
    }

    // 테스트 채널 (기본 sms)
    const testChannel = req.body.sendChannel || 'sms';
    const testKakaoSenderKey = req.body.kakaoSenderKey || '';
    const testKakaoBubbleType = req.body.kakaoBubbleType || 'TEXT';

    // ★ 카카오 활성화 체크 (프론트 우회 방지)
    if (testChannel === 'kakao' || testChannel === 'both') {
      const kakaoCheck = await query('SELECT kakao_enabled FROM companies WHERE id = $1', [companyId]);
      if (!kakaoCheck.rows[0]?.kakao_enabled) {
        return res.status(403).json({ error: '카카오 브랜드메시지가 활성화되지 않은 고객사입니다.', code: 'KAKAO_NOT_ENABLED' });
      }
    }

    // 회사 설정에서 스키마 가져오기
    const companyResult = await query(
      'SELECT customer_schema FROM companies WHERE id = $1',
      [companyId]
    );

    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: '회사 정보를 찾을 수 없습니다.' });
    }

    // ★ 미리보기와 동일한 고객으로 개인화 — 프론트에서 sampleCustomer 전달 시 그대로 사용
    // ★ D102: prepareFieldMappings 컨트롤타워로 통합 (customer_schema 조회 + extractVarCatalog + enrichWithCustomFields)
    const testFieldMappings = await prepareFieldMappings(companyId);

    let testFirstCustomer: Record<string, any>;
    if (req.body.sampleCustomer && typeof req.body.sampleCustomer === 'object' && Object.keys(req.body.sampleCustomer).length > 0) {
      // 프론트에서 미리보기에 사용한 샘플 고객 그대로 사용 (미리보기 = 테스트발송 = 스팸테스트 동일 보장)
      testFirstCustomer = req.body.sampleCustomer;
    } else {
      // 폴백: DB에서 조회 (sampleCustomer 미전달 시)
      const testMappingCols = Object.values(testFieldMappings).filter((m: any) => m.storageType !== 'custom_fields').map((m: any) => m.column);
      const testSelectCols = [...new Set(['phone', 'custom_fields', ...testMappingCols])].join(', ');
      const testFirstCustomerResult = await query(
        `SELECT ${testSelectCols} FROM customers WHERE company_id = $1 AND is_active = true AND sms_opt_in = true ORDER BY name ASC NULLS LAST LIMIT 1`,
        [companyId]
      );
      testFirstCustomer = testFirstCustomerResult.rows[0] || {};
    }

    // 회신번호 가져오기 (callback_numbers 테이블에서)
    const callbackResult = await query(
      'SELECT phone FROM callback_numbers WHERE company_id = $1 AND is_default = true LIMIT 1',
      [companyId]
    );
    const callbackNumber = normalizePhone(callbackResult.rows[0]?.phone || '');
    if (!callbackNumber) {
      return res.status(400).json({ error: '기본 회신번호가 설정되지 않았습니다. 회사 설정에서 기본 회신번호를 등록해주세요.', code: 'NO_DEFAULT_CALLBACK' });
    }

    // ★ D97: CT-11 컨트롤타워로 담당자 조회 (사용자별 격리)
    const managerContacts = await getUserTestContacts(companyId, userId!);

    if (managerContacts.length === 0) {
      return res.status(400).json({ error: '등록된 담당자 번호가 없습니다. 설정에서 번호를 추가해주세요.' });
    }

    // ★ 선불 잔액 체크 — ★ 2026-07-30 적대검증 수용: 차감 축을 채널로 가른다.
    //   kakao=BRAND 단일 / both=문자(messageType)+BRAND 이중 / sms=messageType.
    //   옛 코드는 both 브랜드분이 무료였고, kakao 단독은 문자 단가로 깎였다.
    const testMsgType = (messageType || 'SMS') as string;
    const TEST_REF = '00000000-0000-0000-0000-000000000000';
    const testAxes = resolveRefundAxes(testChannel, testMsgType);
    const testDeductedTypes: string[] = [];
    for (const axis of testAxes) {
      const testDeduct = await prepaidDeduct(companyId, managerContacts.length, axis.type, TEST_REF, userId, 'test');
      if (!testDeduct.ok) {
        for (const doneType of testDeductedTypes) {
          // ★ 2026-07-30 (2R): 보상은 ok까지 확인한다. 이 경로는 의무를 붙일 캠페인 레코드가 없으므로
          //   (전 건 zero-uuid 공유 — B-0727-2 ⑥ 기존 계약) 실패는 경보+로그로 사람이 수동 정산한다.
          try {
            const rev = await prepaidRefund(companyId, managerContacts.length, doneType, TEST_REF, `${axis.type} 차감 실패로 ${doneType} 차감분 회수`, 'test', { refundKey: REFUND_KEYS.TEST });
            if (!rev.ok) {
              console.error(`[테스트발송][보상미완] company=${companyId} ${doneType} ${managerContacts.length}건 — 수동 환불 필요`);
              void sendSystemAlert({ dedupKey: `test-refund-miss:${companyId}:${doneType}`, message: `테스트 발송 보상 환불 미완 — company=${companyId} ${doneType} ${managerContacts.length}건 수동 확인 필요` });
            }
          } catch (revertErr) {
            console.error(`[테스트발송][보상실패] ${doneType} ${managerContacts.length}건 회수 실패:`, revertErr);
            void sendSystemAlert({ dedupKey: `test-refund-miss:${companyId}:${doneType}`, message: `테스트 발송 보상 환불 실패 — company=${companyId} ${doneType} ${managerContacts.length}건 수동 확인 필요` });
          }
        }
        return res.status(402).json({ error: testDeduct.error, insufficientBalance: true, balance: testDeduct.balance, requiredAmount: testDeduct.amount });
      }
      testDeductedTypes.push(axis.type);
    }

    // 담당자별로 테스트 전용 라인으로 INSERT
    const testTables = await getTestSmsTables();
    const msgType = toQtmsgType(messageType || 'SMS');
    // ★ D124 N4: mmsImagePaths 객체 배열 허용 (frontend가 {path, originalName} 전송)
    //   - DB 저장: 객체 배열 그대로 JSONB로 저장 (originalName 표시 용도)
    //   - QTmsg INSERT: normalizeMmsImagePaths로 절대경로만 추출
    const mmsImagePathsRaw: MmsImageItem[] = req.body.mmsImagePaths || [];
    const mmsImagePaths: string[] = normalizeMmsImagePaths(mmsImagePathsRaw);
    // ★ D100: bill_id에 userId 저장 (사용자별 테스트 결과 필터 + 사용금액 격리)
    //   기존 testBillId 사용 → 결과 조회 시 bill_id=userId 필터와 불일치 → company_user 결과 미표시
    const testBillId = userId || '';
    let sentCount = 0;
    let testSmsSent = 0;    // 문자 축 적재수 (sms/both)
    let testBrandSent = 0;  // 브랜드 축 적재수 (kakao/both)
    const failedContacts: { phone: string; error: string }[] = [];

    // ★ D103: 테스트발송도 백엔드에서 (광고)+080 추가 (전 경로 동일 원칙)
    const testOpt080 = isAd ? await getOpt080Number(userId || null, companyId) : '';

    for (const contact of managerContacts) {
      const cleanPhone = normalizePhone(contact.phone);
      let contactOk = true;
      let contactErr = '';
      try {
        // ★ D103: prepareSendMessage 컨트롤타워 — 변수 치환 + (광고)+080 + ★ KISA 2026-05 제목(광고) 통합
        const { message: testMsg, subject: testSubject } = prepareSendMessage(messageContent, testFirstCustomer, testFieldMappings, {
          msgType: messageType || 'SMS', isAd: isAd || false, opt080Number: testOpt080,
          subject: req.body.subject || '',
        });

        if (testChannel === 'sms' || testChannel === 'both') {
          try {
            // ★ D103: insertTestSmsQueue 컨트롤타워 사용 (인라인 INSERT 제거)
            await insertTestSmsQueue(cleanPhone, callbackNumber, testMsg, messageType || 'SMS', 'test', testSubject, {
              companyId, billId: testBillId, mmsImages: mmsImagePaths,
            });
            testSmsSent++;
          } catch (smsErr) {
            contactOk = false;
            contactErr = smsErr instanceof Error ? smsErr.message : String(smsErr);
          }
        }

        if (testChannel === 'kakao' || testChannel === 'both') {
          try {
            // 브랜드메시지 테스트 발송 — SMSQ msg_type='F' (★2026-08-15 규약 정정: 본문/제어 필드 분리 조립)
            // sendAt 미지정 = 즉시 발송 — 조립기가 현재 시각으로 발송 가능 시간을 판정한다.
            const testBrandPayload = buildBrandQueuePayload({
              typeDef: 'FREE', senderKey: testKakaoSenderKey, targeting: 'I',
              bubbleType: testKakaoBubbleType, isAd: isAd || false, message: testMsg,
            });
            await insertBrandQueue(testTables, [{
              phone: cleanPhone,
              callback: callbackNumber,
              msgContents: testBrandPayload.msgContents,
              etcJson: testBrandPayload.etcJson,
              nextType: 'N',  // 테스트는 대체발송 안함
              companyId,
            }], testBillId);
            testBrandSent++;
          } catch (brandErr) {
            contactOk = false;
            contactErr = brandErr instanceof Error ? brandErr.message : String(brandErr);
          }
        }
      } catch (err) {
        contactOk = false;
        contactErr = err instanceof Error ? err.message : String(err);
      }
      if (contactOk) {
        sentCount++;
      } else {
        console.error(`담당자 테스트 발송 실패 (${contact.phone}):`, contactErr);
        failedContacts.push({ phone: contact.phone, error: contactErr });
      }
    }

    // ★ P0-3: 테스트 발송 실패건 환불 — ★ 2026-07-30: 차감과 같은 축으로, 축별 실제 미적재분만 돌려준다.
    //   (옛 코드는 both에서 한 채널만 실패해도 유일한 차감 전체를 환불해 성공 발송이 무료가 됐다.)
    // ⚠ 이 경로는 전 건이 고정 zero-uuid를 reference로 공유한다(기존 결함, B-0727-2 ⑥). 키를 달아 다른 원인과
    //   섞이지는 않게 하되, 요청별 고유 reference로 바꾸는 것은 별도 과제로 남는다.
    for (const axis of testAxes) {
      const axisSent = axis.scope === 'brand' ? testBrandSent
        : axis.scope === 'nonBrand' ? testSmsSent
        : (testChannel === 'kakao' ? testBrandSent : testSmsSent);
      const axisFail = managerContacts.length - axisSent;
      if (axisFail > 0) {
        // ★ 2026-07-30 (2R): ok 확인 — 실패는 경보+로그(캠페인 레코드가 없어 durable 의무 불가, 수동 정산)
        try {
          const refundRes = await prepaidRefund(companyId, axisFail, axis.type, TEST_REF, '테스트 발송 실패 자동 환불', 'test', { refundKey: REFUND_KEYS.TEST });
          if (!refundRes.ok) {
            console.error(`[테스트발송][환불미완] company=${companyId} ${axis.type} ${axisFail}건 — 수동 환불 필요`);
            void sendSystemAlert({ dedupKey: `test-refund-miss:${companyId}:${axis.type}`, message: `테스트 발송 실패 환불 미완 — company=${companyId} ${axis.type} ${axisFail}건 수동 확인 필요` });
          }
        } catch (refundErr) {
          console.error(`[테스트발송][환불오류] company=${companyId} ${axis.type} ${axisFail}건:`, refundErr);
          void sendSystemAlert({ dedupKey: `test-refund-miss:${companyId}:${axis.type}`, message: `테스트 발송 실패 환불 오류 — company=${companyId} ${axis.type} ${axisFail}건 수동 확인 필요` });
        }
      }
    }

    // ★ C5: 실패 건 DB 기록 (비동기, 발송 응답에 영향 없음)
    if (failedContacts.length > 0) {
      try {
        await query(
          `INSERT INTO campaign_runs (campaign_id, run_number, target_count, sent_count, status, created_at)
           VALUES ($1, 0, $2, $3, 'failed', NOW())`,
          [testBillId, managerContacts.length, sentCount]
        );
      } catch (logErr) {
        console.error('[테스트발송] 실패 기록 저장 오류 (발송에는 영향 없음):', logErr);
      }
    }

    return res.json({
      message: `담당자 ${sentCount}명에게 테스트 문자를 발송했습니다.`,
      sentCount,
      // ★ C5: 추적 ID — 프론트에서 결과 조회 시 사용
      testBillId,
      contacts: managerContacts.map(c => ({
        name: c.name || '이름없음',
        phone: `${normalizePhone(c.phone).slice(0, 3)}-****-${normalizePhone(c.phone).slice(-4)}`
      })),
    });
  } catch (error) {
    console.error('담당자 사전수신 에러:', error);
    return res.status(500).json({ error: '테스트 발송에 실패했습니다.' });
  }
});

// POST /api/campaigns - 캠페인 생성
router.post('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;

    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const {
      campaignName,
      messageType,
      targetFilter,
      messageContent,
      subject,
      scheduledAt,
      isAd,
      eventStartDate,
      eventEndDate,
      mmsImagePaths,
      // 카카오 브랜드메시지 필드
      sendChannel,          // sms / kakao / both
      kakaoBubbleType,      // TEXT, IMAGE, WIDE 등
      kakaoSenderKey,       // 발신 프로필 키
      kakaoTargeting,       // I/M/N
      kakaoAttachmentJson,  // 버튼/이미지 JSON
      kakaoCarouselJson,    // 캐러셀 JSON
      kakaoResendType,      // SM/LM/NO
      // ★ B8-04: 회신번호 필드
      callback,               // 공통 회신번호
      useIndividualCallback,  // 개별회신번호 사용 여부
      individualCallbackColumn,  // ★ D99: 회신번호로 사용할 컬럼명
    } = req.body;

    if (!campaignName || !messageType || !messageContent) {
      return res.status(400).json({ error: '필수 항목을 입력하세요.' });
    }

    // ★ 2026-08-17 발송 채널·메시지 유형 확정 — 여기서 저장한 값을 `/campaigns/:id/send`가 그대로
    //   읽어 차감한다. 생성 시점에 안 막으면 미지원 값이 DB에 남아 발송 시점에 차감만 되고 적재는 0건이 된다.
    //   파이프라인은 `campaign`(적재 분기 sms·both / kakao·both) — 이 캠페인이 나갈 문이다.
    //   ⚠ 아래에서 **resolver가 돌려준 값만** 쓴다. 원본을 다시 쓰면 배열·공백이 그대로 흘러간다.
    const createChannel = resolveSendChannel('campaign', sendChannel);
    if (!createChannel.ok) {
      console.warn(`[캠페인 생성] 발송 채널 거절 — company=${companyId} raw=${JSON.stringify(sendChannel)} reason=${createChannel.reason}`);
      return res.status(400).json({ error: createChannel.reason, code: 'UNSUPPORTED_SEND_CHANNEL' });
    }
    // 메시지 유형은 채널과 **별개 축**이라 채널 게이트로는 안 걸린다. 목록 밖 유형은 단가표에 없어
    // `unknownType`으로 0원 통과(=무료 발송)가 되므로 저장 전에 확정한다.
    const createMsgType = resolveChargeMessageType(messageType);
    if (!createMsgType.ok) {
      console.warn(`[캠페인 생성] 메시지 유형 거절 — company=${companyId} raw=${JSON.stringify(messageType)} reason=${createMsgType.reason}`);
      return res.status(400).json({ error: createMsgType.reason, code: 'UNSUPPORTED_MESSAGE_TYPE' });
    }

    // ★ 2026-07-02 링크 placeholder 발송 가드 — 미완성 링크 자리 잔존 시 실발송 차단 (AI 캠페인/타겟 발송 경로)
    if (hasUneditedLinkPlaceholder(String(messageContent || ''))) {
      return res.status(400).json({
        error: `문안에 링크 자리(${LINK_PLACEHOLDER})가 비어 있습니다. 링크 삽입으로 URL을 넣거나 해당 줄을 지운 뒤 발송해주세요.`,
        code: 'LINK_PLACEHOLDER_UNEDITED',
      });
    }

    // ★ D143 (2026-05-04, 정식 오픈 D-Day 1일 전) — D142+ 자동 승격 정책 폐지
    //   정책 변경 사유 (Harold님 명시): 사용자가 광고체크 OFF + 본문에 (광고)/무료거부 복붙한
    //   케이스에서 D142+가 본문 깎고 is_ad 강제 승격 → 사용자 의도 무시 → 정합성 위반
    //   새 정책: 사용자 입력 본문 그대로 저장 + 광고체크 의도 그대로 저장
    //   변수명은 호환성 위해 유지 (sanitizedContent = 사용자 입력 그대로)
    const sanitizedContent = messageContent || '';  // ★ D143: sanitize 미적용 — 사용자 입력 보존
    const finalIsAdAi = isAd === true;               // ★ D143: 자동 승격 제거 — 사용자 광고체크 그대로

    // ★ D131: MMS 이미지 첨부 필수 가드 — mms-validator 컨트롤타워
    const aiMmsCheck = validateMmsPayload(messageType, mmsImagePaths);
    if (!aiMmsCheck.ok) {
      return res.status(400).json({ error: aiMmsCheck.error, code: aiMmsCheck.code });
    }

    // ★ D111 P4: 예약 시각 검증 — 컨트롤타워 validateScheduledAt (인라인 검증 금지)
    //   즉시발송(scheduledAt=null) 허용, 과거 차단, 최대 365일 미래 차단
    const schedCheck = validateScheduledAt(scheduledAt, { allowNull: true });
    if (!schedCheck.valid) {
      return res.status(400).json({ error: schedCheck.error });
    }

    // ★ B17-01 수정: 타겟 인원 계산 (sms_opt_in + 수신거부 제외 — user_id 기준)
    let targetCount = 0;
    if (targetFilter) {
      const filterQuery = buildFilterQueryCompat(targetFilter, companyId);
      const unsubIdx = 1 + filterQuery.params.length + 1;
      const countResult = await query(
        `SELECT COUNT(*) FROM customers c WHERE c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true ${filterQuery.where}
         AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubIdx} AND u.phone = c.phone)`,
        [companyId, ...filterQuery.params, userId]
      );
      targetCount = parseInt(countResult.rows[0].count);
    }

    const result = await query(
      `INSERT INTO campaigns (
        company_id, campaign_name, message_type, target_filter,
        message_content, subject, message_subject, message_template, scheduled_at, is_ad, target_count, created_by,
        event_start_date, event_end_date, mms_image_paths,
        send_channel, kakao_bubble_type, kakao_sender_key, kakao_targeting,
        kakao_attachment_json, kakao_carousel_json, kakao_resend_type,
        callback_number, use_individual_callback, individual_callback_column
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
      RETURNING *`,
      [
        companyId, campaignName, createMsgType.messageType, JSON.stringify(targetFilter),
        // ★ D142+ B1: sanitizedContent(D103 순수본문) + finalIsAdAi(자동 승격) 사용
        sanitizedContent, subject || null, subject || null, sanitizedContent, scheduledAt, finalIsAdAi, targetCount, userId,
        eventStartDate || null, eventEndDate || null,
        mmsImagePaths && mmsImagePaths.length > 0 ? JSON.stringify(mmsImagePaths) : null,
        createChannel.channel,
        kakaoBubbleType || null,
        kakaoSenderKey || null,
        kakaoTargeting || 'I',
        kakaoAttachmentJson || null,
        kakaoCarouselJson || null,
        kakaoResendType || 'SM',
        callback || null, useIndividualCallback || false,
        individualCallbackColumn || null
      ]
    );

    return res.status(201).json({
      message: '캠페인이 생성되었습니다.',
      campaign: result.rows[0],
    });
  } catch (error) {
    console.error('캠페인 생성 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/campaigns/:id/send - 캠페인 발송
router.post('/:id/send', async (req: Request, res: Response) => {
  // ★ 2026-08-17 (Codex 2R critical) 실행 행 id를 **최상위 catch에서도 볼 수 있게** 밖에 둔다.
  //   안쪽 `catch (sendError)`를 빠져나오는 오류(차감 함수 자체가 던지는 경우, 미수 등재 실패 등)는
  //   최상위 catch로 가는데 거기서 실행 행을 손대지 않으면 `status='sending'`이 남아
  //   그 캠페인의 이후 발송이 영구히 막힌다. 조기 return·안쪽 catch만 막으면 이 경로가 남는다.
  let campaignRunId: string | null = null;
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    const { id } = req.params;
    const { confirmCallbackExclusion } = req.body || {};

    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const companyTables = await getCompanySmsTables(companyId, userId);

    // ★ 1차 방어: 라인그룹 미설정 발송 차단
    if (!(await hasCompanyLineGroup(companyId))) {
      console.warn(`[라인방어] 캠페인 발송 차단 — companyId: ${companyId}, campaignId: ${id}, 라인그룹 미설정`);
      return res.status(400).json({
        error: '발송 라인그룹이 설정되지 않았습니다. 관리자에게 문의해주세요.',
        code: 'LINE_GROUP_NOT_SET'
      });
    }

    // 일반 사용자는 본인 store_codes에 해당하는 고객만
    // ★ B16-01: 브랜드 격리 — store-scope 컨트롤타워
    let storeFilter = '';
    const storeParams: any[] = [];

    if (userType === 'company_user' && userId) {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'filtered') {
        storeFilter = ' AND c.id IN (SELECT customer_id FROM customer_stores WHERE company_id = c.company_id AND store_code = ANY($STORE_IDX::text[]))';
        storeParams.push(scope.storeCodes);
      } else if (scope.type === 'blocked') {
        return res.status(403).json({ error: '소속 브랜드가 지정되지 않았습니다. 관리자에게 문의하세요.' });
      }
    }

    // 캠페인 조회
    const campaignResult = await query(
      'SELECT * FROM campaigns WHERE id = $1 AND company_id = $2',
      [id, companyId]
    );

    if (campaignResult.rows.length === 0) {
      return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
    }

    const campaign = campaignResult.rows[0];

    // ★ 2026-08-17 **채널·유형 확정을 이 라우트의 첫 검사로 둔다.**
    //   이 문(AI 캠페인 발송)의 적재는 `bulkInsertSmsQueue`(sms·both)와 `insertBrandQueue`(kakao·both)
    //   둘뿐이다 — **알림톡 적재 경로가 없다**(`insertAlimtalkQueue` 호출 0건, 실측).
    //   그런데 차감은 채널을 안 보고 먼저 일어나서, 이 문으로 들어온 알림톡 캠페인은
    //   차감만 되고 한 건도 안 나갔다. 그래서 목록(`campaign` 파이프라인)에서 제외하고 여기서 막는다.
    //   유형도 함께 확정한다 — 목록 밖 유형은 단가표에 없어 `unknownType`으로 **0원 통과**(무료 발송)한다.
    //   ⚠ 위치가 곧 안전성이다. 아래 `campaign_runs` INSERT는 실행 선점 표시라, 그 뒤에서 거절하면
    //     `status='sending'` 행이 남아 중복 발송 방지 검사가 이후 발송을 **영구히** 막는다
    //     (자동 청소 경로도 없다 — 적재 0건이라 결과 동기화 조건에 안 걸린다).
    const sendResolved = resolveSendChannel('campaign', campaign.send_channel);
    if (!sendResolved.ok) {
      console.warn(`[캠페인 발송] 발송 채널 거절 — campaign=${id} raw=${JSON.stringify(campaign.send_channel)} reason=${sendResolved.reason}`);
      return res.status(400).json({ error: sendResolved.reason, code: 'UNSUPPORTED_SEND_CHANNEL' });
    }
    const sendChannel = sendResolved.channel;

    const sendMsgTypeResolved = resolveChargeMessageType(campaign.message_type);
    if (!sendMsgTypeResolved.ok) {
      console.warn(`[캠페인 발송] 메시지 유형 거절 — campaign=${id} raw=${JSON.stringify(campaign.message_type)} reason=${sendMsgTypeResolved.reason}`);
      return res.status(400).json({ error: sendMsgTypeResolved.reason, code: 'UNSUPPORTED_MESSAGE_TYPE' });
    }

    // ★ 카카오 활성화 체크 (프론트 우회 방지) — 2026-08-17 run INSERT 앞으로 이동.
    //   여기서 걸리면 되돌릴 것 자체가 생기지 않는다.
    if (sendChannel === 'kakao' || sendChannel === 'both') {
      const kakaoCheck = await query('SELECT kakao_enabled FROM companies WHERE id = $1', [companyId]);
      if (!kakaoCheck.rows[0]?.kakao_enabled) {
        return res.status(403).json({ error: '카카오 브랜드메시지가 활성화되지 않은 고객사입니다.', code: 'KAKAO_NOT_ENABLED' });
      }
    }

    // ★ D91: LMS/MMS 제목 필수 검증
    //   (D224+ 2026-05-27의 알림톡 예외 분기는 2026-08-17 제거 — 위 게이트가 알림톡을 이미 막아
    //    이 지점에 도달할 수 없다. 도달 못 하는 분기를 남기면 다음 사람이 그 경로가 산다고 믿는다.)
    if ((campaign.message_type === 'LMS' || campaign.message_type === 'MMS') && !campaign.message_subject?.trim() && !campaign.subject?.trim()) {
      return res.status(400).json({ error: 'LMS/MMS 발송 시 제목을 입력해주세요.' });
    }

    // 기본 회신번호 조회 (callback_numbers 테이블에서)
    const callbackResult = await query(
      'SELECT phone FROM callback_numbers WHERE company_id = $1 AND is_default = true LIMIT 1',
      [companyId]
    );
    // campaign에 설정된 회신번호 우선, 없으면 기본 회신번호
    const defaultCallback = callbackResult.rows[0]?.phone;

    // 개별회신번호 사용 여부
    // ★ D100: use_individual_callback=true인데 individual_callback_column이 없으면 개별회신번호 비활성
    //   AI가 use_individual_callback=true를 반환했지만 사용자가 컬럼을 지정 안 한 경우
    //   → callback 컬럼이 비어있는 고객이 callbackMissing으로 잡히는 문제 방지
    const individualCallbackColumn = campaign.individual_callback_column || undefined;
    const useIndividualCallback = (campaign.use_individual_callback || false) && !!individualCallbackColumn;

    if (!defaultCallback && !campaign.callback_number && !useIndividualCallback) {
      return res.status(400).json({ error: '기본 회신번호가 설정되지 않았습니다. 회사 설정에서 기본 회신번호를 등록해주세요.', code: 'NO_DEFAULT_CALLBACK' });
    }

    // ★ #4: 회신번호 등록 여부 검증 (개별회신번호가 아닌 경우)
    if (!useIndividualCallback) {
      const senderCallback = normalizePhone(campaign.callback_number || defaultCallback);

      // 회신번호 최소 길이 검증 (한국 전화번호 최소 8자리)
      if (senderCallback.length < 8 || senderCallback.length > 11) {
        return res.status(400).json({
          error: '유효하지 않은 회신번호입니다. 올바른 전화번호 형식으로 입력해주세요.',
          code: 'INVALID_CALLBACK_FORMAT'
        });
      }

      const senderCheck = await query(
        `SELECT phone FROM (
          SELECT REPLACE(phone_number, '-', '') as phone FROM sender_numbers WHERE company_id = $1 AND is_active = true
          UNION SELECT REPLACE(phone, '-', '') as phone FROM callback_numbers WHERE company_id = $1
        ) t WHERE phone = $2 LIMIT 1`,
        [companyId, senderCallback]
      );
      if (senderCheck.rows.length === 0) {
        return res.status(400).json({ error: '등록되지 않은 회신번호입니다. 발신번호 관리에서 번호를 등록해주세요.', code: 'INVALID_SENDER_NUMBER' });
      }
    }

    // ★ D102: prepareFieldMappings 컨트롤타워로 통합 (customer_schema 조회 + extractVarCatalog + enrichWithCustomFields)
    const fieldMappings = await prepareFieldMappings(companyId);
    // availableVars는 변수 검증용으로 별도 추출 (extractVarCatalog는 순수 함수)
    const companySchemaResult = await query('SELECT customer_schema FROM companies WHERE id = $1', [companyId]);
    const { availableVars } = extractVarCatalog(companySchemaResult.rows[0]?.customer_schema);

    // ★ field_mappings에서 필요한 컬럼 자동 추출 (동적 SELECT)
    // ★ store_phone 포함: 개별회신번호 사용 시 callback이 없으면 store_phone을 폴백으로 사용
    // ★ custom_fields 포함: 커스텀 필드 변수 치환을 위해 JSONB 컬럼 필수
    const baseColumns = ['id', 'phone', 'callback', 'store_phone', 'custom_fields'];
    // ★ D99: individualCallbackColumn이 직접 컬럼이면 SELECT에 추가
    if (individualCallbackColumn && !individualCallbackColumn.startsWith('custom_') && !baseColumns.includes(individualCallbackColumn)) {
      baseColumns.push(individualCallbackColumn);
    }
    // ★ storageType 기반 동적 필터 — 직접 컬럼만 SELECT, JSONB 내부 키는 custom_fields 컬럼에서 접근 (D72)
    const mappingColumns = Object.values(fieldMappings).filter((m: VarCatalogEntry) => m.storageType !== 'custom_fields').map((m: VarCatalogEntry) => m.column);
    const selectColumns = [...new Set([...baseColumns, ...mappingColumns])].join(', ');

    // draft 또는 completed 상태에서 재발송 가능
    if (campaign.status === 'sending') {
      return res.status(400).json({ error: '이미 발송 중입니다.' });
    }

    // (채널·유형·카카오 활성 확정은 이 라우트 앞머리에서 이미 끝났다 — 2026-08-17.
    //  실패할 수 있는 검사를 `campaign_runs` INSERT보다 앞에 모아 두는 것이 이 라우트의 규약이다.)

    // 타겟 고객 조회
    const targetFilter = campaign.target_filter;
    console.log('targetFilter:', JSON.stringify(targetFilter, null, 2));
    const filterQuery = buildFilterQueryCompat(targetFilter, companyId);
    console.log('filterQuery:', filterQuery);

    // store_code 필터 인덱스 계산
    const storeParamIdx = 1 + filterQuery.params.length + 1;
    const storeFilterFinal = storeFilter.replace('$STORE_IDX', `$${storeParamIdx}`);

    // ★ B17-01 수정: 수신거부 기준을 user_id로 통일 (080 자동연동과 일관성 유지 — 사용자별 수신거부 관리)
    const unsubParamIdx = 1 + filterQuery.params.length + storeParams.length + 1;
    const customersResult = await query(
      `SELECT ${selectColumns} FROM customers c
       WHERE c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true ${filterQuery.where}${storeFilterFinal}
       AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubParamIdx} AND u.phone = c.phone)`,
      [companyId, ...filterQuery.params, ...storeParams, userId]
    );

    const customers = customersResult.rows;

    if (customers.length === 0) {
      return res.status(400).json({ error: '발송 대상이 없습니다.' });
    }

    // ★ 발송 전 메시지 변수 검증 (잘못된 변수가 고객에게 노출되는 것을 방지)
    const messageValidation = validatePersonalizationVars(campaign.message_content || '', availableVars);
    if (!messageValidation.valid) {
      console.warn(`[발송 변수 검증] 잘못된 변수 발견: ${messageValidation.invalidVars.join(', ')}`);
      // 잘못된 변수는 빈 문자열로 치환하여 발송 (차단하지 않고 안전하게 처리)
    }

// excluded_phones 목록 조회
const excludedPhones = campaign.excluded_phones || [];

// 제외 대상 필터링
let filteredCustomers = customers.filter(
  (c: any) => !excludedPhones.includes(normalizePhone(c.phone))
);

// ★ D93: CT-08 필터링을 campaign_runs INSERT 전에 실행 — 확인 모달 반환 시 불필요한 run 생성 방지
let callbackSkippedCount = 0;
let callbackMissingCount = 0;
let callbackUnregisteredCount = 0;
if (useIndividualCallback) {
  // D91: admin/company_admin은 배정 필터 미적용 (전체 번호 사용 가능)
  const cbUserId = (userType === 'super_admin' || userType === 'company_admin') ? undefined : userId;
  const cbResult = await filterByIndividualCallback(filteredCustomers, companyId, cbUserId, individualCallbackColumn);
  filteredCustomers = cbResult.filtered;
  callbackMissingCount = cbResult.callbackMissingCount;
  callbackUnregisteredCount = cbResult.callbackUnregisteredCount;
  callbackSkippedCount = cbResult.callbackSkippedCount;

  // ★ 미등록 회신번호 확인 모달 — 제외 건이 있고 confirmCallbackExclusion 없으면 항상 확인 모달 반환
  if (cbResult.callbackSkippedCount > 0 && !confirmCallbackExclusion) {
    const confirmBody = buildCallbackConfirmResponse(cbResult, filteredCustomers.length);
    return res.status(200).json(confirmBody);
  }
}

if (filteredCustomers.length === 0) {
  const errBody = buildCallbackErrorResponse(callbackMissingCount, callbackUnregisteredCount);
  return res.status(400).json(errBody);
}

// ★ 2026-07-05 발송 피로도 보호 — 회사 opt-in(fatigue_cap) + 광고 캠페인만. 차감·run 생성 전 제외라 환불 배관 불필요.
let fatigueSkippedCount = 0;
if (campaign.is_ad) {
  const fatigueCap = await getFatigueCap(companyId);
  if (fatigueCap) {
    const blockedSet = await getFatigueBlockedSet(companyId, fatigueCap, filteredCustomers.map((c: any) => c.phone));
    if (blockedSet.size > 0) {
      const beforeFatigue = filteredCustomers.length;
      filteredCustomers = filteredCustomers.filter((c: any) => !blockedSet.has(normalizePhone(c.phone)));
      fatigueSkippedCount = beforeFatigue - filteredCustomers.length;
    }
    if (filteredCustomers.length === 0) {
      return res.status(400).json({ error: `발송 대상이 없습니다. (피로도 보호 ${fatigueSkippedCount}명 제외)`, fatigueSkippedCount });
    }
  }
}

    // ★ D100: 동일 캠페인 중복 발송 방지 — 이미 sending/scheduled run이 있으면 차단
    const existingRun = await query(
      `SELECT id FROM campaign_runs WHERE campaign_id = $1 AND status IN ('sending', 'scheduled') LIMIT 1`,
      [id]
    );
    if (existingRun.rows.length > 0) {
      return res.status(400).json({ error: '이미 발송이 진행 중이거나 예약되어 있습니다.' });
    }

    // campaign_runs에 발송 이력 생성 (CT-08 확인 모달 통과 후에만 INSERT)
    const runNumberResult = await query(
      `SELECT COALESCE(MAX(run_number), 0) + 1 as next_run
       FROM campaign_runs WHERE campaign_id = $1`,
      [id]
    );
    const runNumber = runNumberResult.rows[0].next_run;

    // 예약 발송인지 확인
    console.log('scheduled_at:', campaign.scheduled_at);
    const isScheduled = campaign.scheduled_at && new Date(campaign.scheduled_at) > new Date();
    console.log('isScheduled:', isScheduled);

    const runResult = await query(
      `INSERT INTO campaign_runs (
        campaign_id, run_number, target_filter, target_count,
        status, scheduled_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        id,
        runNumber,
        JSON.stringify(targetFilter),
        filteredCustomers.length,
        isScheduled ? 'scheduled' : 'sending',
        campaign.scheduled_at
      ]
    );
    const campaignRun = runResult.rows[0];
    campaignRunId = campaignRun.id;  // 최상위 catch가 종결할 수 있게 밖으로 올린다(위 선언 주석 참조)

// 차감 유형은 아래 catch(축별 환불)도 봐야 하므로 여기서 확정한다.
const deductType = isBrandOnlyChannel(sendChannel) ? 'BRAND' : sendMsgTypeResolved.messageType;
// ★ 2026-08-18 **이번 요청에서 실제로 차감한 축**만 기록한다.
//   preflight로 조립을 차감 앞에 두면서, 조립 throw가 차감 전에도 catch로 들어오게 됐다.
//   완료 캠페인은 같은 campaign id로 재발송되므로 원장에 **과거 정상 발송분의 차감**이 남아 있고,
//   그 상태에서 무조건 환불하면 이번에 안 깎은 돈(과거 발송분)을 돌려주게 된다.
const aiDeductedAxes = new Set<string>();
// ⛔ 환불 항아리를 실행 단위로 좁히지 않는다 — 0818 5R 실측: 같은 미적재분을 mysql-refund-sweeper가
//   평문 `notloaded`로 다시 청구하는데, prepaidRefund의 상한은 `총차감 − 총환불`이라
//   **정당 실패액이 아니라 차감 전액까지** 열려 있다. 항아리를 나누면 그 둘이 각각 갚아 과환불이 된다.
//   (재발송 시 뒤 실행 채무가 앞 실행에 삼켜지는 문제는 **덜 갚는** 방향이라 회복 가능하다 —
//    정규화된 채무 원장이 필요한 별건이다. 여기서 키로 우회하지 않는다.)
const aiKeyNotLoaded = REFUND_KEYS.NOT_LOADED;
const aiKeyCancel = REFUND_KEYS.CANCEL;
// ★ 2026-08-18 축별 적재수를 따로 센다 — 전에는 catch가 문자 적재수로 만든 미적재 건수를
//   BRAND에도 그대로 적용해, 브랜드가 다 나갔는데도 그만큼을 환불했다(실발송분 무료화).
let aiSmsInserted = 0;
let aiBrandInsertedTotal = 0;

// ★ D72 성능개선: 건건이 INSERT → sms-queue.ts 컨트롤타워 bulkInsertSmsQueue 사용
// ★ 2026-07-27 (B-0727-2): try **밖**에서 선언 — 전체 실패 catch가 실제 적재 건수를 봐야
//   미적재분만 환불한다(적재는 끝났는데 후처리만 실패한 경우 실발송분까지 환불하던 경로 차단).
let aiSentCount = 0;

// ★ P0-3: 차감 성공 후 발송 실패 시 자동 환불 보장
try {

// MySQL에 INSERT (즉시/예약 공통)
// ★ C4: sendTime은 항상 문자열로 생성 → SQL 파라미터로 전달 (SQL Injection 방지)
const sendTime = isScheduled
  ? toKoreaTimeStr(new Date(campaign.scheduled_at))
  : toKoreaTimeStr(new Date());  // 즉시발송도 JS 타임스탬프를 파라미터로 전달

// MMS 이미지 경로 (campaigns 테이블에서 가져옴)
// ★ D124 N4: mms_image_paths가 객체 배열({path, originalName}) 또는 문자열 배열 혼재 가능 → 정규화
const campaignMmsImages: string[] = normalizeMmsImagePaths(campaign.mms_image_paths);
const aiMsgTypeCode = toQtmsgType(campaign.message_type);

// 카카오 설정 (campaigns 테이블에서)
const kakaoBubbleType = campaign.kakao_bubble_type || 'TEXT';
const kakaoSenderKey = campaign.kakao_sender_key || '';
const kakaoTargeting = campaign.kakao_targeting || 'I';
const kakaoAttachmentJson = campaign.kakao_attachment_json || null;
const kakaoCarouselJson = campaign.kakao_carousel_json || null;
const kakaoResendType = campaign.kakao_resend_type || 'SM';

// ★ D102: 080 수신거부번호 — CT-AD 컨트롤타워 사용
const opt080Number = campaign.is_ad ? await getOpt080Number(userId || null, companyId) : '';
let opt080Auth = '';

// (aiSentCount 선언은 try 밖으로 이동 — B-0727-2)

// 1단계: 메시지 치환 + 발송 데이터 준비 (메모리 연산)
const aiSmsRows: any[][] = [];
const aiBrandRows: BrandQueueRow[] = [];

for (const customer of filteredCustomers) {
  // ★ D103: prepareSendMessage 컨트롤타워 — 변수 치환 + (광고)+080 + ★ KISA 2026-05 제목(광고) 통합
  const { message: personalizedMessage, subject: personalizedSubject } = prepareSendMessage(campaign.message_content || '', customer, fieldMappings, {
    msgType: campaign.message_type, isAd: campaign.is_ad || false, opt080Number,
    subject: campaign.subject || '',
  });

  // ★ D103: resolveCustomerCallback 컨트롤타워 — 개별회신번호 resolve 통합
  const customerCallback = resolveCustomerCallback(customer, useIndividualCallback, campaign.callback_number || defaultCallback);

  const cleanPhone = normalizePhone(customer.phone);

  // ★ SMS/LMS/MMS — row 데이터 준비
  if (sendChannel === 'sms' || sendChannel === 'both') {
    aiSmsRows.push([
      cleanPhone, customerCallback, personalizedMessage, aiMsgTypeCode,
      personalizedSubject, sendTime, id, companyId,
      campaignMmsImages[0] || '', campaignMmsImages[1] || '', campaignMmsImages[2] || ''
    ]);
  }

  // ★ 브랜드메시지 — SMSQ 배치 행 축적 (★2026-08-15 규약 정정: 본문=msg_contents / 제어·부가=k_etc_json)
  //   조립·대체발송 결함은 여기서 throw → 아래 전체 catch가 미적재 기준으로 환불한다(fail-closed).
  if (sendChannel === 'kakao' || sendChannel === 'both') {
    const brandFallback = resolveBrandFallback({
      resendType: sendChannel === 'both' ? 'NO' : kakaoResendType,
      originalMessage: personalizedMessage,
    });
    const aiBrandPayload = buildBrandQueuePayload({
      typeDef: 'FREE',
      senderKey: kakaoSenderKey,
      targeting: kakaoTargeting,
      bubbleType: kakaoBubbleType,
      isAd: campaign.is_ad === true,
      message: personalizedMessage,
      sendAt: sendTime || undefined,   // 예약·분할 시각 그대로 — 발송 가능 시간 판정 기준
      immediate: !isScheduled,
      attachmentJson: kakaoAttachmentJson,
      carouselJson: kakaoCarouselJson,
    });
    aiBrandRows.push({
      phone: cleanPhone,
      callback: customerCallback,
      msgContents: aiBrandPayload.msgContents,
      etcJson: aiBrandPayload.etcJson,
      nextType: brandFallback.nextType,
      nextContents: brandFallback.nextContents,
      titleStr: brandFallback.titleStr,
      reservedDate: sendTime || undefined,
      companyId,
    });
  }
}

// ── 여기서부터 되돌릴 수 없는 것들(차감·적재) ─────────────────────────
//   ★ 2026-08-18 preflight — 위 1단계에서 **모든 수신자의 행을 만들어 본 뒤**에 차감한다.
//   전에는 [차감 → 조립 → 적재] 순서라 규격 위반이 조립에서 throw하면 돈이 이미 움직인 뒤였다.
// ★ 선불 잔액 체크 + 차감 (MySQL INSERT 전에 atomic 차감)
// 채널·유형·카카오 활성 여부는 전부 run INSERT **앞**에서 확정됐다(2026-08-17) —
// 여기서 실패할 수 있는 것은 차감 하나뿐이고, 그 실패는 실행 행을 종결시켜 캠페인을 풀어 준다.
const sendDeduct = await prepaidDeduct(companyId, filteredCustomers.length, deductType, id, userId);
if (sendDeduct.ok) aiDeductedAxes.add(deductType);
if (!sendDeduct.ok) {
  // 실행 행을 남겨 두면 위쪽 중복 발송 방지 검사가 이후 발송을 영구히 막는다(충전해도 못 보낸다).
  await failCampaignRun(campaignRun.id, '선불 잔액 부족으로 발송 중단');
  return res.status(402).json({
    error: sendDeduct.error,
    insufficientBalance: true,
    balance: sendDeduct.balance,
    requiredAmount: sendDeduct.amount
  });
}

// ★ 2026-07-29 `both`는 **같은 수신자를 두 축으로 적재한다** — 아래 발송 단계가
//   bulkInsertSmsQueue(문자)와 insertBrandQueue(브랜드) 양쪽에 넣는다.
//   그런데 차감은 위 한 번뿐이라 브랜드 발송분이 통째로 무료로 나가고 있었다(적대검증 실측).
//   두 축 모두 차감하고, 뒤가 실패하면 **앞선 차감을 되돌린다** — 한쪽만 깎인 채로 발송하면
//   그 캠페인의 회계가 영구히 어긋나고 환불 sweeper도 짝을 못 찾는다.
if (sendChannel === 'both') {
  const brandDeduct = await prepaidDeduct(companyId, filteredCustomers.length, 'BRAND', id, userId);
  if (brandDeduct.ok) aiDeductedAxes.add('BRAND');
  if (!brandDeduct.ok) {
    // ★ 2026-08-17 (Codex 2R high) 회수 **결과**를 봐야 한다. `prepaidRefund`는 실패를 던지지 않고
    //   `ok:false`로 돌려주기도 해서, 예외만 잡으면 "회수 실패"가 성공으로 지나간다.
    //   그 상태에서 아래 `failCampaignRun`이 잠금을 풀어 주므로 **재시도가 가능해지고, 첫 차감이 남아 있으면
    //   그대로 이중 청구**가 된다(잠금을 푼 것 자체는 맞지만, 그 전에 미수를 원장에 남겨야 한다).
    //   미수 기록은 이 파일이 이미 쓰는 CT를 그대로 쓴다(`markRefundPending` — 직접발송 경로 선례와 같은 형태).
    try {
      const revert = await prepaidRefund(
        companyId, filteredCustomers.length, deductType, id,
        '브랜드메시지 차감 실패로 문자 차감분 회수', 'campaign', { refundKey: aiKeyCancel },
      );
      if (!revert.ok) {
        console.error(`[선불][both 보상실패] campaign=${id} ${deductType} ${filteredCustomers.length}건 회수 미완 (실회수 ${revert.refunded}건)`);
        await markRefundPending(id, filteredCustomers.length, deductType, aiKeyCancel);
      }
    } catch (revertErr) {
      // 회수까지 실패하면 잔액이 깎인 채 발송이 멈춘다 — 미수로 남겨 워커·사람이 이어받게 한다.
      console.error(`[선불][both 보상실패] campaign=${id} ${deductType} ${filteredCustomers.length}건 회수 실패:`, revertErr);
      await markRefundPending(id, filteredCustomers.length, deductType, aiKeyCancel);
    }
    // 차감은 되돌렸지만 실행 행은 그대로 남아 캠페인을 잠그던 자리다(2026-08-17).
    await failCampaignRun(campaignRun.id, '브랜드메시지 차감 실패로 발송 중단');
    return res.status(402).json({
      error: brandDeduct.error,
      insufficientBalance: true,
      balance: brandDeduct.balance,
      requiredAmount: brandDeduct.amount,
    });
  }
}

// 2단계: SMS bulk INSERT — sms-queue.ts 컨트롤타워 사용
if (sendChannel === 'sms' || sendChannel === 'both') {
  aiSmsInserted = await bulkInsertSmsQueue(companyTables, aiSmsRows, !isScheduled, { companyId, userId, source: 'campaign' });
  aiSentCount += aiSmsInserted;
}

// 3단계: 브랜드메시지 배치 INSERT — CT-04 insertBrandQueue (msg_type='F')
if (aiBrandRows.length > 0) {
  let aiBrandInserted = 0;
  try {
    aiBrandInserted = await insertBrandQueue(companyTables, aiBrandRows, id);
  } catch (brandErr) {
    if (brandErr instanceof BrandQueueInsertError) {
      aiBrandInserted = brandErr.inserted; // 앞선 배치는 커밋됨 — 그만큼은 발송분(B-0727-1 계약)
      console.error(`[AI발송] 브랜드 큐 INSERT 부분 실패 (적재 ${aiBrandInserted}건):`, brandErr.message);
    } else {
      console.error(`[AI발송] 브랜드 큐 INSERT 실패:`, brandErr);
    }
  }
  aiBrandInsertedTotal = aiBrandInserted;
  if (sendChannel === 'kakao') aiSentCount += aiBrandInserted;
  // ★ both는 차감이 두 축(message_type + BRAND) — 아래 aiFailCount 환불은 문자 축이므로
  //   브랜드 축 미적재분은 여기서 BRAND로 되돌린다(직접발송 경로와 동일 계약).
  if (sendChannel === 'both' && aiBrandInserted < aiBrandRows.length) {
    const aiBrandShort = aiBrandRows.length - aiBrandInserted;
    try {
      // 반환값을 본다 — ok:false를 버리면 브랜드 차감이 영구히 남는다(문자축 환불은 aiFailCount가 0이라 안 돈다).
      const rb = await prepaidRefund(companyId, aiBrandShort, 'BRAND', id, `AI발송 브랜드 미적재 ${aiBrandShort}건 환불`, 'campaign', { refundKey: aiKeyNotLoaded });
      if (!rb.ok) await markRefundPending(id, aiBrandShort, 'BRAND', aiKeyNotLoaded);
    } catch (brandRefundErr) {
      console.error('[AI발송] 브랜드 미적재 환불 오류:', brandRefundErr);
      await markRefundPending(id, aiBrandShort, 'BRAND', aiKeyNotLoaded);
    }
  }
}

// ★ 2026-07-05 발송 피로도 카운터 — 광고성만, 큐 커밋 후 fire-and-forget(발송·응답 무영향)
if (campaign.is_ad) {
  void recordFatigueSends(companyId, filteredCustomers.map((c: any) => String(c.phone || '')));
}

// ★ C1: 부분 실패 시 실패분만 선별적 환불
const aiFailCount = filteredCustomers.length - aiSentCount;
if (aiFailCount > 0) {
  console.warn(`[AI발송] 부분 실패 — 성공: ${aiSentCount}, 실패: ${aiFailCount} → 실패분 환불 처리`);
  try {
    // ★ 2026-07-27 (B-0727-2): 이 건수는 `대상 − 큐 적재 성공`이라 게이트웨이 실패가 아니라 **미적재**다.
    //   fail 항아리에 넣으면 나중에 sweeper가 얹는 실제 실패분이 그 항아리에서 삼켜져 환불이 모자란다.
    // ★ 2026-08-18 반환값을 본다 — prepaidRefund는 실패를 던지지 않고 ok:false로도 돌려준다.
    //   버리면 재시도할 주체가 사라져 차감이 그대로 남는다(직접발송·알림톡 경로와 같은 계약).
    const rp = await prepaidRefund(companyId, aiFailCount, deductType, id, `AI발송 미적재 ${aiFailCount}건 환불`, 'campaign', { refundKey: aiKeyNotLoaded });
    if (!rp.ok) await markRefundPending(id, aiFailCount, deductType, aiKeyNotLoaded);
  } catch (partialRefundErr) {
    console.error('[AI발송] 부분 실패 환불 오류:', partialRefundErr);
    await markRefundPending(id, aiFailCount, deductType, aiKeyNotLoaded);
  }
}

// campaign_runs 상태 업데이트
// ★ #6: 예약 캠페인은 sent_at 설정하지 않음
// ★ C1: aiSentCount 기반으로 실제 성공 건수 반영
// ★ D144 후속: bulk INSERT 완료 = 발송완료 정책 — 'sending' 단계 폐기, 즉시 'completed' set.
//   pending(통신사 처리 대기)은 백그라운드. 화면 카운트는 D144 후 MySQL 직접이라 실시간 갱신.
await query(
  `UPDATE campaign_runs SET
    sent_count = $1,
    status = $2
    ${isScheduled ? '' : ', sent_at = CURRENT_TIMESTAMP'}
   WHERE id = $3`,
  [aiSentCount, aiSentCount === 0 ? 'failed' : (isScheduled ? 'scheduled' : 'completed'), campaignRun.id]
);

// 캠페인 상태 업데이트
// ★ #6: 예약 캠페인은 sent_at 설정하지 않음 (예약 시점 발송 시 set)
// ★ C1: aiSentCount 기반
// ★ D144 후속: 동일 정책 — 즉시발송은 'completed', 예약은 'scheduled' 유지, 0건이면 'failed'
await query(
  `UPDATE campaigns SET
    status = $1,
    sent_count = COALESCE(sent_count, 0) + $2,
    target_count = $3
    ${isScheduled ? '' : ', sent_at = CURRENT_TIMESTAMP'}
   WHERE id = $4`,
   [aiSentCount === 0 ? 'failed' : (isScheduled ? 'scheduled' : 'completed'), aiSentCount, filteredCustomers.length, id]
  );

      // ★ AI 학습 데이터 적재 (비동기, 실패해도 발송에 영향 없음)
      const trainingCompanyInfo = await query('SELECT name, brand_tone FROM companies WHERE id = $1', [companyId]);
      logTrainingData({
        campaignRunId: campaignRun.id,
        companyId,
        companyName: trainingCompanyInfo.rows[0]?.name,
        brandTone: trainingCompanyInfo.rows[0]?.brand_tone,
        userPrompt: campaign.user_prompt,
        targetFilter: campaign.target_filter,
        targetCount: filteredCustomers.length,
        messageType: campaign.message_type,
        isAd: campaign.is_ad || false,
        finalMessage: campaign.message_content || '',
        finalSource: (campaign.message_template && campaign.message_template === campaign.message_content) ? 'selected_as_is' : 'edited',
        sendAt: campaign.scheduled_at ? new Date(campaign.scheduled_at) : new Date(),
      });

      return res.json({
      message: `${aiSentCount}건 발송이 시작되었습니다.${aiFailCount > 0 ? ` (${aiFailCount}건 실패, 자동 환불)` : ''}${callbackMissingCount > 0 ? ` (회신번호 없음 ${callbackMissingCount}명 제외)` : ''}${callbackUnregisteredCount > 0 ? ` (미등록 회신번호 ${callbackUnregisteredCount}명 제외)` : ''}${fatigueSkippedCount > 0 ? ` (피로도 보호 ${fatigueSkippedCount}명 제외)` : ''}`,
      sentCount: aiSentCount,
      failCount: aiFailCount,
      callbackSkippedCount,
      callbackMissingCount,
      callbackUnregisteredCount,
      runId: campaignRun.id,
      runNumber: runNumber,
    });

    } catch (sendError) {
      // ★ C1: 전체 실패 (루프 진입 전 오류 등) — 전액 환불
      console.error('[AI발송] 큐 처리 전체 실패 — 차감 환불 처리:', sendError);
      // ★ 2026-08-17 (Codex 2R critical) 예외 경로도 **조기 return과 같은 계약**으로 맞춘다.
      //   전에는 여기서 ①`deductType` 축만 환불하고(`both`는 BRAND 축 차감이 그대로 남았다)
      //   ②`campaign_runs`를 손대지 않아 `status='sending'` 행이 남았다 — 그 행이 중복 발송 방지 검사에 걸려
      //   **그 캠페인의 재시도가 영구히 막혔다**(조기 return에서 고친 것과 같은 사고가 예외 경로에 남아 있었다).
      //   환불 축은 차감을 넣은 쪽과 같은 CT로 뽑는다(`resolveRefundAxes`) — 두 벌로 두면 회계가 갈린다.
      // 축마다 **자기 적재수**로 미적재를 센다 — 한 축의 수를 다른 축에 쓰면 실발송분을 환불한다.
      //   채널 판정은 CT(isBrandOnlyChannel)에 맡긴다 — 라우트가 채널 리터럴을 직접 비교하면
      //   축이 늘어날 때 여기만 빠진다(brand-axis-invariants가 막는 패턴).
      const loadedOf = (axisType: string) => (axisType === 'BRAND' || isBrandOnlyChannel(sendChannel))
        ? aiBrandInsertedTotal
        : aiSmsInserted;
      // 차감하지 않은 축은 되돌릴 것이 없다 — 원장에 남은 과거 발송분을 환불하지 않도록 축을 좁힌다.
      const aiPending: { count: number; messageType: string; refundKey?: string }[] = [];
      for (const axis of resolveRefundAxes(sendChannel, sendMsgTypeResolved.messageType).filter((a) => aiDeductedAxes.has(a.type))) {
        const aiNotLoaded = Math.max(0, filteredCustomers.length - loadedOf(axis.type));
        if (aiNotLoaded <= 0) continue;
        try {
          const r = await prepaidRefund(
            companyId, aiNotLoaded, axis.type, id,
            `발송 실패 미적재 ${aiNotLoaded}건 자동 환불`, 'campaign', { refundKey: aiKeyNotLoaded },
          );
          // 환불은 실패를 던지지 않고 `ok:false`로 돌아오기도 한다 — 미수를 원장에 남겨야 재시도가 이중 청구가 안 된다.
          if (!r.ok) {
            console.error(`[AI발송] 미적재 환불 미완 campaign=${id} axis=${axis.type} ${aiNotLoaded}건 (실환불 ${r.refunded}건)`);
            aiPending.push({ count: aiNotLoaded, messageType: axis.type, refundKey: aiKeyNotLoaded });
          }
        } catch (refundErr) {
          console.error(`[AI발송] 미적재 환불 오류 campaign=${id} axis=${axis.type}:`, refundErr);
          aiPending.push({ count: aiNotLoaded, messageType: axis.type, refundKey: aiKeyNotLoaded });
        }
      }
      // 축을 한 번에 기록한다 — 나눠 쓰면 그 사이에 워커가 첫 축만 보고 슬롯을 지운다.
      await markRefundPendingAxes(id, aiPending);
      try {
        await query(`UPDATE campaigns SET status = 'failed', updated_at = NOW() WHERE id = $1`, [id]);
      } catch (statusErr) {
        console.error('[AI발송] 캠페인 상태 갱신 실패:', statusErr);
      }
      // 실행 행 종결이 빠지면 위 환불이 다 성공해도 그 캠페인은 다시 못 보낸다.
      await failCampaignRun(campaignRun.id, '발송 처리 중 오류로 중단');
      return res.status(500).json({ error: '발송 처리 중 오류가 발생했습니다. 차감된 금액은 자동 환불됩니다.' });
    }

  } catch (error) {
    console.error('캠페인 발송 에러:', error);
    // 실행 행이 이미 만들어진 뒤라면 종결한다 — 안 하면 그 캠페인이 영구히 잠긴다(2026-08-17).
    if (campaignRunId) await failCampaignRun(campaignRunId, '발송 처리 중 예기치 못한 오류');
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ★ D79: 인라인 래퍼 제거 → CT-01 buildFilterQueryCompat 직접 사용

// 담당자 테스트 발송 통계
router.get('/test-stats', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const { fromDate, toDate } = req.query;

    // 날짜 범위 필터 — 포맷 검증 + 파라미터화 (SQL Injection 방지)
    const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
    let dateFilter = '';
    const dateParams: any[] = [];
    if (fromDate && toDate && DATE_FORMAT.test(String(fromDate)) && DATE_FORMAT.test(String(toDate))) {
      dateFilter = ' AND sendreq_time >= ? AND sendreq_time <= ?';
      dateParams.push(`${fromDate} 00:00:00`, `${toDate} 23:59:59`);
    }

    // 일반 사용자는 본인이 보낸 테스트만
    let userFilter = '';
    const queryParams: any[] = [companyId];
    if (userType === 'company_user' && userId) {
      userFilter = ' AND bill_id = ?';
      queryParams.push(userId);
    }
    // 날짜 파라미터를 쿼리 파라미터에 합산 (위치 순서 유지)
    queryParams.push(...dateParams);

    // 테스트 전용 메인 테이블
    const testTables = await getTestSmsTables();

    // 로그 테이블도 포함 (Agent 처리 완료 시 SMSQ_SEND_10 → SMSQ_SEND_10_YYYYMM 이동)
    const logTables: string[] = [];
    if (fromDate && toDate) {
      const start = new Date(fromDate as string);
      const end = new Date(toDate as string);
      const cur = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cur <= end) {
        const ym = `${cur.getFullYear()}${String(cur.getMonth() + 1).padStart(2, '0')}`;
        for (const t of testTables) {
          logTables.push(`${t}_${ym}`);
        }
        cur.setMonth(cur.getMonth() + 1);
      }
    } else {
      const now = new Date();
      const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
      for (const t of testTables) {
        logTables.push(`${t}_${ym}`);
      }
    }

    // 존재하는 로그 테이블만 추가
    const allTables = [...testTables];
    for (const lt of logTables) {
      try {
        await mysqlQuery(`SELECT 1 FROM ${lt} LIMIT 0`);
        allTables.push(lt);
      } catch { /* 테이블 없으면 스킵 */ }
    }

    const allResults = await smsSelectAll(allTables,
      'seqno, dest_no, msg_contents, msg_type, sendreq_time, status_code, mobsend_time, bill_id',
      `app_etc1 = 'test' AND app_etc2 = ?${userFilter}${dateFilter}`,
      queryParams,
      'ORDER BY sendreq_time DESC'
    );

    // 시간순 정렬 (여러 테이블 합산이므로 재정렬)
    allResults.sort((a: any, b: any) => new Date(b.sendreq_time).getTime() - new Date(a.sendreq_time).getTime());

    // 발송자 정보 조회 (관리자용)
    const senderIds = [...new Set(allResults.map((r: any) => r.bill_id).filter(Boolean))];
    let senderMap: Record<string, string> = {};
    if (senderIds.length > 0) {
      const senderResult = await query(
        `SELECT id, name FROM users WHERE id = ANY($1::uuid[])`,
        [senderIds]
      );
      senderResult.rows.forEach((u: any) => {
        senderMap[u.id] = u.name;
      });
    }

    // 통계 계산 (전체 결과 기준)
    const stats = {
      total: allResults.length,
      success: allResults.filter((r: any) => isSuccess(r.status_code)).length,
      fail: allResults.filter((r: any) => isFail(r.status_code)).length,
      pending: allResults.filter((r: any) => PENDING_CODES.includes(r.status_code)).length,
      cost: 0,
    };

    // 비용 계산 (회사 실제 단가 기준)
    const costResult = await query('SELECT cost_per_sms, cost_per_lms, cost_per_mms, unit_price_basis FROM companies WHERE id = $1', [companyId]);
    const costRow = getCompanyCosts(costResult.rows[0] || {});
    const costSms = costRow.sms;
    const costLms = costRow.lms;
    const costMms = costRow.mms;
    allResults.forEach((r: any) => {
      if (isSuccess(r.status_code)) {
        stats.cost += r.msg_type === 'S' ? costSms : r.msg_type === 'M' ? costMms : costLms;
      }
    });

    // 리스트 포맷팅
    const list = allResults.map((r: any) => ({
      id: r.seqno,
      phone: r.dest_no,
      content: r.msg_contents,
      type: r.msg_type === 'S' ? 'SMS' : r.msg_type === 'M' ? 'MMS' : 'LMS',
      sentAt: r.sendreq_time,
      status: isSuccess(r.status_code) ? 'success' : PENDING_CODES.includes(r.status_code) ? 'pending' : 'fail',

      testType: 'manager',
      senderName: senderMap[r.bill_id] || '-',
    }));

    // ========== 스팸필터 테스트 통합 ==========
    // ★ D104: 날짜 필터 컨트롤타워 사용
    const spamDr = buildDateRangeFilter('t.created_at', fromDate as string | undefined, toDate as string | undefined, 2);
    const spamDateWhere = spamDr.sql;
    const spamParams: any[] = [companyId, ...spamDr.params];
    let spamIdx = spamDr.nextIndex;
    let spamUserWhere = '';
    if (userType === 'company_user' && userId) {
      spamUserWhere = ` AND t.user_id = $${spamIdx}`;
      spamParams.push(userId);
      spamIdx++;
    }

    const spamAgg = await query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN r.message_type = 'SMS' THEN 1 ELSE 0 END) as sms,
        SUM(CASE WHEN r.message_type = 'LMS' THEN 1 ELSE 0 END) as lms,
        SUM(CASE WHEN r.result IS NOT NULL THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN r.result IS NULL AND t.status IN ('active','pending') THEN 1 ELSE 0 END) as pending
      FROM spam_filter_test_results r
      JOIN spam_filter_tests t ON r.test_id = t.id
      WHERE t.company_id = $1 ${spamDateWhere} ${spamUserWhere}
    `, spamParams);

    const sf = spamAgg.rows[0];
    const sfTotal = Number(sf.total) || 0;
    const sfCompleted = Number(sf.completed) || 0;
    const sfPending = Number(sf.pending) || 0;
    const sfSms = Number(sf.sms) || 0;
    const sfLms = Number(sf.lms) || 0;
    const sfCost = sfCompleted > 0 ? (sfSms > sfLms ? sfSms * costSms + sfLms * costLms : sfLms * costLms + sfSms * costSms) : 0;
    // 정확한 비용: completed 건에 대해 SMS/LMS 구분하여 계산
    let sfCostCalc = 0;

    // 스팸필터 리스트 (최근 100건)
    const spamListResult = await query(`
      SELECT
        r.id, r.phone, r.carrier, r.message_type, r.result, r.received,
        t.created_at as sent_at, t.user_id, t.callback_number,
        t.message_content_sms, t.message_content_lms,
        u.name as sender_name
      FROM spam_filter_test_results r
      JOIN spam_filter_tests t ON r.test_id = t.id
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.company_id = $1 ${spamDateWhere} ${spamUserWhere}
      ORDER BY t.created_at DESC
      LIMIT 100
    `, spamParams);

    const spamFilterList = spamListResult.rows.map((r: any) => {
      const msgType = r.message_type || 'SMS';
      const isCompleted = r.result !== null;
      if (isCompleted) {
        sfCostCalc += msgType === 'SMS' ? costSms : costLms;
      }
      return {
        id: r.id,
        phone: r.phone,
        content: msgType === 'LMS' ? (r.message_content_lms || '') : (r.message_content_sms || ''),
        type: msgType,
        sentAt: r.sent_at,
        status: isCompleted ? 'success' : 'pending',
        result: r.result || SPAM_RESULT.PASS,
        carrier: r.carrier,
        testType: 'spam_filter',
        senderName: r.sender_name || '-',
      };
    });

    const spamFilterStats = {
      total: sfTotal,
      success: sfCompleted,
      fail: 0,
      pending: sfPending,
      sms: sfSms,
      lms: sfLms,
      cost: Math.round(sfCostCalc * 10) / 10,
    };

    // 합산 통계
    const combinedStats = {
      total: stats.total + spamFilterStats.total,
      success: stats.success + spamFilterStats.success,
      fail: stats.fail + spamFilterStats.fail,
      pending: stats.pending + spamFilterStats.pending,
      cost: Math.round((stats.cost + spamFilterStats.cost) * 10) / 10,
    };

    res.json({
      stats: combinedStats,
      managerStats: stats,
      spamFilterStats,
      list,
      spamFilterList,
    });
  } catch (error) {
    console.error('테스트 통계 조회 실패:', error);
    res.status(500).json({ error: '테스트 통계 조회 실패' });
  }
});

// GET /api/campaigns/:id - 캠페인 상세 조회
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const companyId = req.user?.companyId;

    // ★ B2: opt_out_080_number 포함을 위해 LEFT JOIN
    const result = await query(
      `SELECT c.*, ${CAMPAIGN_OPT080_SELECT_EXPR}
       FROM campaigns c
       ${CAMPAIGN_OPT080_LEFT_JOIN}
       WHERE c.id = $1 AND c.company_id = $2`,
      [id, companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '캠페인을 찾을 수 없습니다.' });
    }

    // 발송 이력도 함께 조회
    const runs = await query(
      `SELECT * FROM campaign_runs WHERE campaign_id = $1 ORDER BY created_at DESC`,
      [id]
    );

    return res.json({
      ...result.rows[0],
      runs: runs.rows
    });
  } catch (error) {
    console.error('캠페인 상세 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});
// POST /api/campaigns/sync-results - MySQL 결과를 PostgreSQL로 동기화
// ★ utils/campaign-lifecycle.ts 컨트롤타워 사용
router.post('/sync-results', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    const result = await syncCampaignResults(companyId);
    return res.json({ message: `${result.syncCount}건 동기화 완료` });
  } catch (error) {
    console.error('결과 동기화 에러:', error);
    return res.status(500).json({ error: '동기화 실패' });
  }
});
// 직접발송 API
// ★ 대량 발송 파이프라인 (2026-05-30) — Task 3: 수신자 청크 적재 (1만건/요청)
//   18만~500만 건도 청크로 staging에 누적 → body 한도/timeout 구조적 제거.
router.post('/direct-send/stage', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });
    const { stagingId: incoming, recipients } = req.body || {};
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ success: false, error: 'recipients 비어 있음' });
    }
    if (recipients.length > 50000) {
      return res.status(413).json({ success: false, error: '청크는 최대 5만건입니다', code: 'CHUNK_TOO_LARGE' });
    }
    const stagingId = incoming || randomUUID();
    // ★ UNNEST 배열 방식 — 파라미터 8개 고정 (행 수 무관). 다중 행 VALUES는 행×8 파라미터라
    //   5만 청크 = 40만 파라미터로 PostgreSQL 한도(65,535)를 초과 → UNNEST 필수.
    const phones: string[] = [];
    const names: (string | null)[] = [];
    const extra1s: (string | null)[] = [];
    const extra2s: (string | null)[] = [];
    const extra3s: (string | null)[] = [];
    const callbacks: (string | null)[] = [];
    recipients.forEach((r: any) => {
      phones.push(normalizePhone(r.phone));
      names.push(r.name ?? null);
      extra1s.push(r.extra1 ?? null);
      extra2s.push(r.extra2 ?? null);
      extra3s.push(r.extra3 ?? null);
      callbacks.push(r.callback ?? null);
    });
    await query(
      `INSERT INTO campaign_send_staging (staging_id, company_id, phone, name, extra1, extra2, extra3, callback)
       SELECT $1::uuid, $2::uuid, u.phone, u.name, u.extra1, u.extra2, u.extra3, u.callback
       FROM UNNEST($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[])
         AS u(phone, name, extra1, extra2, extra3, callback)`,
      [stagingId, companyId, phones, names, extra1s, extra2s, extra3s, callbacks]
    );
    return res.json({ success: true, stagingId, staged: recipients.length });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('relation') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, code: 'DB_MIGRATION_PENDING', error: 'DB 마이그레이션 필요: campaign_send_staging 테이블' });
    }
    console.error('[direct-send/stage] 적재 오류:', err);
    return res.status(500).json({ success: false, error: '수신자 적재 중 오류가 발생했습니다.' });
  }
});

// countStagingFiltered / createDirectSendCampaign = utils/direct-send-core.ts (commit·count·자율발송 공유).

// 프론트가 phones를 통째 POST(/unsubscribes/check)하던 방식 대신, stage 적재 후 이 endpoint로 모달 카운트 조회.
router.post('/direct-send/count', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });
    const { stagingId, dedupEnabled = true, unsubFilterEnabled = true } = req.body || {};
    if (!stagingId) return res.status(400).json({ success: false, error: 'stagingId 누락' });
    const r = await countStagingFiltered(stagingId, companyId, userId, dedupEnabled, unsubFilterEnabled);
    return res.json({ success: true, ...r });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('relation') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, code: 'DB_MIGRATION_PENDING', error: 'DB 마이그레이션 필요: campaign_send_staging 테이블' });
    }
    console.error('[direct-send/count] 오류:', err);
    return res.status(500).json({ success: false, error: '정제 카운트 중 오류가 발생했습니다.' });
  }
});

// ★ 대량 발송 파이프라인 (2026-05-30) — Task 4: 발송 커밋
//   staging 전체 정제(수신거부 DELETE → 중복제거 DELETE) → 정제 후 건수로 차감 → 즉시 202 접수.
//   실제 청크 발송은 direct-send-worker가 백그라운드 처리(진행률은 send-progress 조회).
router.post('/direct-send/commit', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });

    if (!(await hasCompanyLineGroup(companyId))) {
      return res.status(400).json({ success: false, error: '발송 라인그룹이 설정되지 않았습니다. 관리자에게 문의해주세요.', code: 'LINE_GROUP_NOT_SET' });
    }

    const {
      stagingId, msgType, subject, message, callback, sendChannel,
      adEnabled, scheduled, scheduledAt, splitEnabled, splitCount,
      useIndividualCallback, individualCallbackColumn, mmsImagePaths,
      dedupEnabled = true, unsubFilterEnabled = true,
      kakaoBubbleType, kakaoSenderKey, kakaoTargeting, kakaoAttachmentJson, kakaoCarouselJson, kakaoResendType,
      alimtalkTemplateCode, alimtalkVariableMap, alimtalkButtonJson,
      alimtalkNextType, alimtalkNextContents, alimtalkNextSubject,
    } = req.body;

    if (!stagingId) return res.status(400).json({ success: false, error: 'stagingId 누락' });

    // ★ 2026-08-17 발송 채널 확정 — `/direct-send`와 **같은 구멍**이 이 경로에도 있었다.
    //   차감은 direct-send-core가, 적재는 direct-send-processor가 하는데 둘 사이에 채널 검사가 없어
    //   미지원 값이면 차감만 남고 적재가 0건이 된다. 차감 함수보다 앞인 여기서 막는다.
    //   ⚠ 아래로는 **resolver가 돌려준 값만** 넘긴다 — 원본을 넘기면 배열·공백이 하위 기본값 처리를
    //     그대로 통과해(`[] || 'sms'`는 빈 배열이다) 적재 분기에서만 빗나간다.
    const commitChannel = resolveSendChannel('direct', sendChannel);
    if (!commitChannel.ok) {
      console.warn(`[직접발송 commit] 발송 채널 거절 — company=${companyId} raw=${JSON.stringify(sendChannel)} reason=${commitChannel.reason}`);
      return res.status(400).json({ success: false, error: commitChannel.reason, code: 'UNSUPPORTED_SEND_CHANNEL' });
    }
    // ★ 2026-08-17 (Codex 2R high) 유형도 확정한다 — `/direct-send`와 같은 축이고, 이 문도 차감에 그대로 넘긴다.
    const commitMsgResolved = resolveChargeMessageType(msgType);
    if (!commitMsgResolved.ok) {
      console.warn(`[직접발송 commit] 메시지 유형 거절 — company=${companyId} raw=${JSON.stringify(msgType)} reason=${commitMsgResolved.reason}`);
      return res.status(400).json({ success: false, error: commitMsgResolved.reason, code: 'UNSUPPORTED_MESSAGE_TYPE' });
    }

    const stagedCount = await query(
      `SELECT COUNT(*)::int AS c FROM campaign_send_staging WHERE staging_id = $1 AND company_id = $2`,
      [stagingId, companyId]
    );
    if ((stagedCount.rows[0]?.c || 0) === 0) {
      return res.status(400).json({ success: false, error: '적재된 수신자가 없습니다' });
    }

    // 검증 (즉시 피드백) — 제목 / 회신번호 등록 / 알림톡 승인
    const isAlimtalkSend = commitChannel.channel === 'alimtalk';
    if (isAlimtalkSend) {
      // ★ 2026-07-27: 전환재발송 검증 CT 단일 기준(alimtalk-fallback) — 제목 + 대체문안 동시.
      const violation = validateAlimtalkFallback({
        nextType: alimtalkNextType,
        nextContents: alimtalkNextContents,
        nextSubject: alimtalkNextSubject,
      });
      if (violation) return res.status(400).json({ success: false, error: violation });
    } else if (!isAlimtalkSend && (msgType === 'LMS' || msgType === 'MMS')) {
      if (!subject?.trim()) return res.status(400).json({ success: false, error: 'LMS/MMS 발송 시 제목을 입력해주세요.' });
    }
    if (!callback && !useIndividualCallback) return res.status(400).json({ success: false, error: '회신번호를 선택해주세요' });
    if (!useIndividualCallback && callback) {
      const nc = normalizePhone(callback);
      if (nc.length < 8 || nc.length > 11) return res.status(400).json({ success: false, error: '유효하지 않은 회신번호입니다.', code: 'INVALID_CALLBACK_FORMAT' });
      const senderCheck = await query(
        `SELECT phone FROM (SELECT REPLACE(phone_number, '-', '') AS phone FROM sender_numbers WHERE company_id = $1 AND is_active = true UNION SELECT REPLACE(phone, '-', '') AS phone FROM callback_numbers WHERE company_id = $1) t WHERE phone = $2 LIMIT 1`,
        [companyId, nc]
      );
      if (senderCheck.rows.length === 0) return res.status(400).json({ success: false, error: '등록되지 않은 회신번호입니다. 발신번호 관리에서 번호를 등록해주세요.', code: 'INVALID_SENDER_NUMBER' });
    }
    let alimtalkEtcJson: string | null = null;
    let alimtalkTemplateUuid: string | null = null;  // ★ #4-a (2026-06-01): 결과 조회용 campaigns.kakao_template_id FK (results.ts:560 JOIN)
    let alimtalkButtonJsonResolved: string | null = alimtalkButtonJson || null;  // ★ 버그1: 템플릿 buttons로 보강(아래)
    if (isAlimtalkSend) {
      if (!alimtalkTemplateCode) return res.status(400).json({ success: false, error: '알림톡 템플릿 코드가 필요합니다' });
      const gate = await query(
        `SELECT t.id AS tid, t.status AS tstatus, t.content AS tcontent, t.buttons AS tbuttons, t.emphasize_title AS temphasize_title, t.represent_link AS trepresent_link, p.approval_status, p.profile_key FROM kakao_templates t JOIN kakao_sender_profiles p ON p.id = t.profile_id AND p.company_id = t.company_id WHERE t.company_id = $1 AND t.template_code = $2 LIMIT 1`,
        [companyId, alimtalkTemplateCode]
      );
      if (gate.rows.length === 0) return res.status(404).json({ success: false, error: '템플릿을 찾을 수 없습니다' });
      const g = gate.rows[0];
      if (!['APPROVED', 'APR', 'A'].includes(String(g.tstatus).toUpperCase())) return res.status(400).json({ success: false, error: '승인 완료된 템플릿만 발송할 수 있습니다' });
      if (g.approval_status !== 'APPROVED') return res.status(400).json({ success: false, error: '승인 완료된 발신프로필만 사용할 수 있습니다' });
      // ★ CT-87 (2026-06-10): 검수 승인 + 카카오 활성(A)까지 확인 — 활성 대기(R) 템플릿은 카카오가 전부 7300으로 거부
      const commitTplGuard = decideKakaoTemplateSendable(await getImcTemplateStatusSafe(companyId, alimtalkTemplateCode));
      if (!commitTplGuard.sendable) return res.status(400).json({ success: false, error: commitTplGuard.reason, code: commitTplGuard.code });
      // ★ 매뉴얼(qtmsg): k_etc_json = 강조표기 title(raw)만 — senderkey는 여기서 만들지 않음(표준 라인=중계서버 자동, 비토 라인=CT-04 insertAlimtalkQueue가 주입) / k_button_json = 템플릿 buttons(프론트 전송은 폴백)
      //   title은 #{변수} 포함 가능 — staging worker(direct-send-processor)가 수신자 row별로 치환해 재생성한다.
      alimtalkEtcJson = buildAlimtalkEtcJson({ emphasizeTitle: g.temphasize_title, representLink: g.trepresent_link }) ?? null;
      alimtalkButtonJsonResolved = convertButtonsToQTmsg(g.tbuttons) || alimtalkButtonJson || null;
      alimtalkTemplateUuid = g.tid || null;  // ★ #4-a: 검증 통과한 템플릿 id 보관 → INSERT 저장
      // ★ #3-2 (2026-06-01): 변수 미지정 발송 차단 (백엔드 이중 안전망 — 프론트 우회 대비)
      const commitUnfilled = findUnfilledAlimtalkVars(g.tcontent, alimtalkVariableMap);
      if (commitUnfilled.length > 0) {
        return res.status(400).json({ success: false, error: `값을 지정하지 않은 알림톡 변수가 있습니다: ${commitUnfilled.join(', ')}`, code: 'ALIMTALK_VAR_UNFILLED' });
      }
    }
    if (scheduled) {
      const dsCheck = validateScheduledAt(scheduledAt, { allowNull: false });
      if (!dsCheck.valid) return res.status(400).json({ success: false, error: dsCheck.error });
    }

    // ★ 2026-06-04 정정: 정제(DELETE)를 commit에서 빼고 worker가 발송 직전에 수행 → commit 즉시 응답(504 원천 차단).
    //   여기선 count endpoint와 같은 헬퍼로 발송 예정 건수만 COUNT(차감·캠페인 target_count). staging은 안 건드린다.
    //   worker가 같은 기준으로 실제 제거하므로 모달 숫자 = 차감 = 실제 발송이 일치한다.
    const { sendCount: total } = await countStagingFiltered(stagingId, companyId, userId, dedupEnabled, unsubFilterEnabled);
    if (total === 0) return res.status(400).json({ success: false, error: '정제 후 발송 대상이 없습니다 (전부 수신거부 또는 중복).' });

    // 캠페인 생성 + 차감 + worker 트리거 — createDirectSendCampaign 공유(자율 발송과 동일 경로, MMS 이미지 컬럼 저장 포함).
    try {
      const { campaignId, accepted } = await createDirectSendCampaign({
        stagingId, campaignName: `직접발송 ${new Date().toLocaleString('ko-KR')}`,
        msgType: commitMsgResolved.messageType, message, subject, callback, sendChannel: commitChannel.channel, adEnabled, total,
        scheduled, scheduledAt, splitEnabled, splitCount, useIndividualCallback, individualCallbackColumn, mmsImagePaths,
        dedupEnabled, unsubFilterEnabled,
        kakaoBubbleType, kakaoSenderKey, kakaoTargeting, kakaoAttachmentJson, kakaoCarouselJson, kakaoResendType,
        alimtalkTemplateCode, alimtalkVariableMap, alimtalkButtonJson: alimtalkButtonJsonResolved, alimtalkNextType, alimtalkNextContents, alimtalkNextSubject,
        alimtalkEtcJson, alimtalkTemplateUuid,
      }, { companyId, userId }, { finalSource: 'manual' });

      return res.status(202).json({
        success: true, campaignId, accepted,
        message: `${accepted}건 발송이 접수됐습니다. 진행 상황은 발송결과에서 확인하세요.`,
      });
    } catch (e: any) {
      if (e instanceof DirectSendError && e.code === 'INSUFFICIENT_BALANCE') {
        return res.status(402).json({ success: false, error: e.message, ...(e.extra || {}) });
      }
      // ★ 2026-07-02 그 외 DirectSendError(링크 placeholder 가드 등) = 정의된 상태코드 + 사용자 친화 메시지
      if (e instanceof DirectSendError) {
        return res.status(e.httpStatus || 400).json({ success: false, error: e.message, code: e.code, ...(e.extra || {}) });
      }
      throw e;
    }
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, code: 'DB_MIGRATION_PENDING', error: 'DB 마이그레이션 필요: campaigns staging 컬럼 ALTER 요청' });
    }
    if (msg.includes('relation') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, code: 'DB_MIGRATION_PENDING', error: 'DB 마이그레이션 필요: campaign_send_staging 테이블' });
    }
    console.error('[direct-send/commit] 오류:', err);
    return res.status(500).json({ success: false, error: '발송 접수 중 오류가 발생했습니다.' });
  }
});

// ★ 대량 발송 파이프라인 (2026-05-30) — Task 6: 발송 진행률 조회 (적재 → 처리 → 완료)
router.get('/:id/send-progress', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });
    const result = await query(
      `SELECT target_count, processed_count, send_phase, sent_count, fail_count FROM campaigns WHERE id = $1 AND company_id = $2`,
      [req.params.id, companyId]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다' });
    const r = result.rows[0];
    const total = r.target_count || 0;
    const processed = r.processed_count || 0;
    const percent = total > 0 ? Math.floor((processed / total) * 100) : 0;
    return res.json({
      success: true,
      total, processed, percent,
      phase: r.send_phase || null,
      sentCount: r.sent_count || 0,
      failCount: r.fail_count || 0,
    });
  } catch (err: any) {
    console.error('[send-progress] 진행률 조회 오류:', err);
    return res.status(500).json({ success: false, error: '진행률 조회 중 오류가 발생했습니다.' });
  }
});

router.post('/direct-send', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    const userType = (req as any).user?.userType;
    if (!companyId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }

    const companyTables = await getCompanySmsTables(companyId, userId);

    // ★ 1차 방어: 라인그룹 미설정 발송 차단
    if (!(await hasCompanyLineGroup(companyId))) {
      console.warn(`[라인방어] 직접발송 차단 — companyId: ${companyId}, 라인그룹 미설정`);
      return res.status(400).json({
        success: false,
        error: '발송 라인그룹이 설정되지 않았습니다. 관리자에게 문의해주세요.',
        code: 'LINE_GROUP_NOT_SET'
      });
    }

    const {
      msgType,        // SMS, LMS, MMS
      subject,        // 제목 (LMS/MMS)
      message,        // 메시지 내용 (광고문구 포함된 최종 메시지)
      callback,       // 회신번호
      recipients,     // [{phone, name, extra1, extra2, extra3}]
      customMessages, // ★ S9-01: [{phone, message}] — 프론트에서 치환 완료된 개인화 메시지
      adEnabled,      // 광고문구 포함 여부
      scheduled,      // 예약 여부
      scheduledAt,    // 예약 시간
      splitEnabled,   // 분할전송 여부
      splitCount,     // 분당 발송 건수
      useIndividualCallback,  // 개별회신번호 사용 여부
      individualCallbackColumn,  // ★ D99: 회신번호로 사용할 컬럼명 (store_phone, callback, custom_N 등)
      confirmCallbackExclusion, // ★ 미등록 회신번호 제외 확인 플래그
      mmsImagePaths,  // MMS 이미지 서버 경로 배열
      // 카카오 브랜드메시지 필드
      sendChannel,          // sms / kakao / both / alimtalk
      kakaoBubbleType,      // TEXT, IMAGE, WIDE 등
      kakaoSenderKey,       // 발신 프로필 키
      kakaoTargeting,       // I/M/N
      kakaoAttachmentJson,  // 버튼/이미지 JSON
      kakaoCarouselJson,    // 캐러셀 JSON
      kakaoResendType,      // SM/LM/NO
      targetFilter,         // 금액필터 등 타겟 조건
      // 알림톡 필드 (D130: 설계서 §6-3-D 반영)
      alimtalkTemplateCode,  // 알림톡 템플릿 코드
      alimtalkTemplateId,    // (선택) PG kakao_templates.id — 승인 상태 이중 가드용
      alimtalkProfileId,     // (선택) 발신프로필 id — 승인/소속 검증용
      alimtalkVariableMap,   // { "#{name}": "@@name@@" | "직접값" } — 프론트 수동 매핑
      alimtalkButtonJson,    // 알림톡 버튼 JSON (k_button_json 형식)
      alimtalkNextType,      // 실패 시 폴백 (N/S/L/A/B)
      alimtalkNextContents,  // A/B 타입일 때 대체 문구 (k_next_contents)
      alimtalkNextSubject,   // ★ D224+ (2026-05-27) 영업팀장 박성용 신고 fix: L/B 타입일 때 LMS 대체 제목 (옛 D218+ destructure 누락)
      // ★ D102: 중복제거/수신거부제거 사용자 선택 (기본 true)
      dedupEnabled = true,
      unsubFilterEnabled = true,
      // ★ 2026-08-18 출처 축 — 이 라우트를 부르는 곳이 직접발송 화면만이 아니다(AI 오퍼레이터 승인 발송).
      //   둘 다 선택이고, 안 보내면 기존 동작과 한 글자도 다르지 않다.
      campaignName,         // (선택) 호출부가 지은 캠페인명. 없으면 서버가 `직접발송 {일시}`로 짓는다
      sendType,             // (선택) send_type 값. CT 화이트리스트 밖이면 무시하고 'direct'
    } = req.body;

    // ★ 화이트리스트 밖 값은 **거절이 아니라 강등**한다 — 여기서 400을 내면 옛 프론트가 예상 못 한 값을
    //   보내던 순간 발송 자체가 막힌다. 축이 틀리는 것보다 발송이 멎는 쪽이 더 크다.
    //   `campaigns.send_type`에는 CHECK가 없어(send-type-axis 주석의 pg_constraint 실측) 임의 문자열도
    //   INSERT는 통과한다 — 그래서 이 게이트가 유일한 방어다.
    //
    // ★ 2026-08-18 (Codex 적대 검토 high #1) 게이트를 `isSendTypeFilter`에서 `isDirectPipelineSendType`으로.
    //   전자는 **화면 필터가 아는 값**을 묻는 함수라 `ai`·`auto`·`journey`까지 통과시켰다.
    //   그 값들은 각자 다른 배관이 만들고 `campaign_runs`를 남기는데, 이 라우트로 들어온 행은 runs가 없다.
    //   그러면 run 축에도 안 잡히고 청구 선택기(direct·operator)에도 안 걸려 **실발송이 청구에서 사라진다**.
    //   조용히 떨어뜨리지 않고 로그를 남긴다 — 이 경로로 오는 값은 프론트 버그거나 조작이라 둘 다 봐야 한다.
    const resolvedSendType: string = isDirectPipelineSendType(sendType) ? sendType : 'direct';
    if (sendType !== undefined && sendType !== null && sendType !== '' && !isDirectPipelineSendType(sendType)) {
      console.warn(
        `[직접발송] 배관 밖 send_type 강등 — company=${companyId} user=${userId} raw=${JSON.stringify(sendType)} → 'direct'`,
      );
    }
    const rawName = typeof campaignName === 'string' ? campaignName.trim() : '';
    const resolvedCampaignName = rawName
      ? rawName.slice(0, 200)
      : `직접발송 ${new Date().toLocaleString('ko-KR')}`;

    // ★ 2026-08-17 발송 채널 확정 — **이 라우트의 첫 검사**로 둔다.
    //   이 문의 적재 분기는 sms·both / kakao·both / alimtalk 셋뿐인데 차감은 채널을 안 보고 먼저 일어난다.
    //   그래서 이 문이 처리하지 못하는 값이 오면 캠페인 생성 + 차감 + **적재 0건**으로 끝나고 응답은 성공이었다
    //   (실측: 죽은 프론트 분기가 보내던 `'rcs'`뿐 아니라 임의 문자열·배열도 통과했고,
    //    브랜드 전용 `kakao_brand`는 이 문에 적재 분기가 없는데 BRAND 단가로 차감됐다).
    //   ⚠ 아래로는 resolver가 돌려준 `directChannel`만 쓴다 — `sendChannel` 원본을 다시 읽지 않는다.
    //     원본을 읽으면 배열·공백이 하위 기본값 처리를 그대로 통과해(`[] || 'sms'`는 빈 배열이다)
    //     적재 분기에서만 빗나간다.
    const directResolved = resolveSendChannel('direct', sendChannel);
    if (!directResolved.ok) {
      console.warn(`[직접발송] 발송 채널 거절 — company=${companyId} raw=${JSON.stringify(sendChannel)} reason=${directResolved.reason}`);
      return res.status(400).json({ success: false, error: directResolved.reason, code: 'UNSUPPORTED_SEND_CHANNEL' });
    }
    const directChannel = directResolved.channel;

    // ★ 2026-08-17 (Codex 2R high) 메시지 유형도 여기서 확정한다 — 채널 게이트로는 안 걸리는 **별개 축**이다.
    //   아래 차감이 `msgType`을 그대로 유형으로 넘기는데, 목록 밖 값은 단가표에 없어 `unknownType`으로
    //   **0원 통과**하고(= 무료 발송) 큐에는 `toQtmsgType`이 LMS로 바꿔 넣는다. 즉 나가긴 나가는데 요금이 0이다.
    //   (캠페인 경로에만 게이트를 넣고 이 문을 빠뜨린 것이 1차 정정의 누락이었다)
    const directMsgResolved = resolveChargeMessageType(msgType);
    if (!directMsgResolved.ok) {
      console.warn(`[직접발송] 메시지 유형 거절 — company=${companyId} raw=${JSON.stringify(msgType)} reason=${directMsgResolved.reason}`);
      return res.status(400).json({ success: false, error: directMsgResolved.reason, code: 'UNSUPPORTED_MESSAGE_TYPE' });
    }

    // ★ D143 (2026-05-04, 정식 오픈 D-Day 1일 전) — D142+ 자동 승격 정책 폐지
    //   정책 변경 사유 (Harold님 명시): 사용자가 광고체크 OFF + 본문에 (광고)/무료거부 복붙한
    //   케이스에서 D142+가 본문 깎고 is_ad 강제 승격 → 사용자 의도 무시 → 정합성 위반
    //   새 정책: 사용자 입력 본문 그대로 저장 + 광고체크 의도 그대로 저장
    //   변수명은 호환성 위해 유지 (sanitizedMessage = 사용자 입력 그대로)
    const sanitizedMessage = message || '';   // ★ D143: sanitize 미적용 — 사용자 입력 보존
    const finalIsAd = adEnabled === true;     // ★ D143: 자동 승격 제거 — 사용자 광고체크 그대로

    // ★ D102: customMessageMap 제거 — 프론트 치환 폐기, 백엔드 replaceVariables 컨트롤타워 통일

    if (!recipients || recipients.length === 0) {
      return res.status(400).json({ success: false, error: '수신자가 없습니다' });
    }

    // ★ D131: MMS 이미지 첨부 필수 가드 — mms-validator 컨트롤타워
    const directMmsCheck = validateMmsPayload(msgType, mmsImagePaths);
    if (!directMmsCheck.ok) {
      return res.status(400).json({ success: false, error: directMmsCheck.error, code: directMmsCheck.code });
    }

    // ★ D111 P4: 예약 시각 검증 — 컨트롤타워 validateScheduledAt
    //   scheduled=false면 scheduledAt 무시, scheduled=true면 과거/미래 검증
    if (scheduled) {
      const dsCheck = validateScheduledAt(scheduledAt, { allowNull: false });
      if (!dsCheck.valid) {
        return res.status(400).json({ success: false, error: dsCheck.error });
      }
    }

    // ★ D102: 중복제거 — 사용자 선택에 따라 적용 (기본 true)
    let finalRecipients = recipients;
    let duplicateCount = 0;
    if (dedupEnabled !== false) {
      const dedupResult = deduplicateByPhone(recipients);
      finalRecipients = dedupResult.unique;
      duplicateCount = dedupResult.duplicateCount;
      if (duplicateCount > 0) {
        console.log(`[직접발송] 중복제거: ${recipients.length}건 → ${finalRecipients.length}건 (${duplicateCount}건 제거)`);
      }
    }

    // ★ 2026-07-05 발송 피로도 보호 — 고객DB 타겟 행(r.id 보유)만 게이트.
    //   수동 입력/파일 행(id 없음) = 사용자 명시 행동이라 제외하지 않음 (Harold 확정 정책).
    let directFatigueSkipped = 0;
    if (adEnabled === true) {
      const directFatigueCap = await getFatigueCap(companyId);
      if (directFatigueCap) {
        const dbRows = finalRecipients.filter((r: any) => r.id);
        if (dbRows.length > 0) {
          const blockedSet = await getFatigueBlockedSet(companyId, directFatigueCap, dbRows.map((r: any) => String(r.phone || '')));
          if (blockedSet.size > 0) {
            const beforeFatigue = finalRecipients.length;
            finalRecipients = finalRecipients.filter((r: any) => !r.id || !blockedSet.has(normalizePhone(String(r.phone || ''))));
            directFatigueSkipped = beforeFatigue - finalRecipients.length;
          }
        }
        if (finalRecipients.length === 0) {
          return res.status(400).json({ success: false, error: `발송 대상이 없습니다. (피로도 보호 ${directFatigueSkipped}명 제외)`, fatigueSkippedCount: directFatigueSkipped });
        }
      }
    }

    // ★ D91: LMS/MMS 제목 필수 검증
    // ★ D218+ (2026-05-26) PDF 신고 #4 사고 정정: alimtalk 발송 path (frontend msgType='LMS' 강제 설정 — D162-4 정합)
    //   에서 alimtalkNextType이 'L'(LMS 대체) 또는 'B'(LMS+문구) 아닐 경우 subject 검증 skip 의무.
    //   옛 사고 = 'N'(대체 안 함) / 'S'(SMS 대체) / 'A'(SMS+문구) 모든 옵션에서 동일 토스트 발화 (Harold PDF 신고).
    // ★ D224+ (2026-05-27) 영업팀장 박성용 신고 fix: 알림톡 흐름 시 검증 대상 컬럼 정정.
    //   옛 D218+ = subject 검증 → 알림톡 흐름에서 subject는 일반 directSubject (사용자 입력 X) = 항상 빈 값 → L/B 시 alimtalkNextSubject 입력했어도 영구 알럴 발생 사고.
    //   진정 fix = 알림톡 L/B 흐름 시 alimtalkNextSubject 검증 + 일반 LMS/MMS 흐름 시 subject 검증 (분기 분리).
    const isAlimtalkSend = directChannel === 'alimtalk';
    if (isAlimtalkSend) {
      // ★ 2026-07-27: 전환재발송 검증을 CT(alimtalk-fallback) 단일 기준으로 통일.
      //   L/B = LMS 제목 필수(기존 규칙 유지) + A/B = 대체문안 필수(신규 — 빈 문안이 큐에 들어가던 구멍).
      const violation = validateAlimtalkFallback({
        nextType: alimtalkNextType,
        nextContents: alimtalkNextContents,
        nextSubject: alimtalkNextSubject,
      });
      if (violation) return res.status(400).json({ success: false, error: violation });
    } else if (!isAlimtalkSend && (msgType === 'LMS' || msgType === 'MMS')) {
      // 일반 LMS/MMS 발송: 기존 subject 검증 유지 (옛 D91)
      if (!subject?.trim()) {
        return res.status(400).json({ success: false, error: 'LMS/MMS 발송 시 제목을 입력해주세요.' });
      }
    }
    // N(대체안함) / S(SMS 대체) / A(SMS+문구) = 알림톡 LMS 제목 검증 skip (옛 D218+ 흐름 정합 유지)

    // ★ #3-2 (2026-06-01): 알림톡 변수 미지정 발송 차단 (백엔드 이중 안전망)
    // ★ 2026-06-02: 템플릿 본문 변수 전체 기준 검증 — variableMap이 비어 변수가 통째로 누락돼도 잡도록 content 조회 후 전달.
    if (isAlimtalkSend) {
      let directTplContent = '';
      if (alimtalkTemplateCode) {
        const tplRow = await query(
          `SELECT content FROM kakao_templates WHERE company_id = $1 AND template_code = $2 LIMIT 1`,
          [companyId, alimtalkTemplateCode]
        );
        directTplContent = tplRow.rows[0]?.content || '';
      }
      const directUnfilled = findUnfilledAlimtalkVars(directTplContent, alimtalkVariableMap);
      if (directUnfilled.length > 0) {
        return res.status(400).json({ success: false, error: `값을 지정하지 않은 알림톡 변수가 있습니다: ${directUnfilled.join(', ')}`, code: 'ALIMTALK_VAR_UNFILLED' });
      }
    }

    if (!callback && !useIndividualCallback) {
      return res.status(400).json({ success: false, error: '회신번호를 선택해주세요' });
    }

    // ★ #4: 회신번호 등록 여부 검증 (개별회신번호가 아닌 경우)
    if (!useIndividualCallback && callback) {
      const normalizedCallback = normalizePhone(callback);

      // 회신번호 최소 길이 검증 (한국 전화번호 최소 8자리)
      if (normalizedCallback.length < 8 || normalizedCallback.length > 11) {
        return res.status(400).json({
          success: false,
          error: '유효하지 않은 회신번호입니다. 올바른 전화번호 형식으로 입력해주세요.',
          code: 'INVALID_CALLBACK_FORMAT'
        });
      }

      const senderCheck = await query(
        `SELECT phone FROM (
          SELECT REPLACE(phone_number, '-', '') as phone FROM sender_numbers WHERE company_id = $1 AND is_active = true
          UNION SELECT REPLACE(phone, '-', '') as phone FROM callback_numbers WHERE company_id = $1
        ) t WHERE phone = $2 LIMIT 1`,
        [companyId, normalizedCallback]
      );
      if (senderCheck.rows.length === 0) {
        return res.status(400).json({ success: false, error: '등록되지 않은 회신번호입니다. 발신번호 관리에서 번호를 등록해주세요.', code: 'INVALID_SENDER_NUMBER' });
      }
    }

    // ★ CT-08: 개별회신번호 필터링 — callback-filter.ts 컨트롤타워 사용
    let validRecipients: any[] = [...finalRecipients];
    let callbackSkippedCount = 0;
    let callbackMissingCount = 0;
    let callbackUnregisteredCount = 0;
    if (useIndividualCallback) {
      // D91: admin/company_admin은 배정 필터 미적용 (전체 번호 사용 가능)
      const cbUserId = (userType === 'super_admin' || userType === 'company_admin') ? undefined : userId;
      // ★ D99: direct-send에서는 프론트가 이미 선택된 컬럼값을 callback에 매핑해서 전달하므로
      // callbackColumn을 CT-08에 전달하지 않음 (recipients에 원본 컬럼 필드가 없으므로 전달하면 덮어씌워짐)
      console.log(`[direct-send] 개별회신번호 필터 시작 — recipients: ${validRecipients.length}, confirmCallbackExclusion: ${confirmCallbackExclusion}`);
      const cbResult = await filterByIndividualCallback(validRecipients, companyId, cbUserId);
      validRecipients = cbResult.filtered;
      callbackMissingCount = cbResult.callbackMissingCount;
      callbackUnregisteredCount = cbResult.callbackUnregisteredCount;
      callbackSkippedCount = cbResult.callbackSkippedCount;
      console.log(`[direct-send] 필터 결과 — skipped: ${callbackSkippedCount}, missing: ${callbackMissingCount}, unregistered: ${callbackUnregisteredCount}, remaining: ${validRecipients.length}`);

      // ★ 미등록 회신번호 확인 모달 — 제외 건이 있고 confirmCallbackExclusion 없으면 항상 확인 모달 반환
      if (cbResult.callbackSkippedCount > 0 && !confirmCallbackExclusion) {
        const confirmBody = buildCallbackConfirmResponse(cbResult, validRecipients.length);
        console.log(`[direct-send] ★ 확인 모달 반환 — callbackConfirmRequired: true, remaining: ${validRecipients.length}`);
        return res.status(200).json({ success: false, ...confirmBody });
      }

      if (validRecipients.length === 0) {
        const errBody = buildCallbackErrorResponse(callbackMissingCount, callbackUnregisteredCount);
        return res.status(400).json({ success: false, ...errBody });
      }
    }

    // 0. 금액필터 적용 (targetFilter가 있을 경우)
    let targetFilteredRecipients = validRecipients;
    if (targetFilter && Object.keys(targetFilter).length > 0) {
      const amountFields = Object.keys(targetFilter).filter(k =>
        k.includes('amount') || k.includes('purchase') || k.includes('금액')
      );
      if (amountFields.length > 0) {
        const recipientPhones = finalRecipients.map((r: any) => normalizePhone(r.phone));
        let filterWhere = 'c.company_id = $1 AND c.phone = ANY($2::text[]) AND c.is_active = true';
        const filterParams: any[] = [companyId, recipientPhones];
        let pIdx = 3;

        for (const [key, condition] of Object.entries(targetFilter)) {
          if (typeof condition === 'object' && condition !== null) {
            const cond = condition as any;
            if (cond.operator === 'between' && Array.isArray(cond.value)) {
              filterWhere += ` AND c.${key} BETWEEN $${pIdx++} AND $${pIdx++}`;
              filterParams.push(cond.value[0], cond.value[1]);
            } else if (cond.operator === 'gte') {
              filterWhere += ` AND c.${key} >= $${pIdx++}`;
              filterParams.push(cond.value);
            } else if (cond.operator === 'lte') {
              filterWhere += ` AND c.${key} <= $${pIdx++}`;
              filterParams.push(cond.value);
            }
          }
        }

        const validResult = await query(
          `SELECT c.phone FROM customers c WHERE ${filterWhere}`,
          filterParams
        );
        const validPhones = new Set(validResult.rows.map((r: any) => normalizePhone(r.phone)));
        const beforeCount = targetFilteredRecipients.length;
        targetFilteredRecipients = targetFilteredRecipients.filter((r: any) => validPhones.has(normalizePhone(r.phone)));
        if (targetFilteredRecipients.length < beforeCount) {
          console.log(`[직접발송] 금액필터: ${beforeCount}명 → ${targetFilteredRecipients.length}명`);
        }
      }
    }

    // ★ D102: 수신거부 필터링 — 사용자 선택에 따라 적용 (기본 true)
    let filteredRecipients = targetFilteredRecipients;
    let excludedCount = 0;
    if (unsubFilterEnabled !== false) {
      const phones = targetFilteredRecipients.map((r: any) => normalizePhone(r.phone));
      const unsubResult = await query(
        `SELECT DISTINCT phone FROM unsubscribes WHERE user_id = $1 AND phone = ANY($2)`,
        [userId, phones]
      );
      const unsubPhones = new Set(unsubResult.rows.map((r: any) => r.phone));
      filteredRecipients = targetFilteredRecipients.filter((r: any) => !unsubPhones.has(normalizePhone(r.phone)));
      excludedCount = targetFilteredRecipients.length - filteredRecipients.length;
    }

    if (filteredRecipients.length === 0) {
      return res.status(400).json({ success: false, error: '모든 수신자가 수신거부 상태이거나 필터 조건에 해당하지 않습니다' });
    }

    // 2. 캠페인 레코드 생성 (원본 템플릿도 저장)
    // (채널 확정은 이 라우트 앞머리에서 끝났다 — 2026-08-17. `directChannel`이 그 결과다.)

    // ★ 카카오 활성화 체크 (프론트 우회 방지)
    if (directChannel === 'kakao' || directChannel === 'both') {
      const kakaoCheck = await query('SELECT kakao_enabled FROM companies WHERE id = $1', [companyId]);
      if (!kakaoCheck.rows[0]?.kakao_enabled) {
        return res.status(403).json({ success: false, error: '카카오 브랜드메시지가 활성화되지 않은 고객사입니다.', code: 'KAKAO_NOT_ENABLED' });
      }
    }

    // ★ 2026-08-04 알림톡 승인 게이트를 **차감 앞**으로 올렸다.
    //   전에는 이 검증이 prepaidDeduct 뒤(발송 블록 안)에 있어서, 미승인 템플릿·미승인 프로필로
    //   요청이 오면 큐 적재는 0건인데 차감만 남았다 — 그 자리의 return 5개에는 캠페인 DELETE도
    //   환불도 없다. 검증 대상(템플릿·프로필 승인 상태)은 수신자·금액과 무관하므로 캠페인 생성 전에 끝낸다.
    //   (LESSONS_BACKEND 핵심원칙 — "차감이 끝나기 전에는 발송 가능 상태를 만들지 마라")
    //   대용량 경로 `/direct-send/commit`은 처음부터 게이트가 앞이라 이 정정 대상이 아니다.
    if (directChannel === 'alimtalk') {
      if (!alimtalkTemplateCode) {
        return res.status(400).json({ success: false, error: '알림톡 템플릿 코드가 필요합니다' });
      }

      // ★ D130: 승인 이중 가드 — 발신프로필 APPROVED + 템플릿 APPROVED 확인
      const gateCheck = await query(
        `SELECT t.id AS tid,
                t.status AS tstatus,
                t.buttons AS tbuttons,
                t.emphasize_title AS temphasize_title,
                t.represent_link AS trepresent_link,
                p.id AS pid,
                p.approval_status,
                p.profile_key
           FROM kakao_templates t
           -- ★ 2026-08-04 (Codex 2R critical) 프로필도 같은 회사만. p를 id로만 조인하면
           --   템플릿의 profile_id가 타사 프로필을 가리킬 때 **그 회사의 승인 상태로 게이트를 통과**한다.
           JOIN kakao_sender_profiles p ON p.id = t.profile_id AND p.company_id = t.company_id
          WHERE t.company_id = $1
            AND t.template_code = $2
          LIMIT 1`,
        [companyId, alimtalkTemplateCode]
      );
      if (gateCheck.rows.length === 0) {
        return res.status(404).json({ success: false, error: '템플릿을 찾을 수 없습니다' });
      }
      const preGate = gateCheck.rows[0];
      if (!['APPROVED', 'APR', 'A'].includes(String(preGate.tstatus).toUpperCase())) {
        return res.status(400).json({ success: false, error: '승인 완료된 템플릿만 발송할 수 있습니다' });
      }
      if (preGate.approval_status !== 'APPROVED') {
        return res.status(400).json({ success: false, error: '승인 완료된 발신프로필만 사용할 수 있습니다' });
      }
      // ★ CT-87 (2026-06-10): 카카오 활성상태(A) 가드 — 활성 대기(R)/중단(S) 템플릿 사전 차단
      const directTplGuard = decideKakaoTemplateSendable(await getImcTemplateStatusSafe(companyId, alimtalkTemplateCode));
      if (!directTplGuard.sendable) {
        return res.status(400).json({ success: false, error: directTplGuard.reason, code: directTplGuard.code });
      }
    }

    // ★ B+0407 후속: is_ad 컬럼 INSERT 추가
    //   기존: 컬럼 자체가 누락되어 항상 DEFAULT(false)로 저장 → 광고 ON 발송이 발송결과에서 (광고) 미표시 + 캘린더 잘못 표시 등 연쇄 버그 발생
    const campaignResult = await query(
      // ★ 2026-08-18 `send_type`이 리터럴 'direct'였다 — 이 라우트를 부르는 곳이 직접발송 화면만이
      //   아닌데도(AI 오퍼레이터 승인 발송이 같은 배관을 쓴다) 전부 '직접발송'으로 적재됐고,
      //   캠페인명까지 서버가 `직접발송 {일시}`로 덮어써서 행에 출처 흔적이 하나도 남지 않았다.
      //   호출부가 밝힌 값을 쓰되 안 밝히면 기존과 똑같이 동작한다(기본 'direct').
      //   ⚠ 파라미터 번호는 뒤에 덧붙인다($22) — 중간에 끼우면 아래 14개를 전부 밀어야 해서 오적재 위험이 크다.
      `INSERT INTO campaigns (company_id, campaign_name, message_type, message_content, subject, callback_number, target_count, send_type, status, scheduled_at, message_template, message_subject, created_by, mms_image_paths,
        send_channel, kakao_bubble_type, kakao_sender_key, kakao_targeting, kakao_attachment_json, kakao_carousel_json, kakao_resend_type, is_ad, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $22, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, NOW())
       RETURNING id`,
      [
        companyId,
        resolvedCampaignName,
        msgType,
        sanitizedMessage,  // ★ D142+ B1: stripAdParts로 (광고)/무료거부 제거된 순수본문 (D103)
        subject || null,
        callback,
        filteredRecipients.length,
        scheduled ? 'scheduled' : 'sending',
        scheduled && scheduledAt ? new Date(scheduledAt) : null,
        sanitizedMessage,  // ★ D142+ B1: message_template 도 순수본문 동일 적용
        subject || null,  // message_subject: 원본 제목
        userId,  // created_by: 발송자
        mmsImagePaths && mmsImagePaths.length > 0 ? JSON.stringify(mmsImagePaths) : null,
        directChannel,
        kakaoBubbleType || null,
        kakaoSenderKey || null,
        kakaoTargeting || 'I',
        kakaoAttachmentJson || null,
        kakaoCarouselJson || null,
        kakaoResendType || 'SM',
        finalIsAd,  // ★ D142+ B1: 본문에 (광고) 마커 있으면 사용자 의도가 광고라 보고 자동 승격
        resolvedSendType,  // $22 — 위 주석 참조(호출부가 안 밝히면 'direct')
      ]
    );
    const campaignId = campaignResult.rows[0].id;

    // ★ C1: 채널별 발송 성공 건수 추적 (선별적 환불 계산용)
    // ★ 2026-07-27 (B-0727-2): try **밖**으로 올린다. 전체 실패 catch가 "실제로 큐에 들어간 수"를 봐야
    //   미적재분만 환불한다. 안에서 선언하면 catch가 그 값을 못 봐, 적재는 다 됐는데 뒤 후처리만
    //   실패한 경우에도 전량을 미적재로 환불해 실발송분까지 돌려주게 된다.
    // 차감 유형은 catch(축별 환불)도 봐야 하므로 try 밖에서 확정한다.
    // 이번 요청에서 실제로 차감한 축만 되돌린다(AI 경로와 같은 계약 — preflight throw는 차감 전에도 온다).
    const directDeductedAxes = new Set<string>();
    const directDeductType = isBrandOnlyChannel(directChannel) ? 'BRAND' : directMsgResolved.messageType;

    let directSmsSentCount = 0;
    let directKakaoSentCount = 0;
    let directAlimtalkSentCount = 0;

    // ★ P0-3: 차감 성공 후 발송 실패 시 자동 환불 보장
    try {

    // 2. MySQL 큐에 메시지 삽입 — 회사 라인그룹 테이블 라운드로빈 분배
    const isScheduledSend = scheduled && scheduledAt;

    // ★ D102: 080 수신거부번호 — CT-AD 컨트롤타워 사용
    // ★ D142+ B1: finalIsAd(광고 자동 승격 결과) 기준 — 사용자가 본문에 (광고) 박았으면 080번호 조회
    const directOpt080 = finalIsAd ? await getOpt080Number(userId, companyId) : '';

    // ★ D102: prepareFieldMappings 컨트롤타워로 통합 (customer_schema 조회 + extractVarCatalog + enrichWithCustomFields)
    const directFieldMappings = await prepareFieldMappings(companyId);
    // ★ storageType 기반 동적 필터 — 직접 컬럼만 SELECT, JSONB 내부 키는 custom_fields 컬럼에서 접근 (D72)
    const directMappingCols = Object.values(directFieldMappings).filter((m: any) => m.storageType !== 'custom_fields').map((m: any) => m.column);
    const directSelectCols = [...new Set(['phone', 'custom_fields', ...directMappingCols])].join(', ');
    const directPhoneList = filteredRecipients.map((r: any) => normalizePhone(r.phone));
    const directCustomersResult = await query(
      `SELECT ${directSelectCols} FROM customers WHERE company_id = $1 AND phone = ANY($2)`,
      [companyId, directPhoneList]
    );
    const directCustomerMap = new Map<string, Record<string, any>>();
    directCustomersResult.rows.forEach((c: any) => {
      directCustomerMap.set(normalizePhone(c.phone), c);
    });


    // ★ 2026-08-18 preflight — **조립·검증을 차감·적재 앞으로** 옮겼다.
    //   전에는 [차감 → 문자 적재 → 브랜드 조립·검증 → 브랜드 적재] 순서라, 규격 위반이
    //   3단계에서 throw하면 **돈은 이미 움직였고 문자는 이미 나간** 뒤였다(both에서 BRAND 차감 잔존·
    //   문자만 발송 후 500). 검증을 아무리 정교하게 만들어도 위치가 그대로면 같은 사고가 반복된다.
    //   이제 두 채널의 행을 **전량 만들어 본 뒤**에 차감한다 — 규격 위반은 돈이 움직이기 전에 끝난다.
    const directSmsRows: any[][] = [];
    const useNow = !isScheduledSend && !(splitEnabled && splitCount > 0);
    // SMS 발송 (sms 또는 both) — ★ D72: sms-queue.ts 컨트롤타워 bulkInsertSmsQueue 사용
    if (directChannel === 'sms' || directChannel === 'both') {

      for (let i = 0; i < filteredRecipients.length; i++) {
        const recipient = filteredRecipients[i];
        // ★ D103: prepareSendMessage 컨트롤타워 — 변수 치환 + (광고)+080 한 함수로 통합
        const cleanPhone = normalizePhone(recipient.phone);
        const dbCustomer = directCustomerMap.get(cleanPhone) || null;
        // ★ D123: 직접발송은 고객이 올린 데이터 그대로 (숫자 콤마 자동변환 안 함)
        // ★ D142+ B1: sanitizedMessage(D103 순수본문) + finalIsAd(자동승격) 사용 — INSERT/표시/발송 일관성
        const { message: finalMessage, subject: finalSubject } = prepareSendMessage(sanitizedMessage, dbCustomer, directFieldMappings, {
          msgType, isAd: finalIsAd, opt080Number: directOpt080,
          addressBookFields: {
            name: recipient.name,
            extra1: recipient.extra1,
            extra2: recipient.extra2,
            extra3: recipient.extra3,
            callback: recipient.callback,
          },
          subject: subject || '',
          skipNumberFormatting: true,
        });

        // ★ C3: 분할전송 시간 계산
        let sendTime: string;
        if (isScheduledSend) {
          if (splitEnabled && splitCount > 0) {
            const batchIndex = Math.floor(i / splitCount);
            sendTime = toKoreaTimeStr(calcSplitSendTime(new Date(scheduledAt), batchIndex));
          } else {
            sendTime = toKoreaTimeStr(new Date(scheduledAt));
          }
        } else if (splitEnabled && splitCount > 0) {
          const batchIndex = Math.floor(i / splitCount);
          sendTime = toKoreaTimeStr(calcSplitSendTime(new Date(), batchIndex));
        } else {
          sendTime = '';  // useNow=true이면 bulkInsertSmsQueue에서 NOW() 사용
        }

        // ★ D103: resolveCustomerCallback 컨트롤타워
        const recipientCallback = resolveCustomerCallback(recipient, useIndividualCallback, callback);

        // ★ D124 N4: mmsImagePaths가 객체 배열({path, originalName}) 또는 문자열 배열 혼재 가능 → 정규화
        const directMmsPaths = normalizeMmsImagePaths(mmsImagePaths);
        directSmsRows.push([
          cleanPhone, recipientCallback, finalMessage,
          toQtmsgType(msgType),
          finalSubject, sendTime, campaignId, companyId,
          directMmsPaths[0] || '', directMmsPaths[1] || '', directMmsPaths[2] || ''
        ]);
      }

    }

    // 즉시 브랜드 발송의 기준 시각 — 요청 하나에 **한 번만** 정해 검증과 적재가 같은 값을 쓰게 한다.
    const directBrandSendAt = new Date();
    const directBrandRows: BrandQueueRow[] = [];
    // 브랜드메시지 발송 (kakao 또는 both) — 2026-07-30 재구축: SMSQ 배치(msg_type='F')
    if (directChannel === 'kakao' || directChannel === 'both') {
      for (let i = 0; i < filteredRecipients.length; i++) {
        const recipient = filteredRecipients[i];
        // ★ D102: 항상 백엔드 replaceVariables 컨트롤타워 사용 (customMessages 분기 제거)
        const cleanKakaoPhone = normalizePhone(recipient.phone);
        const dbKakaoCustomer = directCustomerMap.get(cleanKakaoPhone) || null;
        // ★ D123: 직접발송 카카오도 고객 원본 데이터 그대로
        // ★ D142+ B1: sanitizedMessage(D103 순수본문) 사용 — INSERT와 발송 본문 일관
        const finalMessage = replaceVariables(sanitizedMessage, dbKakaoCustomer, directFieldMappings, {
          name: recipient.name,
          extra1: recipient.extra1,
          extra2: recipient.extra2,
          extra3: recipient.extra3,
          callback: recipient.callback,
        }, { skipNumberFormatting: true });

        // ★ C3: 분할전송 시간 계산 (오버플로우 방지 — calcSplitSendTime 적용)
        let kakaoSendTime: string | undefined;
        if (isScheduledSend) {
          if (splitEnabled && splitCount > 0) {
            const batchIndex = Math.floor(i / splitCount);
            kakaoSendTime = toKoreaTimeStr(calcSplitSendTime(new Date(scheduledAt), batchIndex));
          } else {
            kakaoSendTime = toKoreaTimeStr(new Date(scheduledAt));
          }
        } else if (splitEnabled && splitCount > 0) {
          // ★ 2026-08-18 즉시 분할발송에도 시각을 매긴다 — 문자 축은 예약이 아니어도 분할 시각을
          //   계산하는데(위 sendTime 블록) 브랜드만 비워 두고 있었다. `both`면 같은 수신자가
          //   두 채널에서 서로 다른 시각에 나가고, 브랜드는 분할이 사실상 무시됐다.
          const batchIndex = Math.floor(i / splitCount);
          kakaoSendTime = toKoreaTimeStr(calcSplitSendTime(new Date(), batchIndex));
        } else {
          // ★ 2026-08-18 즉시발송도 **검증한 시각을 그대로 큐에 넣는다.**
          //   비워 두면 큐가 MySQL NOW()를 쓰는데, 검사는 조립 시점(preflight)이고 적재는 차감·문자
          //   INSERT를 지난 뒤라 그 사이에 20:50을 넘길 수 있다(검사 통과 → 금지 시각에 적재).
          //   요청 단위로 고정한 시각을 싣고 그 값으로 검증하면 검사와 적재가 갈리지 않는다.
          kakaoSendTime = toKoreaTimeStr(directBrandSendAt);
        }

        // ★ D103: resolveCustomerCallback 컨트롤타워
        const recipientCallback = resolveCustomerCallback(recipient, useIndividualCallback, callback);

        // 조립·대체발송 결함은 throw → 바깥 try의 미적재 환불이 되돌린다(fail-closed).
        const brandFallback = resolveBrandFallback({
          resendType: directChannel === 'both' ? 'NO' : (kakaoResendType || 'SM'),
          originalMessage: finalMessage,
        });
        const directBrandPayload = buildBrandQueuePayload({
          typeDef: 'FREE',
          senderKey: kakaoSenderKey || '',
          targeting: kakaoTargeting || 'I',
          bubbleType: kakaoBubbleType || 'TEXT',
          isAd: finalIsAd,
          message: finalMessage,
          sendAt: kakaoSendTime || undefined,   // 예약·분할 시각 그대로 — 발송 가능 시간 판정 기준
          immediate: !isScheduledSend,
          attachmentJson: kakaoAttachmentJson || undefined,
          carouselJson: kakaoCarouselJson || undefined,
        });
        directBrandRows.push({
          phone: cleanKakaoPhone,
          callback: recipientCallback,
          msgContents: directBrandPayload.msgContents,
          etcJson: directBrandPayload.etcJson,
          nextType: brandFallback.nextType,
          nextContents: brandFallback.nextContents,
          titleStr: brandFallback.titleStr,
          reservedDate: kakaoSendTime,
          companyId,
        });
      }
    }

    // ── 여기서부터 되돌릴 수 없는 것들(차감·적재) ─────────────────────────
    //   위 preflight를 통과했으므로 이 아래에서 규격 위반으로 throw할 일은 없다.
    // ★ 선불 잔액 체크 + 차감
    // 유형은 위 게이트가 확정한 값을 쓴다 — 원본을 다시 읽으면 게이트를 우회한 값이 과금 축이 된다.
    const directDeduct = await prepaidDeduct(companyId, filteredRecipients.length, directDeductType, campaignId, userId);
    if (directDeduct.ok) directDeductedAxes.add(directDeductType);
    if (!directDeduct.ok) {
      // 캠페인 레코드 롤백
      await query('DELETE FROM campaigns WHERE id = $1', [campaignId]);
      return res.status(402).json({
        success: false,
        error: directDeduct.error,
        insufficientBalance: true,
        balance: directDeduct.balance,
        requiredAmount: directDeduct.amount
      });
    }

    // ★ 2026-07-29 캠페인 발송과 같은 구멍이 직접발송에도 있었다 — `both`는 아래에서
    //   bulkInsertSmsQueue(문자)와 insertBrandQueue(브랜드) 양쪽에 같은 수신자를 적재하는데
    //   차감은 위 한 번뿐이라 브랜드 발송분이 무료로 나갔다. 두 축 모두 차감하고, 뒤가 실패하면
    //   앞선 차감과 캠페인 레코드를 함께 되돌린다(한쪽만 깎인 채로 남기지 않는다).
    if (directChannel === 'both') {
      const brandDeduct = await prepaidDeduct(companyId, filteredRecipients.length, 'BRAND', campaignId, userId);
      if (brandDeduct.ok) directDeductedAxes.add('BRAND');
      if (!brandDeduct.ok) {
        // ★ 2026-08-18 회수 **결과**를 본다 — prepaidRefund는 실패를 던지지 않고 ok:false로도 돌아온다.
        //   회수가 안 된 채 캠페인 행을 지우면 미수를 매달 대상이 사라져 문자 차감분이 영구 고립된다.
        //   회수 실패 시에는 행을 남기고(failed) 채무를 기록한다 — AI 캠페인 경로와 같은 계약.
        let reverted = false;
        try {
          const revert = await prepaidRefund(
            companyId, filteredRecipients.length, directDeductType, campaignId,
            '브랜드메시지 차감 실패로 문자 차감분 회수', 'campaign', { refundKey: REFUND_KEYS.CANCEL },
          );
          reverted = revert.ok;
          if (!revert.ok) console.error(`[선불][직접발송 both 보상실패] campaign=${campaignId} ${directDeductType} ${filteredRecipients.length}건 회수 미완 (실회수 ${revert.refunded}건)`);
        } catch (revertErr) {
          console.error(`[선불][직접발송 both 보상실패] campaign=${campaignId} ${directDeductType} ${filteredRecipients.length}건 회수 실패:`, revertErr);
        }
        if (reverted) {
          await query('DELETE FROM campaigns WHERE id = $1', [campaignId]);
        } else {
          await markRefundPendingAxes(campaignId, [{ count: filteredRecipients.length, messageType: directDeductType, refundKey: REFUND_KEYS.CANCEL }]);
          await query(`UPDATE campaigns SET status = 'failed', updated_at = NOW() WHERE id = $1`, [campaignId]).catch(() => {});
        }
        return res.status(402).json({
          success: false,
          error: brandDeduct.error,
          insufficientBalance: true,
          balance: brandDeduct.balance,
          requiredAmount: brandDeduct.amount,
        });
      }
    }

    if (directChannel === 'sms' || directChannel === 'both') {
      directSmsSentCount = await bulkInsertSmsQueue(companyTables, directSmsRows, useNow, { companyId, userId, source: 'direct' });
    }

    if (directChannel === 'kakao' || directChannel === 'both') {
      try {
        directKakaoSentCount = await insertBrandQueue(companyTables, directBrandRows, campaignId);
      } catch (brandErr) {
        if (brandErr instanceof BrandQueueInsertError) {
          directKakaoSentCount = brandErr.inserted; // 앞선 배치는 커밋됨(B-0727-1 계약)
          console.error(`[직접발송] 브랜드 큐 INSERT 부분 실패 (적재 ${directKakaoSentCount}건):`, brandErr.message);
        } else {
          console.error(`[직접발송] 브랜드 큐 INSERT 실패:`, brandErr);
        }
      }
    }

    // ★ C1: 총 발송 성공 건수 계산 + 부분 실패 시 선별적 환불
    // SMS 채널 실패분 환불
    if (directChannel === 'sms' || directChannel === 'both') {
      const smsFailCount = filteredRecipients.length - directSmsSentCount;
      if (smsFailCount > 0) {
        console.warn(`[직접발송] SMS 부분 실패 — 성공: ${directSmsSentCount}, 실패: ${smsFailCount} → 실패분 환불`);
        // catch에서도 축을 알아야 미수를 남길 수 있다 — try 밖에서 확정한다.
        const smsDeductType = isBrandOnlyChannel(directChannel) ? 'BRAND' : msgType;
        try {
          // 대상 − 큐 적재 성공 = 미적재(게이트웨이 실패가 아니다) — B-0727-2
          // ★ 2026-08-18 반환값을 본다 — prepaidRefund는 실패를 던지지 않고 ok:false로도 돌려준다.
          //   예외만 잡으면 "환불 못 했다"가 성공으로 지나가 재시도할 주체가 사라진다(알림톡 경로와 동일 계약).
          const r = await prepaidRefund(companyId, smsFailCount, smsDeductType, campaignId, `직접발송 SMS 미적재 ${smsFailCount}건 환불`, 'campaign', { refundKey: REFUND_KEYS.NOT_LOADED });
          if (!r.ok) await markRefundPending(campaignId, smsFailCount, smsDeductType);
        } catch (refundErr) {
          console.error('[직접발송] SMS 부분 실패 환불 오류:', refundErr);
          await markRefundPending(campaignId, smsFailCount, smsDeductType);
        }
      }
    }
    // 카카오 채널 실패분 환불
    if (directChannel === 'kakao' || directChannel === 'both') {
      const kakaoFailCount = filteredRecipients.length - directKakaoSentCount;
      if (kakaoFailCount > 0) {
        console.warn(`[직접발송] 카카오 부분 실패 — 성공: ${directKakaoSentCount}, 실패: ${kakaoFailCount} → 실패분 환불`);
        try {
          const rk = await prepaidRefund(companyId, kakaoFailCount, 'BRAND', campaignId, `직접발송 브랜드메시지 미적재 ${kakaoFailCount}건 환불`, 'campaign', { refundKey: REFUND_KEYS.NOT_LOADED });
          if (!rk.ok) await markRefundPending(campaignId, kakaoFailCount, 'BRAND');
        } catch (refundErr) {
          console.error('[직접발송] 카카오 부분 실패 환불 오류:', refundErr);
          await markRefundPending(campaignId, kakaoFailCount, 'BRAND');
        }
      }
    }

    // ★ 알림톡 발송 (CT-04 insertAlimtalkQueue 사용 / D130: 설계서 §6-3-D 반영)
    //   (선언은 try 밖으로 이동 — B-0727-2)
    if (directChannel === 'alimtalk') {
      // ★ 2026-08-04 (Codex 적대검증 high 수용) 큐 적재 직전 재확인.
      //   승인 게이트는 캠페인 생성·차감 **앞**에서 이미 한 번 지났다 — 그것이 "적재 0인데 차감만 남는" 것을 막는다.
      //   다만 그 스냅샷과 실제 적재 사이에는 캠페인 INSERT·차감·수신자 조회가 들어가서, 그 사이 템플릿이
      //   철회·중단되면 죽은 템플릿으로 큐에 넣게 된다(게이트웨이가 전량 7300으로 거절한다).
      //   ⇒ 조립 **직전**에 같은 검사를 한 번 더 하고, 메시지 메타데이터(강조표기·대표링크·버튼)도
      //     그 최신 행에서 만든다. 창은 조립 구간만 남는다.
      //   실패는 throw — 아래 catch(직접발송 큐 처리 전체 실패)가 **미적재분 전량 환불 + failed 종결**을
      //   이미 담당한다. 알림톡 채널은 문자·브랜드 블록을 지나지 않아 적재 0이므로 전액이 돌아간다.
      const recheck = await query(
        `SELECT t.id AS tid,
                t.status AS tstatus,
                t.buttons AS tbuttons,
                t.emphasize_title AS temphasize_title,
                t.represent_link AS trepresent_link,
                p.id AS pid,
                p.approval_status,
                p.profile_key
           FROM kakao_templates t
           -- ★ 2026-08-04 (Codex 2R critical) 프로필도 같은 회사만. p를 id로만 조인하면
           --   템플릿의 profile_id가 타사 프로필을 가리킬 때 **그 회사의 승인 상태로 게이트를 통과**한다.
           JOIN kakao_sender_profiles p ON p.id = t.profile_id AND p.company_id = t.company_id
          WHERE t.company_id = $1
            AND t.template_code = $2
          LIMIT 1`,
        [companyId, alimtalkTemplateCode]
      );
      if (recheck.rows.length === 0) {
        throw new Error('알림톡 템플릿이 발송 직전에 조회되지 않습니다 (삭제·이관 가능성)');
      }
      const gate = recheck.rows[0];
      if (!['APPROVED', 'APR', 'A'].includes(String(gate.tstatus).toUpperCase())) {
        throw new Error('알림톡 템플릿 승인이 발송 직전에 해제됐습니다');
      }
      if (gate.approval_status !== 'APPROVED') {
        throw new Error('알림톡 발신프로필 승인이 발송 직전에 해제됐습니다');
      }
      // ★ CT-87: 카카오 활성(A) 재확인 — 실제 7300 거절을 만드는 축이라 적재 직전 값이어야 한다.
      const directTplRecheck = decideKakaoTemplateSendable(await getImcTemplateStatusSafe(companyId, alimtalkTemplateCode));
      if (!directTplRecheck.sendable) {
        throw new Error(`알림톡 발송 직전 상태 확인 실패: ${directTplRecheck.reason}`);
      }

      // ★ #4-a (2026-06-01 알림톡 디버깅): 결과 조회용 campaigns.kakao_template_id FK 저장 (results.ts:560 JOIN).
      //   게이트는 캠페인 INSERT보다 앞에서 끝났고(2026-08-04), 이 UPDATE는 campaignId가 있어야
      //   하므로 여기 남는다. gate.tid 재사용(추가 조회 없음).
      //   결과 표시용 FK 저장 실패가 실제 발송을 막지 않도록 try/catch 격리.
      if (gate.tid) {
        try {
          await query('UPDATE campaigns SET kakao_template_id = $1 WHERE id = $2', [gate.tid, campaignId]);
        } catch (fkErr) {
          console.warn('[direct-send] kakao_template_id 저장 실패 (발송은 계속):', fkErr);
        }
      }

      // ★ D130/버그1: k_etc_json(강조표기 title)은 수신자 row별로 생성 — buildAlimtalkEtcJson CT(아래). senderkey는 CT-04가 비토 라인만 주입.

      // ★ D130: 프론트에서 온 variableMap을 백엔드 변수 치환용 extra 인자로 변환
      //   "@@fieldKey@@" 형태는 recipient/dbCustomer에서 자동 치환, 그 외는 직접값
      const toExtraFromVarMap = (recipient: any, dbCustomer: any): Record<string, string> => {
        const out: Record<string, string> = {};
        if (!alimtalkVariableMap || typeof alimtalkVariableMap !== 'object') return out;
        for (const [rawKey, rawVal] of Object.entries(alimtalkVariableMap)) {
          const cleanKey = String(rawKey).replace(/^#\{|\}$/g, '').trim();
          const v = String(rawVal || '');
          if (v.startsWith('@@') && v.endsWith('@@')) {
            const fieldKey = v.slice(2, -2);
            const source = dbCustomer?.[fieldKey] ?? recipient?.[fieldKey] ?? '';
            out[cleanKey] = String(source ?? '');
          } else {
            out[cleanKey] = v;
          }
        }
        return out;
      };

      // 강등은 행마다 찍지 않고 1줄로 센다 — 대량 발송에서 전화번호 원문이 로그에 쌓인다.
      let alimDowngradedCount = 0;
      const alimtalkRows = filteredRecipients.map((recipient: any) => {
        const dbAlimCustomer = directCustomerMap.get(normalizePhone(recipient.phone)) || null;
        const extraVars = toExtraFromVarMap(recipient, dbAlimCustomer);
        // 템플릿 content를 #{변수} 치환 — QTmsg 알림톡은 본문이 필수
        let finalMessage = replaceVariables(message, dbAlimCustomer, directFieldMappings, {
          name: recipient.name, extra1: recipient.extra1, extra2: recipient.extra2,
          extra3: recipient.extra3, callback: recipient.callback,
        }, { skipNumberFormatting: true });
        // #{key} 추가 치환
        for (const [k, v] of Object.entries(extraVars)) {
          finalMessage = finalMessage.replace(new RegExp(`#\\{${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g'), v);
        }
        // ★ 대체문구(k_next_contents)도 본문과 동일 치환 — raw 발송 시 #{변수} 노출 차단. (%변수% + #{} 변수맵)
        let filledNextContents: string | undefined;
        if (alimtalkNextContents) {
          const ncBase = replaceVariables(alimtalkNextContents, dbAlimCustomer, directFieldMappings, {
            name: recipient.name, extra1: recipient.extra1, extra2: recipient.extra2,
            extra3: recipient.extra3, callback: recipient.callback,
          }, { skipNumberFormatting: true });
          filledNextContents = fillAlimtalkVarMap(ncBase, alimtalkVariableMap, dbAlimCustomer, recipient);
        }
        // ★ 2026-07-27: 전환재발송 규칙 CT 단일 진입점(alimtalk-fallback) — 4경로 공통.
        //   설정 자체는 위 검증(400)에서 이미 걸러졌다. 여기서 문안이 비는 경우는 이 수신자의 변수가
        //   전부 빈 값이라 치환 후 사라진 행뿐이라, 그 행만 전환 없음으로 내리고 본 발송은 보낸다.
        const alimFallback = resolveAlimtalkFallback(
          {
            nextType: alimtalkNextType,
            nextContents: filledNextContents,
            nextSubject: alimtalkNextSubject,
          },
          { emptyContentsPolicy: 'disableFallback' },
        );
        if (alimFallback.downgradedToNone) alimDowngradedCount++;
        // ★ 매뉴얼(qtmsg): 강조표기 title(#{변수} 본문과 동일 치환)만 → row별 k_etc_json (senderkey는 CT-04가 비토 라인만 주입)
        const rowEtcJson = buildAlimtalkEtcJson({
          emphasizeTitle: gate.temphasize_title,
          representLink: gate.trepresent_link,
          substitute: (raw) => {
            let t = replaceVariables(raw, dbAlimCustomer, directFieldMappings, {
              name: recipient.name, extra1: recipient.extra1, extra2: recipient.extra2,
              extra3: recipient.extra3, callback: recipient.callback,
            }, { skipNumberFormatting: true });
            for (const [k, v] of Object.entries(extraVars)) {
              t = t.replace(new RegExp(`#\\{${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g'), v);
            }
            return t;
          },
        });
        return {
          phone: normalizePhone(recipient.phone),
          callback: normalizePhone(callback),
          message: finalMessage,
          templateCode: alimtalkTemplateCode,
          nextType: alimFallback.nextType,
          nextContents: alimFallback.nextContents,
          // ★ D225+ (2026-05-28 영업팀장 박성용 신고 재발 fix): alimtalkNextSubject → QTmsg title_str 매핑 누락 정정.
          //   옛 D224+ fix = destructure + 검증만. 실제 QTmsg INSERT 시 titleStr 영역 누락 = title_str NULL.
          //   결과 = 알림톡 발송 실패 후 LMS 자동 대체 발송 시 = 제목 NULL = 통신사 검증 실패 = 미수신 사고.
          titleStr: alimFallback.titleStr,
          // ★ 버그1 fix: 검수 승인 템플릿 buttons로 k_button_json 생성(QTmsg 매뉴얼 형식). 프론트 전송값은 폴백.
          buttonJson: convertButtonsToQTmsg(gate.tbuttons) || alimtalkButtonJson || null,
          etcJson: rowEtcJson,
          companyId,
        };
      });
      if (alimDowngradedCount > 0) {
        console.log(`[직접발송] 대체문안 치환 결과 공백 ${alimDowngradedCount}건 — 해당 수신자만 전환 없이 알림톡 발송 campaign=${campaignId}`);
      }

      try {
        directAlimtalkSentCount = await insertAlimtalkQueue(companyTables, alimtalkRows, campaignId);
        console.log(`[직접발송] 알림톡 INSERT 완료: ${directAlimtalkSentCount}건`);
      } catch (alimtalkErr) {
        console.error('[직접발송] 알림톡 INSERT 실패:', alimtalkErr);
        // ★ 2026-07-27 (B-0727-1): 배치 독립 커밋 — 앞 배치는 이미 큐에 남아 발송된다.
        //   커밋된 건수를 살려야 이후 성공 건수·환불 산식이 실제 발송분과 어긋나지 않는다.
        if (alimtalkErr instanceof AlimtalkQueueInsertError) directAlimtalkSentCount = alimtalkErr.inserted;
      }
      // ★ 2026-07-27 (B-0727-2): 알림톡만 미적재분 환불 경로가 없었다(SMS·카카오는 위에 있다).
      //   첫 배치부터 실패하면 적재 0인데 캠페인은 그대로 종결돼 sweeper 산식(처리수 0 → 미적재 0)도
      //   손대지 않아 차감액이 통째로 남았다. 여기서 적재되지 않은 몫을 미적재 항아리로 돌려준다.
      const alimNotLoaded = Math.max(0, filteredRecipients.length - directAlimtalkSentCount);
      if (alimNotLoaded > 0) {
        console.warn(`[직접발송] 알림톡 미적재 ${alimNotLoaded}건 (적재 ${directAlimtalkSentCount}/${filteredRecipients.length}) → 환불`);
        // ★ 2026-07-27 (B-0727-2): prepaidRefund는 실패해도 throw하지 않고 ok=false로 돌아온다.
        //   try/catch만으로는 실패를 못 잡는다. 실패하면 durable 의무로 남겨 워커가 재시도한다
        //   (적재 0건이면 status='failed'로 끝나 sweeper 보정 대상에서도 빠지기 때문).
        try {
          const r = await prepaidRefund(companyId, alimNotLoaded, directDeductType, campaignId, `직접발송 알림톡 미적재 ${alimNotLoaded}건 환불`, 'campaign', { refundKey: REFUND_KEYS.NOT_LOADED });
          if (!r.ok) await markRefundPending(campaignId, alimNotLoaded, directDeductType);
        } catch (refundErr) {
          console.error('[직접발송] 알림톡 미적재 환불 오류:', refundErr);
          await markRefundPending(campaignId, alimNotLoaded, directDeductType);
        }
      }
    }

    // 실제 성공 건수 (채널별 최대값)
    const directTotalSent = Math.max(directSmsSentCount || 0, directKakaoSentCount || 0, directAlimtalkSentCount || 0);
    const directFailTotal = filteredRecipients.length - directTotalSent;

    // 3. 즉시발송이면 상태 업데이트
    // ★ D144 후속: bulk INSERT 완료 = 발송완료 정책 — 'sending' 단계 폐기, 즉시 'completed'.
    //   pending(통신사 처리 대기)은 백그라운드. 화면 카운트는 D144 후 MySQL 직접이라 실시간 갱신.
    // ★ C1: directTotalSent 기반으로 실제 성공 건수 반영
    if (!scheduled) {
      const immediateStatus = directTotalSent === 0 ? 'failed' : 'completed';
      await query(
        `UPDATE campaigns SET status = $1, sent_count = $2, fail_count = $3, sent_at = NOW(), updated_at = NOW() WHERE id = $4`,
        [immediateStatus, directTotalSent, directFailTotal, campaignId]
      );
      // ★ D101: 직접발송도 campaign_runs INSERT (슈퍼관리자 캠페인 상세조회에서 데이터 필요)
      try {
        await query(
          `INSERT INTO campaign_runs (campaign_id, run_number, target_count, sent_count, status, sent_at, created_at)
           VALUES ($1, 1, $2, $3, $4, NOW(), NOW())`,
          [campaignId, filteredRecipients.length, directTotalSent, immediateStatus]
        );
      } catch (runErr) {
        console.warn('[direct-send] campaign_runs INSERT 실패 (발송에 영향 없음):', runErr);
      }
    }

    // ★ 2026-07-03 Gap5 Layer2: 고객별 발송 카운터 (예측 분모 전용, fire-and-forget — 발송·돈 무영향, campaignRef 멱등).
    //   직접발송 recipients는 프론트 원천이라 customer id가 있는 행만 집계(주소록·엑셀 행 = id 없음 = 기존과 동일 미집계).
    void recordCustomerSends({
      companyId,
      campaignRef: `ds:${campaignId}`,
      customerIds: filteredRecipients.map((r: any) => String(r.id || '')).filter(Boolean),
    });

    // ★ 2026-07-05 발송 피로도 카운터 — 광고성만(수동 입력 수신자 포함: 실제 수신 피로는 동일), fire-and-forget
    if (finalIsAd) {
      void recordFatigueSends(companyId, filteredRecipients.map((r: any) => String(r.phone || '')));
    }

    // ★ AI 학습 데이터 적재 — 직접발송 (비동기, 실패해도 발송에 영향 없음)
    const directCompanyInfo = await query('SELECT name, brand_tone FROM companies WHERE id = $1', [companyId]);
    logTrainingData({
      campaignRunId: campaignId,
      companyId,
      companyName: directCompanyInfo.rows[0]?.name,
      brandTone: directCompanyInfo.rows[0]?.brand_tone,
      targetCount: filteredRecipients.length,
      messageType: msgType,
      // ★ D142+ B1: finalIsAd / sanitizedMessage 사용 — DB와 학습로그 일관
      isAd: finalIsAd,
      finalMessage: sanitizedMessage,
      finalSource: 'manual',
      sendAt: scheduled && scheduledAt ? new Date(scheduledAt) : new Date(),
    });

    res.json({
      success: true,
      campaignId,
      sentCount: directTotalSent,
      failCount: directFailTotal,
      unsubscribeCount: excludedCount,
      duplicateCount,
      callbackSkippedCount,
      callbackMissingCount,
      callbackUnregisteredCount,
      message: `${directTotalSent}건 발송 ${scheduled ? '예약' : '완료'}${duplicateCount > 0 ? ` (중복 ${duplicateCount}건 제거)` : ''}${directFailTotal > 0 ? ` (${directFailTotal}건 실패, 자동 환불)` : ''}${excludedCount > 0 ? ` (수신거부 ${excludedCount}건 제외)` : ''}${callbackMissingCount > 0 ? ` (회신번호 없음 ${callbackMissingCount}명 제외)` : ''}${callbackUnregisteredCount > 0 ? ` (미등록 회신번호 ${callbackUnregisteredCount}명 제외)` : ''}${directFatigueSkipped > 0 ? ` (피로도 보호 ${directFatigueSkipped}명 제외)` : ''}`
    });

    } catch (sendError) {
      // ★ C1: 전체 실패 (루프 진입 전 오류 등) — 전액 환불
      console.error('[직접발송] 큐 처리 전체 실패 — 차감 환불 처리:', sendError);
      try {
        // ★ 2026-07-27 (B-0727-2): 이 catch는 큐 적재뿐 아니라 그 뒤 후처리(상태 UPDATE·학습 적재)까지 감싼다.
        //   전량을 미적재로 환불하면, 적재는 다 됐는데 후처리만 실패한 경우 실제로 나갈 발송분까지 돌려준다.
        //   실제 큐에 들어간 수를 빼고 남은 몫만 환불한다.
        //
        // ★ 2026-08-18 채널 축 분리 — **차감이 2축인데 환불이 1축이던 누수를 닫는다.**
        //   `both`는 위에서 directDeductType(문자)과 'BRAND' **두 번** 차감한다. 그런데 여기서는
        //   세 카운트의 max 하나로 미적재를 계산하고 directDeductType 한 축만 환불했다.
        //   문자는 적재되고 브랜드 조립이 throw하면 max=문자수라 미적재가 0으로 계산되어
        //   **BRAND 차감이 통째로 남았다.** 축마다 자기 적재수로 따로 환불한다(성공 경로의 부분환불과 같은 방식).
        //   ⚠ 축마다 **독립 try**로 돈다 — 앞 축의 prepaidRefund가 throw하면 뒤 축의 환불까지
        //     통째로 건너뛰던 구조였다(한 번의 예외로 두 채무가 함께 유실).
        const primaryLoaded = directDeductType === 'BRAND'
          ? directKakaoSentCount
          : Math.max(directSmsSentCount, directAlimtalkSentCount);
        const refundAxes: { type: string; count: number; label: string }[] = [
          { type: directDeductType, count: Math.max(0, filteredRecipients.length - primaryLoaded), label: '' },
        ];
        // both = 문자축과 별개로 BRAND가 한 번 더 차감돼 있다. 브랜드 적재수 기준으로 따로 되돌린다.
        if (directChannel === 'both') {
          refundAxes.push({ type: 'BRAND', count: Math.max(0, filteredRecipients.length - directKakaoSentCount), label: '(브랜드)' });
        }
        // 차감하지 않은 축은 되돌릴 것이 없다(preflight throw = 차감 전).
        const chargedAxes = refundAxes.filter((a) => directDeductedAxes.has(a.type));
        const pendingAxes: { type: string; count: number }[] = [];
        for (const axis of chargedAxes) {
          if (axis.count <= 0) continue;
          try {
            const r = await prepaidRefund(companyId, axis.count, axis.type, campaignId, `발송 실패 미적재 ${axis.count}건 자동 환불${axis.label}`, 'campaign', { refundKey: REFUND_KEYS.NOT_LOADED });
            if (!r.ok) pendingAxes.push({ type: axis.type, count: axis.count });
          } catch (axisErr) {
            console.error(`[직접발송] ${axis.type} 미적재 환불 오류:`, axisErr);
            pendingAxes.push({ type: axis.type, count: axis.count });
          }
        }
        // 축을 **한 번에** 기록한다 — 나눠 쓰면 그 사이에 워커가 첫 축만 담긴 스냅샷을 읽고 슬롯을 지운다.
        await markRefundPendingAxes(campaignId, pendingAxes.map((p) => ({ count: p.count, messageType: p.type })));
        await query(`UPDATE campaigns SET status = 'failed', updated_at = NOW() WHERE id = $1`, [campaignId]);
      } catch (refundErr) {
        console.error('[직접발송] 환불 처리 중 추가 오류:', refundErr);
      }
      return res.status(500).json({ success: false, error: '발송 처리 중 오류가 발생했습니다. 차감된 금액은 자동 환불됩니다.' });
    }

  } catch (error) {
    console.error('직접발송 실패:', error);
    res.status(500).json({ success: false, error: '발송 실패' });
  }
});

// 예약 취소 — ★ utils/campaign-lifecycle.ts 컨트롤타워 사용
router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    const campaignId = req.params.id;

    const result = await cancelCampaign(campaignId, companyId, {
      cancelledBy: userId,
      cancelledByType: (req as any).user?.userType,
    });

    if (!result.success) {
      const status = result.tooLate ? 400 : (result.error === '캠페인을 찾을 수 없습니다' ? 404 : 400);
      return res.status(status).json({ success: false, error: result.error, tooLate: result.tooLate });
    }

    res.json({ success: true, message: '예약이 취소되었습니다' });
  } catch (error) {
    console.error('예약 취소 실패:', error);
    res.status(500).json({ success: false, error: '취소 실패' });
  }
});

// 예약 캠페인 수신자 조회
router.get('/:id/recipients', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    const userType = (req as any).user?.userType;
    const campaignId = req.params.id;
    const { search } = req.query;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    // 캠페인 확인
    const campaign = await query(
      `SELECT * FROM campaigns WHERE id = $1 AND company_id = $2`,
      [campaignId, companyId]
    );

    if (campaign.rows.length === 0) {
      return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다' });
    }

    const camp = campaign.rows[0];

    // 예약 상태면 먼저 MySQL 라인 테이블(발송 당시 기록 1순위 + 전 라인 합집합)에서 조회 시도 — 2026-06-11 라인 불일치 fix
    const recipientTables = await getCampaignQueueTables(companyId, camp.created_by || undefined, camp.send_config);
    if (camp.status === 'scheduled') {
      // 검색 조건
      const searchCondition = search ? ` AND dest_no LIKE ?` : '';
      const searchParams = search ? [campaignId, `%${normalizePhone(String(search))}%`] : [campaignId];

      const mysqlRecipients = await smsSelectAll(recipientTables,
        'seqno as idx, dest_no as phone, call_back as callback, msg_contents as message',
        `app_etc1 = ? AND status_code = 100${searchCondition}`,
        searchParams,
        `ORDER BY seqno LIMIT ${limit} OFFSET ${offset}`
      );

      // MySQL에 데이터 있으면 그걸 반환
      if (mysqlRecipients && (mysqlRecipients.length > 0 || offset > 0 || search)) {
        const totalCount = await smsCountAll(recipientTables, `app_etc1 = ? AND status_code = 100${searchCondition}`, searchParams);

        return res.json({
          success: true,
          campaign: camp,
          recipients: mysqlRecipients,
          total: totalCount,
          hasMore: offset + limit < totalCount
        });
      }
    }

    // draft 상태이거나 MySQL에 데이터 없으면 PostgreSQL customers에서 조회
    if (camp.status === 'scheduled' || camp.status === 'draft') {
      const targetFilter = camp.target_filter || {};
      const filterQuery = buildFilterQueryCompat(targetFilter, companyId);
      const excludedPhones = camp.excluded_phones || [];

      // store_codes 필터
      // ★ B16-01: store_codes 없는 company_user → 빈 결과
      // ★ B16-01: 브랜드 격리 — store-scope 컨트롤타워
      let storeFilter = '';
      let storeParams: any[] = [];
      if (userType === 'company_user' && userId) {
        const scope = await getStoreScope(companyId, userId);
        if (scope.type === 'filtered') {
          const storeIdx = 1 + filterQuery.params.length + 1;
          storeFilter = ` AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($${storeIdx}::text[]))`;
          storeParams = [scope.storeCodes];
        } else if (scope.type === 'blocked') {
          return res.status(403).json({ error: '소속 브랜드가 지정되지 않았습니다. 관리자에게 문의하세요.' });
        }
      }

      // 검색 필터
      let searchFilter = '';
      let searchParams: any[] = [];
      if (search) {
        const searchIdx = 1 + filterQuery.params.length + storeParams.length + 1;
        searchFilter = ` AND (phone LIKE $${searchIdx} OR name LIKE $${searchIdx})`;
        searchParams = [`%${search}%`];
      }

      // excluded_phones 필터
      let excludeFilter = '';
      let excludeParams: any[] = [];
      if (excludedPhones.length > 0) {
        const excludeIdx = 1 + filterQuery.params.length + storeParams.length + searchParams.length + 1;
        excludeFilter = ` AND phone NOT IN (SELECT UNNEST($${excludeIdx}::text[]))`;
        excludeParams = [excludedPhones];
      }

      // ★ B17-01 수정: 수신거부 기준 user_id로 통일 (080 자동연동과 일관성 유지)
      const unsubIdx = 1 + filterQuery.params.length + storeParams.length + searchParams.length + excludeParams.length + 1;
      const countResult = await query(
        `SELECT COUNT(*) FROM customers c
         WHERE c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true
         ${filterQuery.where}${storeFilter}${searchFilter}${excludeFilter}
         AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubIdx} AND u.phone = c.phone)`,
        [companyId, ...filterQuery.params, ...storeParams, ...searchParams, ...excludeParams, userId]
      );
      const total = parseInt(countResult.rows[0].count);

      // 수신자 목록 (상위 10개)
      const limitIdx = unsubIdx + 1;
      const recipients = await query(
        `SELECT phone, name, phone as idx
         FROM customers c
         WHERE c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true
         ${filterQuery.where}${storeFilter}${searchFilter}${excludeFilter}
         AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubIdx} AND u.phone = c.phone)
         ORDER BY name, phone
         LIMIT $${limitIdx}`,
        [companyId, ...filterQuery.params, ...storeParams, ...searchParams, ...excludeParams, userId, 10]
      );

      return res.json({
        success: true,
        campaign: camp,
        recipients: recipients.rows,
        total
      });
    }

    // 발송 완료/진행중이면 MySQL 회사 라인그룹 테이블에서 조회
    const searchCondition2 = search ? ` AND dest_no LIKE ?` : '';
    const searchParams2 = search ? [campaignId, `%${normalizePhone(String(search))}%`] : [campaignId];

    const recipients = await smsSelectAll(recipientTables,
      'seqno as idx, dest_no as phone, call_back as callback, msg_contents as message, sendreq_time, status_code',
      `app_etc1 = ? AND status_code = 100${searchCondition2}`,
      searchParams2,
      `ORDER BY seqno LIMIT ${limit} OFFSET ${offset}`
    );

    const totalCount = await smsCountAll(recipientTables, `app_etc1 = ? AND status_code = 100${searchCondition2}`, searchParams2);

    res.json({
      success: true,
      campaign: camp,
      recipients: recipients,
      total: totalCount,
      hasMore: offset + limit < totalCount
    });
  } catch (error) {
    console.error('수신자 조회 실패:', error);
    res.status(500).json({ success: false, error: '조회 실패' });
  }
});

// 예약 캠페인 개별 수신자 삭제
router.delete('/:id/recipients/:idx', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const campaignId = req.params.id;
    const phone = req.params.idx; // idx가 아니라 phone으로 사용

    // 캠페인 확인
    const campaign = await query(
      `SELECT * FROM campaigns WHERE id = $1 AND company_id = $2 AND status = 'scheduled'`,
      [campaignId, companyId]
    );

    if (campaign.rows.length === 0) {
      return res.status(404).json({ success: false, error: '예약 캠페인을 찾을 수 없습니다' });
    }

    // 15분 이내 체크
    const scheduledAt = new Date(campaign.rows[0].scheduled_at);
    const now = new Date();
    const diffMinutes = (scheduledAt.getTime() - now.getTime()) / (1000 * 60);
    if (diffMinutes < 15) {
      return res.status(400).json({ success: false, error: '발송 15분 전에는 수정할 수 없습니다', tooLate: true });
    }

    // MySQL 라인 테이블(발송 당시 기록 1순위 + 전 라인 합집합)에서 데이터 있는지 확인 — 2026-06-11 라인 불일치 fix
    const delTables = await getCampaignQueueTables(companyId, campaign.rows[0].created_by || undefined, campaign.rows[0].send_config);
    const mysqlCount = await smsCountAll(delTables, 'app_etc1 = ? AND status_code = 100', [campaignId]);

    if (mysqlCount > 0) {
      // 회사 테이블에서 삭제
      await smsExecAll(delTables,
        `DELETE FROM SMSQ_SEND WHERE app_etc1 = ? AND dest_no = ? AND status_code = 100`,
        [campaignId, phone]
      );

      const remainingCount = await smsCountAll(delTables, 'app_etc1 = ? AND status_code = 100', [campaignId]);

      await query(
        `UPDATE campaigns SET target_count = $1, updated_at = NOW() WHERE id = $2`,
        [remainingCount, campaignId]
      );

      return res.json({ success: true, message: '삭제되었습니다', remainingCount });
    }

    // MySQL에 없으면 excluded_phones에 추가
    await query(
      `UPDATE campaigns SET excluded_phones = array_append(excluded_phones, $1), target_count = target_count - 1, updated_at = NOW() WHERE id = $2`,
      [phone, campaignId]
    );

    const updated = await query(`SELECT target_count FROM campaigns WHERE id = $1`, [campaignId]);

    res.json({ success: true, message: '삭제되었습니다', remainingCount: updated.rows[0]?.target_count || 0 });
  } catch (error) {
    console.error('수신자 삭제 실패:', error);
    res.status(500).json({ success: false, error: '삭제 실패' });
  }
});

// 예약 시간 수정
router.put('/:id/reschedule', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const campaignId = req.params.id;
    const { scheduledAt } = req.body;

    // 캠페인 확인
    const campaign = await query(
      `SELECT * FROM campaigns WHERE id = $1 AND company_id = $2 AND status = 'scheduled'`,
      [campaignId, companyId]
    );

    if (campaign.rows.length === 0) {
      return res.status(404).json({ success: false, error: '예약 캠페인을 찾을 수 없습니다' });
    }

    // ★ D111 P4: 새 예약 시각 검증 — 컨트롤타워 validateScheduledAt (이전 인라인 15분 체크 교체)
    const rsCheck = validateScheduledAt(scheduledAt, { allowNull: false, minMinutesFromNow: 15 });
    if (!rsCheck.valid) {
      return res.status(400).json({ success: false, error: rsCheck.error });
    }
    const newScheduledAt = rsCheck.normalizedDate!;

    // 15분 이내 체크
    const currentScheduledAt = new Date(campaign.rows[0].scheduled_at);
    const now = new Date();
    const diffMinutes = (currentScheduledAt.getTime() - now.getTime()) / (1000 * 60);
    if (diffMinutes < 15) {
      return res.status(400).json({ success: false, error: '발송 15분 전에는 시간을 변경할 수 없습니다', tooLate: true });
    }

    // 1. 라인 테이블(발송 당시 기록 1순위 + 전 라인 합집합)에서 MIN(sendreq_time) 찾기 — 2026-06-11 라인 불일치 fix
    const reschTables = await getCampaignQueueTables(companyId, campaign.rows[0].created_by || undefined, campaign.rows[0].send_config);
    const currentMinTime = await smsMinAll(reschTables, 'sendreq_time', 'app_etc1 = ? AND status_code = 100', [campaignId]);

    // MySQL에 데이터 있으면 시간 조정 (분할전송 간격 유지)
    if (currentMinTime) {
      const newTime = new Date(scheduledAt);
      const diffSeconds = Math.round((newTime.getTime() - new Date(currentMinTime).getTime()) / 1000);

      await smsExecAll(reschTables,
        `UPDATE SMSQ_SEND SET sendreq_time = DATE_ADD(sendreq_time, INTERVAL ? SECOND) WHERE app_etc1 = ? AND status_code = 100`,
        [diffSeconds, campaignId]
      );
    }

    // PostgreSQL 캠페인 업데이트 (항상 실행)
    await query(
      `UPDATE campaigns SET scheduled_at = $1, updated_at = NOW() WHERE id = $2`,
      [new Date(scheduledAt), campaignId]
    );

    res.json({ success: true, message: '예약 시간이 변경되었습니다' });
  } catch (error) {
    console.error('예약 시간 수정 실패:', error);
    res.status(500).json({ success: false, error: '수정 실패' });
  }
});
// 예약 캠페인 문안 수정
router.put('/:id/message', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const campaignId = req.params.id;
    const { message, subject } = req.body;
    // ★ D143 (2026-05-04, 정식 오픈 D-Day 1일 전) — D142+ 자동 정규화 폐지
    //   정책 변경 사유 (Harold님 명시): 사용자 입력 본문 그대로 저장. 시스템이 깎지 않음.
    //   변수명은 호환성 위해 유지 (sanitizedEditMessage = 사용자 입력 그대로)
    const sanitizedEditMessage = message || '';   // ★ D143: sanitize 미적용 — 사용자 입력 보존

    // 캠페인 확인
    const campaign = await query(
      `SELECT * FROM campaigns WHERE id = $1 AND company_id = $2 AND status = 'scheduled'`,
      [campaignId, companyId]
    );

    if (campaign.rows.length === 0) {
      return res.status(404).json({ success: false, error: '예약 캠페인을 찾을 수 없습니다' });
    }

    // LMS/MMS는 제목 필수
    const campMsgType = campaign.rows[0].message_type;
    if ((campMsgType === 'LMS' || campMsgType === 'MMS') && (!subject || !subject.trim())) {
      return res.status(400).json({ success: false, error: 'LMS/MMS는 제목이 필수입니다' });
    }

    // 15분 이내 체크
    const currentScheduledAt = new Date(campaign.rows[0].scheduled_at);
    const now = new Date();
    const diffMinutes = (currentScheduledAt.getTime() - now.getTime()) / (1000 * 60);
    if (diffMinutes < 15) {
      return res.status(400).json({ success: false, error: '발송 15분 전에는 수정할 수 없습니다', tooLate: true });
    }

    // 1. MySQL 라인 테이블(발송 당시 기록 1순위 + 전 라인 합집합)에서 수신자 목록 조회 — 2026-06-11 라인 불일치 fix
    const msgTables = await getCampaignQueueTables(companyId, campaign.rows[0].created_by || undefined, campaign.rows[0].send_config);
    const recipients = await smsSelectAll(msgTables,
      'seqno, dest_no, msg_type',
      'app_etc1 = ? AND status_code = 100',
      [campaignId]
    );

    // ★ 2026-08-15 브랜드 행(msg_type='F') 포함 캠페인은 수정 자체를 거부 — 이 경로의 문안 갱신은
    //   문자(SMS/LMS) 규약(광고 문구·080·제목)이라 브랜드 행 본문·제어 규약을 오염시키고,
    //   F행만 건너뛰면 캠페인 원장·문자 행은 새 문안, 브랜드 행은 옛 문안으로 갈라진 채 성공 표시가 된다(적대 검증 지적).
    //   원장 변경 전 전체 거부가 원자적이다. 아래 UPDATE의 F 제외 조건은 경합 대비 이중 방어로 유지.
    if (recipients.some((r: any) => r.msg_type === 'F')) {
      return res.status(400).json({
        success: false,
        error: '브랜드메시지가 포함된 예약 캠페인은 문안 수정을 지원하지 않습니다. 예약을 취소한 뒤 다시 발송해주세요.',
      });
    }

    // MySQL에 데이터 없으면 PostgreSQL만 업데이트 (예약 상태)
    if (recipients.length === 0) {
      await query(
        `UPDATE campaigns SET message_template = $1, message_subject = $2, message_content = $3, updated_at = NOW() WHERE id = $4`,
        // ★ D142+ B1: sanitizedEditMessage(D103 순수본문) 저장
        [sanitizedEditMessage, subject || null, sanitizedEditMessage, campaignId]
      );
      return res.json({ success: true, message: '문안이 수정되었습니다 (발송 시 적용)' });
    }

    // ★ D102: prepareFieldMappings 컨트롤타워로 통합 (customer_schema 조회 + extractVarCatalog + enrichWithCustomFields)
    const editFieldMappings = await prepareFieldMappings(companyId);

    // ★ D32: 동적 컬럼 SELECT — fieldMappings에서 필요한 컬럼 자동 추출
    const editBaseColumns = ['phone', 'custom_fields'];
    // ★ storageType 기반 동적 필터 — 직접 컬럼만 SELECT, JSONB 내부 키는 custom_fields 컬럼에서 접근 (D72)
    const editMappingColumns = Object.values(editFieldMappings).filter((m: VarCatalogEntry) => m.storageType !== 'custom_fields').map((m: VarCatalogEntry) => m.column);
    const editSelectColumns = [...new Set([...editBaseColumns, ...editMappingColumns])].join(', ');

    const phones = recipients.map((r: any) => r.dest_no);
    const customersResult = await query(
      `SELECT ${editSelectColumns} FROM customers WHERE company_id = $1 AND phone = ANY($2)`,
      [companyId, phones]
    );

    // 전화번호 → 고객정보 맵
    const customerMap = new Map();
    customersResult.rows.forEach((c: any) => {
      customerMap.set(c.phone, c);
    });

    /// 3. ★ B17-11: 광고 문구 처리 — users 우선 → companies fallback
    const adEnabled = campaign.rows[0].is_ad === true;
    const msgType = campaign.rows[0].message_type;
    // ★ D102: 080 수신거부번호 — CT-AD 컨트롤타워 사용
    const campUserId = campaign.rows[0].user_id;
    const optOut080 = adEnabled ? await getOpt080Number(campUserId, companyId) : '';

    // 4. 테이블별로 그룹핑 후 Bulk UPDATE
    const tableGroups: Record<string, any[]> = {};
    for (const r of recipients) {
      const table = r._sms_table;
      if (!tableGroups[table]) tableGroups[table] = [];
      tableGroups[table].push(r);
    }

    const batchSize = BATCH_SIZES.messageUpdate;
    let processedCount = 0;

    // Redis에 진행률 저장 (공유 인스턴스 사용)
    await redis.set(`message_edit:${campaignId}:progress`, JSON.stringify({
      total: recipients.length,
      processed: 0,
      percent: 0
    }), 'EX', CACHE_TTL.messageEditProgress);

    for (const [table, tableRecipients] of Object.entries(tableGroups)) {
      for (let i = 0; i < tableRecipients.length; i += batchSize) {
        const batch = tableRecipients.slice(i, i + batchSize);

        // CASE WHEN 으로 배치 업데이트
        const cases: string[] = [];
        const titleCases: string[] = [];
        const seqnos: number[] = [];

        for (const recipient of batch) {
          const customer = customerMap.get(recipient.dest_no) || {};

          // ★ D103: prepareSendMessage 컨트롤타워 — 변수 치환 + (광고)+080 + ★ KISA 2026-05 제목(광고) 통합
          // ★ D142+ B1: sanitizedEditMessage(D103 순수본문) 사용 — 메시지 수정 시 (광고) 중복 부착 차단
          const { message: finalMessage, subject: finalSubject } = prepareSendMessage(sanitizedEditMessage, customer, editFieldMappings, {
            msgType, isAd: adEnabled, opt080Number: optOut080,
            subject: subject || '',
          });

          // SQL escape
          const escapedMessage = finalMessage.replace(/'/g, "''");
          cases.push(`WHEN seqno = ${recipient.seqno} THEN '${escapedMessage}'`);

          // ★ KISA 2026-05: 제목도 (광고) 포함하여 UPDATE
          if (finalSubject && (msgType === 'LMS' || msgType === 'MMS')) {
            const escapedSubject = finalSubject.replace(/'/g, "''");
            titleCases.push(`WHEN seqno = ${recipient.seqno} THEN '${escapedSubject}'`);
          }

          seqnos.push(recipient.seqno);
        }

        // Bulk UPDATE 실행 (테이블별)
        let updateQuery = `
          UPDATE ${table}
          SET msg_contents = CASE ${cases.join(' ')} END
        `;

        if (titleCases.length > 0) {
          updateQuery += `, title_str = CASE ${titleCases.join(' ')} END`;
        }

        // ★ 2026-08-15 브랜드 행(msg_type='F') 제외 — 이 경로는 문자(SMS/LMS) 문안 수정이라
        //   (광고)·080 부착과 제목 갱신이 문자 규약 기준이다. F 행에 닿으면 본문·제어 규약이 오염된다
        //   (규약 정정 전에는 JSON 전문을 평문으로 덮어 무로그 폐기까지 갔다). 브랜드 예약 문안 수정은 미지원.
        updateQuery += ` WHERE seqno IN (${seqnos.join(',')}) AND status_code = 100 AND msg_type <> 'F'`;

        await mysqlQuery(updateQuery, []);

        processedCount += batch.length;

        // 진행률 업데이트
        await redis.set(`message_edit:${campaignId}:progress`, JSON.stringify({
          total: recipients.length,
          processed: processedCount,
          percent: Math.round((processedCount / recipients.length) * 100)
        }), 'EX', CACHE_TTL.messageEditProgress);
      }
    }

    // 5. PostgreSQL 캠페인 템플릿 업데이트
    await query(
      `UPDATE campaigns SET message_template = $1, message_subject = $2, message_content = $3, updated_at = NOW() WHERE id = $4`,
      // ★ D142+ B1: sanitizedEditMessage(D103 순수본문) 저장 — DB 일관성
      [sanitizedEditMessage, subject || null, sanitizedEditMessage, campaignId]
    );

    res.json({
      success: true,
      message: '문안이 수정되었습니다',
      updatedCount: processedCount
    });
  } catch (error) {
    console.error('문안 수정 실패:', error);
    res.status(500).json({ success: false, error: '문안 수정 실패' });
  }
});

// 문안 수정 진행률 조회
router.get('/:id/message/progress', async (req: Request, res: Response) => {
  try {
    const campaignId = req.params.id;
    const data = await redis.get(`message_edit:${campaignId}:progress`);

    if (data) {
      return res.json(JSON.parse(data));
    }
    return res.json({ total: 0, processed: 0, percent: 100 });
  } catch (error) {
    return res.json({ total: 0, processed: 0, percent: 100 });
  }
});

// ★ draft 캠페인 예약 취소 (상태를 cancelled로 변경, 기록 보존)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    const campaignId = req.params.id;

    if (!companyId) {
      return res.status(403).json({ success: false, error: '고객사 권한이 필요합니다.' });
    }

    // 캠페인 조회 — 소유권 확인
    const campResult = await query(
      `SELECT id, status, campaign_name, created_by, scheduled_at FROM campaigns WHERE id = $1 AND company_id = $2`,
      [campaignId, companyId]
    );

    if (campResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: '캠페인을 찾을 수 없습니다.' });
    }

    const campaign = campResult.rows[0];

    // company_user는 본인이 만든 캠페인만 취소 가능
    if (userType === 'company_user' && campaign.created_by !== userId) {
      return res.status(403).json({ success: false, error: '본인이 생성한 캠페인만 취소할 수 있습니다.' });
    }

    // draft 상태만 이 엔드포인트로 취소 허용 (scheduled는 POST /:id/cancel 사용)
    if (campaign.status !== 'draft') {
      return res.status(400).json({
        success: false,
        error: `'${campaign.status}' 상태의 캠페인은 이 방법으로 취소할 수 없습니다.`
      });
    }

    // 예약 시간 체크 — 이미 지난 캠페인은 취소 불가
    if (campaign.scheduled_at && new Date(campaign.scheduled_at) <= new Date()) {
      return res.status(400).json({
        success: false,
        error: '예약 시간이 이미 지난 캠페인은 취소할 수 없습니다.'
      });
    }

    // 15분 이내 제한 — 예약 시간 15분 전부터 취소 불가
    if (campaign.scheduled_at) {
      const timeUntilSend = new Date(campaign.scheduled_at).getTime() - Date.now();
      if (timeUntilSend < 15 * 60 * 1000) {
        return res.status(400).json({
          success: false,
          error: '발송 15분 전부터는 취소할 수 없습니다.',
          tooLate: true
        });
      }
    }

    // ★ D120: 미확정 draft 캠페인은 cancelled 보존 대신 완전 삭제
    // 회신번호 확인 취소 등 예약 확정 전 포기한 건 — DB에 남겨둘 이유 없음
    await query(`DELETE FROM campaign_runs WHERE campaign_id = $1`, [campaignId]);
    await query(`DELETE FROM campaigns WHERE id = $1 AND company_id = $2`, [campaignId, companyId]);

    console.log(`[캠페인삭제-draft] campaign_id=${campaignId}, name="${campaign.campaign_name}", by user=${userId}`);

    return res.json({ success: true, message: '취소되었습니다.' });

  } catch (error) {
    console.error('[캠페인취소-draft] 오류:', error);
    return res.status(500).json({ success: false, error: '캠페인 취소 중 오류가 발생했습니다.' });
  }
});

// ============================================================
// POST /brand-send — 브랜드메시지 발송 (CT-12 컨트롤타워)
// ============================================================
router.post('/brand-send', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId || !userId) {
      return res.status(401).json({ error: '인증 필요' });
    }

    const {
      mode,           // 'free' (자유형) | 'template' (기본형)
      bubbleType,     // TEXT, IMAGE, WIDE, ...
      senderKey,
      targeting,
      isAd,
      phones,         // string[]
      message,
      header,
      additionalContent,
      buttons,
      image,
      coupon,
      commerce,
      video,
      itemList,
      carouselHead,
      carouselItems,
      carouselTail,
      resendType,
      resendFrom,
      resendMessage,
      resendTitle,
      unsubscribePhone,
      unsubscribeAuth,
      reservedDate,
      // 기본형(템플릿) 전용
      templateCode,
      messageVariableJson,
      buttonVariableJson,
      couponVariableJson,
      imageVariableJson,
      videoVariableJson,
      commerceVariableJson,
      carouselVariableJson,
    } = req.body;

    if (!phones || !Array.isArray(phones) || phones.length === 0) {
      return res.status(400).json({ error: '수신자 목록이 필요합니다' });
    }

    // 큐에 실릴 회신번호를 먼저 확정한다 — campaigns와 큐가 다른 번호를 갖지 않게(판정은 CT 한 곳).
    const resolvedCallback = await resolveBrandCallback(companyId, resendFrom);

    // 캠페인 레코드 생성
    const campaignResult = await query(
      // ★ 2026-07-29 `name` → `campaign_name`. 실제 컬럼명이 다른데 이 INSERT만 틀려서
      //   브랜드메시지 발송이 **처음부터 500으로 죽고 있었다**(42703). 다른 campaigns INSERT 5곳은
      //   전부 campaign_name을 쓴다 — 이 경로만 아무도 안 눌러서 드러나지 않았다.
      // ★ 2026-07-30 (2R 범위 밖 수용): created_by 동반 기록 — 사용자 지정 청구(created_by 축)와
      //   담당자 격리·발송결과 소유자 매핑이 전부 이 컬럼을 본다. 비면 그 축들에서 통째로 빠진다.
      // ★ 2026-07-31 축약 INSERT 정정 — 이 경로만 9컬럼이라 나머지가 전부 컬럼 DEFAULT로 채워졌다.
      //   `send_type`은 DEFAULT 'ai'라 직접 보낸 발송이 화면에 **AI**로 나왔고, `callback_number`가
      //   비어 회신번호가 `-`로 나왔다. 더 나쁜 쪽은 `kakao_targeting='I'`·`kakao_resend_type='SM'`이다 —
      //   사용자가 고르지 않은 값이 저장돼, 이 컬럼을 읽는 경로가 실제와 다른 설정을 보게 된다.
      //   컬럼 집합은 직접발송 INSERT(1934행)와 같은 축으로 맞춘다.
      //   `kakao_attachment_json`·`kakao_carousel_json`은 넣지 않는다 — 그 두 컬럼의 소비처는
      //   저장 캠페인 재실행(`POST /:id/send`)뿐인데 이 경로는 즉시 적재라 재실행을 타지 않는다.
      //   넣으려면 첨부 조립을 라우트에서 한 번 더 해야 하고, 그건 CT 이중 조립이다.
      `INSERT INTO campaigns (
         company_id, user_id, created_by, campaign_name, message_content, message_type, send_channel,
         send_type, callback_number, target_count, is_ad,
         kakao_bubble_type, kakao_sender_key, kakao_targeting, kakao_resend_type,
         status, scheduled_at, created_at
       ) VALUES (
         $1, $2, $2, $3, $4, 'LMS', 'kakao_brand',
         'direct', $5, $6, $7,
         $8, $9, $10, $11,
         'sending', $12, NOW()
       )
       RETURNING id`,
      [
        companyId,
        userId,
        `브랜드메시지 ${bubbleType || 'TEXT'}`,
        message || `[${bubbleType}] 브랜드메시지`,
        resolvedCallback || null,
        Array.isArray(phones) ? phones.length : 0,
        isAd ?? true,
        // 길이 가드 — 값 검증은 CT(buildBrandQueuePayload·resolveBrandFallback)가 바로 뒤에서 하고
        // 실패 시 이 캠페인은 status='failed'로 남는다. 여기서 22001로 깨지면 그 안내가 안 나간다.
        String(bubbleType || 'TEXT').trim().toUpperCase().slice(0, 20),
        senderKey || null,
        String(targeting || 'I').trim().toUpperCase().slice(0, 1) || 'I',
        String(resendType || 'NO').trim().toUpperCase().slice(0, 20),
        reservedDate ? new Date(reservedDate) : null,
      ]
    );
    const campaignId = campaignResult.rows[0].id;

    const baseParams = {
      bubbleType: bubbleType || 'TEXT',
      senderKey,
      phones,
      targeting: targeting || 'I',
      isAd: isAd ?? true,
      companyId,
      userId,
      message,
      header,
      additionalContent,
      buttons,
      image,
      coupon,
      commerce,
      video,
      itemList,
      carouselHead,
      carouselItems,
      carouselTail,
      resendType,
      // 위에서 확정한 값을 되넘긴다 — CT가 다시 조회해도 같은 번호가 나와 campaigns와 큐가 갈라지지 않는다.
      resendFrom: resolvedCallback || resendFrom,
      resendMessage,
      resendTitle,
      unsubscribePhone,
      unsubscribeAuth,
      reservedDate,
      campaignId,
    };

    let result;
    if (mode === 'template') {
      const { sendBrandMessageTemplate } = await import('../utils/brand-message');
      result = await sendBrandMessageTemplate({
        ...baseParams,
        templateCode,
        messageVariableJson,
        buttonVariableJson,
        couponVariableJson,
        imageVariableJson,
        videoVariableJson,
        commerceVariableJson,
        carouselVariableJson,
      });
    } else {
      const { sendBrandMessage } = await import('../utils/brand-message');
      result = await sendBrandMessage(baseParams);
    }

    if (!result.success) {
      // 실패 시 캠페인 상태 변경
      await query(`UPDATE campaigns SET status = 'failed' WHERE id = $1`, [campaignId]);
      return res.status(400).json({ error: result.error });
    }

    // 성공 시 캠페인 업데이트
    await query(
      `UPDATE campaigns SET status = 'completed', target_count = $1 WHERE id = $2`,
      [result.sentCount, campaignId]
    );

    // campaign_runs INSERT
    // ★ 2026-07-29 존재하지 않는 컬럼 3개(company_id·total_sent·total_success)를 쓰고 있었다.
    //   campaign_runs는 campaign_id로 회사에 닿으므로 company_id 축 자체가 없다.
    //   다른 INSERT 3곳(422·796·2286)과 같은 컬럼으로 통일한다 — 이 경로만 이름을 지어 쓰고 있었다.
    await query(
      //   컬럼은 2286행 INSERT와 **완전히 같은 집합**만 쓴다 — 그건 운영에서 도는 코드라 실존이 검증돼 있다.
      //   SCHEMA.md에 있는 success_count는 여기 넣지 않았다(같은 날 send_channel 길이가 오기로 드러나
      //   문서를 근거로 컬럼을 쓰면 또 22001·42703을 밟는다). 필요해지면 information_schema 확인 후 추가.
      `INSERT INTO campaign_runs (campaign_id, run_number, target_count, sent_count, status, sent_at, created_at)
       VALUES ($1, 1, $2, $2, 'completed', NOW(), NOW())`,
      [campaignId, result.sentCount]
    );

    return res.json({
      success: true,
      campaignId,
      sentCount: result.sentCount,
      failCount: result.failCount,
    });
  } catch (error) {
    console.error('[brand-send] 에러:', error);
    return res.status(500).json({ error: '브랜드메시지 발송 중 오류가 발생했습니다.' });
  }
});

export default router;
