import { Request, Response, Router } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { checkAPIStatus, extractVarCatalog, filterVarCatalogByData, generateCustomMessages, generateMessages, parseBriefing, recommendTarget, countFilteredCustomers, recommendNextCampaign, refineDirectMessage } from '../services/ai';
import { buildGenderFilter, buildGradeFilter, buildRegionFilter, getGenderVariants, getRegionVariants } from '../utils/normalize';
import { FIELD_MAP, FIELD_DISPLAY_MAP, reverseDisplayValue } from '../utils/standard-field-map';
import { isValidCustomFieldKey } from '../utils/safe-field-name';
import { getStoreScope } from '../utils/store-scope';
import { buildFilterWhereClauseCompat } from '../utils/customer-filter';
import { buildSendableRecipientsSql } from '../utils/operator-recipients';
import { aggregateCampaignPerformance } from '../utils/stats-aggregation';
import { formatDateValue, getOpt080Number } from '../utils/messageUtils';
import { loadPlanContext, canUseFeature, requirePlanFeature, isBetaAccessAllowed, isAiOperatorAllowed } from '../utils/plan-guard';
import { getCompanyCosts } from '../config/defaults';
// ★ D209+ (Harold 명시 2026-05-22) Phase D 비용 안전 매트릭스 — 회사별 월 한도 + cache 통계
import { getMonthlyUsage, getDailyUsage, getModelBreakdown } from '../utils/ai-rate-limit';
import { getCacheStats } from '../utils/ai-cache';
import { orchestrate, orchestrateWithAI } from '../services/ai-orchestrator';
// ★ 크레딧 종량제 — 여정 저장(활성화) 등 endpoint 직접 차감용 (callAIWithFallback 경유 외)
import { checkCredit, deductCreditSafe, InsufficientCreditError } from '../utils/ai-credit';
import { getCreditCost, kstDateTag } from '../utils/ai-credit-calc';
// ★ D174 (2026-05-19): Step 1 Next Action Advisor — Opus 4.7
import { buildPerformanceSnapshot, recommendNextAction, buildPerformanceSnapshotV2, type PerformancePeriod } from '../utils/next-action-advisor';
import { explainPerformance } from '../utils/performance-explainer';
import { generateQuickAction, type QuickActionType } from '../utils/performance-quick-action';
import { buildCohortRetention } from '../utils/performance-cohort';
import { buildBenchmark } from '../utils/performance-benchmark';
import { buildCampaignAttribution } from '../utils/campaign-response-attribution';
import { buildDataAvailability } from '../utils/performance-data-availability';
import { aggregateSmsCountsByCampaign } from '../utils/stats-aggregation';
import { kakaoBatchAggByGroup } from '../utils/sms-queue';
// ★ D176 (2026-05-19): Continuous Agentic Operator (사용자 동의 흐름)
import {
  createOperator,
  listOperators,
  updateOperator,
  archiveOperator,
  adminStopProposal,
  adminConfirmProposal,
  listProposals,
  approveProposal,
  rejectProposal,
  generateProposalForOperator,
} from '../utils/continuous-operator';
// ★ D177 (2026-05-19): Self-Optimizing Bandit (Thompson Sampling)
// ★ D188 Phase 2-B-3 (2026-05-21): journey_step_variants CRUD + reward + 추천 헬퍼 import 추가.
import {
  listVariantsByProposal,
  recommendVariantForProposal,
  recordVariantReward,
  listJourneyStepVariants,
  createJourneyStepVariant,
  deleteJourneyStepVariant,
  recordJourneyStepVariantReward,
  declareVariantWinner,
  computeVariantsCI,
} from '../utils/bandit-optimizer';
// ★ D179 (2026-05-19): Multi-Goal Decisioning (Opus 4.7 충돌 분석)
import { analyzeGoalConflicts, OperatorGoal } from '../utils/multi-goal-decisioning';
// ★ D181 (2026-05-19): 회사별 메모리 누적 (Anthropic Memory 패턴)
import {
  addMemory as addCompanyMemory,
  listMemories as listCompanyMemories,
  deleteMemory as deleteCompanyMemory,
  cleanupDeprecatedMemories,
  MemoryType,
} from '../utils/company-memory';
// ★ D181 (2026-05-19): Anthropic Batch API (50% 비용 절감)
import { listBatchJobs, pollBatch } from '../utils/batch-ai';
// ★ D190 #3 (2026-05-22): 알림톡 자동 템플릿 매칭 + 변수 자동 매핑 (Opus 4.7)
import { matchAlimtalkTemplate } from '../utils/alimtalk-ai-matcher';
// ★ D181 (2026-05-19): Anthropic Citations (AI 응답 근거 박음 — 사용자 신뢰)
import { buildCompanyDocuments, callAIWithCitations } from '../utils/citations';
// ★ D187 (2026-05-20): Journey Builder Lite — 7 표준 여정 + 자연어 진입 (Opus 4.7)
import {
  createJourneyFromTemplate,
  activateJourney,
  pauseJourney,
  endJourney,  archiveJourney,
  unarchiveJourney,
  deleteJourney,
  listJourneys,
  getJourneyDetail,
  updateJourneyStep,
  updateJourneyCallback,
  JOURNEY_TEMPLATES,
  JourneyTemplateCode,
  JourneyStatus,
} from '../utils/journey-builder';
// ★ D218+ (2026-05-26): 활성화 검증 + 정지 이력 조회
import { validateJourneyForActivation } from '../utils/journey-pretest-validator';
import { getPauseLogs } from '../utils/journey-pause-handler';
// ★ D187-fix3 (2026-05-21): Journey AI Generator — One-shot 자연어 + 시즌 + 회사 메모리
import { generateJourneyPackage, refineStepMessage } from '../utils/journey-ai-generator';
import { selectJourneyTargetCustomerIds, buildJourneyPreviewSamples, countJourneyTargetCustomers } from '../utils/journey-target-extractor';
// ★ D210+ Phase 2-fix1 (Harold 명시 2026-05-23): CT-58 — 회사 customer DB 실측 프로필 조회.
//   /operator/data-profile endpoint = 마케팅 담당자 검토 UI 안내 카드 data source.
import { getCompanyDataProfile } from '../utils/company-data-profile';
// ★ D192 (2026-05-22): CT-51 Journey 통계 통합 진입점 — 옛 단순 통계(getJourneyStats/listExecutions)를 완전 진화 — buildJourneyStats (overview + steps + segments + hourly + weekday + variants) + listJourneyEnteredCustomers (회사 격리 + 페이지네이션)
import { buildJourneyStats, listJourneyEnteredCustomers } from '../utils/journey-stats';
// ★ D197 (2026-05-22) Phase B-2: Predictive Suite — 회사 예측 점수 분포 + Top 위험/구매 가능성 + 모델 정확도
// ★ D210+ Phase 3 (2026-05-23 Harold 명시): listCompanyPredictionCustomers — 회사 전체 customer 영역 페이지네이션 + 검색 + 필터 + 정렬
import {
  getCompanyPredictionDistribution,
  getCompanyPredictionSummary,
  listCompanyPredictionCustomers,
  type PredictionFilterType,
  type PredictionSortType,
} from '../utils/predictive-suite';
// ★ D205 (2026-05-22) AI 자율 진단 + 자동 추천 — 옛 ContinuousOperator + next-action-advisor 진화
import { diagnoseCompanyHealth } from '../utils/ai-self-diagnosis';
// ★ D211+ Phase 2 (2026-05-23 Harold 명시): CT-59 Journey Step Diagnosis — 여정 단계별 진단 + 다음 단계 추천
import { diagnoseJourneySteps, recommendNextJourneyStep } from '../utils/journey-step-diagnosis';
// ★ D211+ Phase A (2026-05-23 Harold 명시): CT-60/CT-61 시뮬레이션 + variant 자동 생성 + 실시간 위치
import { simulateJourney } from '../utils/journey-simulator';
import { normalizeJourneyOptions } from '../utils/journey-options-validator';
import { generateVariantsFromMessage } from '../utils/variant-generator';
import { getJourneyLiveSnapshot } from '../utils/journey-stats';
// ★ D211+ Predictive 강화 (2026-05-23 Harold 명시): CT-63 Explainability
import { explainCustomerPrediction } from '../utils/predictive-explainer';


// ★ D79: 인라인 래퍼 제거 → CT-01 buildFilterWhereClauseCompat 직접 사용

const router = Router();

router.use(authenticate);

// GET /api/ai/status - API 상태 확인
router.get('/status', async (req: Request, res: Response) => {
  const status = checkAPIStatus();
  return res.json(status);
});

// POST /api/ai/generate-message - AI 메시지 생성
router.post('/generate-message', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId) {
      return res.status(403).json({ error: '회사 권한이 필요합니다' });
    }

    const { prompt, filters, productName, discountRate, eventName, brandName, channel, isAd, usePersonalization, personalizationVars, personalFields } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: '프롬프트를 입력해주세요' });
    }

    // 회사 정보 조회 (브랜드 정보 포함)
    const companyResult = await query(
      'SELECT COALESCE(reject_number, opt_out_080_number) as reject_number, brand_name, brand_slogan, brand_description, brand_tone, customer_schema FROM companies WHERE id = $1',
      [companyId]
    );
    const companyInfo = companyResult.rows[0] || {};
    // ★ D102: getOpt080Number 컨트롤타워 사용 (인라인 조회 제거)
    const userOpt080 = await getOpt080Number(userId || null, companyId);
    if (userOpt080) companyInfo.reject_number = userOpt080;
    const { fieldMappings: varCatalog, availableVars } = extractVarCatalog(companyInfo.customer_schema);

    // ★ D101: 커스텀 필드 라벨을 availableVars에 추가 (generateMessages에서 개인화 변수 매칭용)
    const fieldDefsForVars = await query(
      `SELECT field_key, field_label FROM customer_field_definitions WHERE company_id = $1 AND (is_hidden = false OR is_hidden IS NULL)`,
      [companyId]
    );
    for (const fd of fieldDefsForVars.rows) {
      const label = fd.field_label || fd.field_key;
      if (!availableVars.includes(label)) {
        availableVars.push(label);
        varCatalog[label] = {
          column: fd.field_key,
          type: 'string',
          description: label,
          sample: '',
          storageType: 'custom_fields' as any,
        };
      }
    }

    // ★ D121: 실제 데이터가 있는 필드만 남김 — filterVarCatalogByData 컨트롤타워
    // 데이터 없는 필드를 AI가 사용하면 빈 공간 발생 방지
    await filterVarCatalogByData(varCatalog, availableVars, companyId);

    // 타겟 정보 조회
    let targetQuery = 'SELECT COUNT(*) as total FROM customers WHERE company_id = $1 AND is_active = true AND sms_opt_in = true';
    const targetResult = await query(targetQuery, [companyId]);

    const statsResult = await query(
      `SELECT 
        AVG((custom_fields->>'purchase_count')::numeric) as avg_purchase_count,
        AVG((custom_fields->>'total_spent')::numeric) as avg_total_spent
       FROM customers WHERE company_id = $1 AND is_active = true`,
      [companyId]
    );

    const targetInfo = {
      total_count: parseInt(targetResult.rows[0].total),
      avg_purchase_count: parseFloat(statsResult.rows[0].avg_purchase_count) || 0,
      avg_total_spent: parseFloat(statsResult.rows[0].avg_total_spent) || 0,
    };

    // 카카오 채널인 경우 sender_key 조회
    let kakaoSenderKey: string | undefined;
    if (channel === '카카오') {
      const kakaoResult = await query(
        'SELECT profile_key FROM kakao_sender_profiles WHERE company_id = $1 AND is_active = true LIMIT 1',
        [companyId]
      );
      kakaoSenderKey = kakaoResult.rows[0]?.profile_key;
    }

    // ★ D120: 고객사 최근 실제 발송 성공 문안 자동 조회 — AI few-shot 학습용
    // spam_filter_tests가 아닌 campaigns(실제 발송 성공)에서 가져와야 검증된 문안만 포함
    // ★ D144: PG success_count 캐시 의존 제거 — status='completed'+sent_at 30일 조건만으로 충분
    const recentMsgResult = await query(`
      SELECT DISTINCT message_content as content
      FROM campaigns
      WHERE company_id = $1 AND status = 'completed'
        AND message_content IS NOT NULL
        AND LENGTH(message_content) > 30
        AND sent_at > NOW() - INTERVAL '30 days'
      ORDER BY content
      LIMIT 10
    `, [companyId]);
    const recentMessages: string[] = recentMsgResult.rows.map((r: any) => r.content);

    const extraContext = {
      productName,
      discountRate,
      eventName,
      brandName: companyInfo.brand_name || brandName || '브랜드',
      brandSlogan: companyInfo.brand_slogan,
      brandDescription: companyInfo.brand_description,
      brandTone: companyInfo.brand_tone,
      channel,
      isAd,
      rejectNumber: companyInfo.reject_number,
      usePersonalization,
      personalizationVars: personalizationVars || personalFields,
      availableVarsCatalog: varCatalog,
      availableVars: availableVars,
      recentMessages,
      companyId,  // ★ D225+ Brand Voice Learning — 회사별 가이드라인 자동 주입
    };

    const result = await generateMessages(prompt, targetInfo, extraContext);

    return res.json(result);
  } catch (error) {
    console.error('AI 메시지 생성 오류:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/ai/recommend-target - AI 타겟 추천
router.post('/recommend-target', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    if (!companyId) {
      return res.status(403).json({ error: '회사 권한이 필요합니다' });
    }

    // ★ CT-17: 요금제 게이팅 — ai_messaging (BASIC+)
    {
      const ctx = await loadPlanContext(companyId);
      if (!ctx) return res.status(404).json({ error: '회사 정보를 찾을 수 없습니다.' });
      const check = canUseFeature(ctx, 'ai_messaging');
      if (!check.allowed) {
        return res.status(403).json({ error: check.errorMsg, code: check.errorCode });
      }
    }

    const { objective } = req.body;

    if (!objective) {
      return res.status(400).json({ error: '마케팅 목표를 입력해주세요' });
    }

    // 회사 정보 조회 (스키마 포함)
    const companyResult = await query(
      `SELECT company_name, business_type, COALESCE(reject_number, opt_out_080_number) as reject_number, brand_name, customer_schema FROM companies WHERE id = $1::uuid`,
      [companyId]
    );
    const companyInfo = companyResult.rows[0] || {};
    companyInfo.name = companyInfo.company_name;
    // ★ D102: getOpt080Number 컨트롤타워 사용 (인라인 조회 제거)
    const userOpt080 = await getOpt080Number(userId || null, companyId);
    if (userOpt080) companyInfo.reject_number = userOpt080;

    // 카카오 프로필 존재 여부 확인
    const kakaoProfileResult = await query(
      'SELECT COUNT(*) FROM kakao_sender_profiles WHERE company_id = $1 AND is_active = true',
      [companyId]
    );
    const hasKakaoProfile = parseInt(kakaoProfileResult.rows[0].count) > 0;
    (companyInfo as any).has_kakao_profile = hasKakaoProfile;

    // ★ B16-01: 브랜드 격리 — store-scope 컨트롤타워
    let storeFilter = '';
    const baseParams: any[] = [companyId];

    if (userType === 'company_user' && userId) {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'filtered') {
        storeFilter = ' AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($2::text[]))';
        baseParams.push(scope.storeCodes);
      } else if (scope.type === 'blocked') {
        return res.status(403).json({ error: '소속 브랜드가 지정되지 않았습니다. 관리자에게 문의하세요.' });
      }
    }

    // 고객 통계 조회
    const statsResult = await query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE sms_opt_in = true) as sms_opt_in_count,
        COUNT(*) FILTER (WHERE gender = ANY($${baseParams.length + 1}::text[])) as male_count,
        COUNT(*) FILTER (WHERE gender = ANY($${baseParams.length + 2}::text[])) as female_count,
        AVG((custom_fields->>'purchase_count')::numeric) as avg_purchase_count,
        AVG((custom_fields->>'total_spent')::numeric) as avg_total_spent
       FROM customers
       WHERE company_id = $1 AND is_active = true${storeFilter}`,
      [...baseParams, getGenderVariants('M'), getGenderVariants('F')]
    );

    const result = await recommendTarget(companyId, objective, statsResult.rows[0], companyInfo);

    console.log('AI 필터 결과:', JSON.stringify(result.filters, null, 2));

    // ★ 실제 타겟 수 계산 — countFilteredCustomers 공통 함수 사용
    // 빈 필터({})도 정상 카운트 (AI가 전체 대상을 의도한 경우 포함)
    const filterResult = await countFilteredCustomers(companyId, result.filters, userId!, storeFilter, baseParams);
    const actualCount = filterResult.count;
    const unsubscribeCount = filterResult.unsubscribeCount;
    console.log(`[AI] 필터 카운트 결과: ${actualCount}명 (수신거부: ${unsubscribeCount}명)`);

    // ★ D171 (Harold 명시 영구 원칙): 타겟 매칭 0건 시 자동완화 박지 X — 발송 차단이 정합.
    // AI가 임의로 조건 풀어서 다른 고객에게 발송 = 마케팅 의도 파괴 + 수신자 권리 침해.
    // 0건 응답을 그대로 frontend에 박아 사용자가 조건을 재입력하도록 안내.
    // 메모리: feedback_no_target_auto_relax.md

    // ★ 풀백 감지 — 로그만 남김 (DB 추출 결과는 정확하므로 임의로 0으로 덮어쓰지 않음)
    const totalCustomers = parseInt(statsResult.rows[0].sms_opt_in_count || statsResult.rows[0].total);
    if (Object.keys(result.filters).length > 0 && actualCount >= totalCustomers * 0.95) {
      console.warn(`[AI] ⚠️ 풀백 감지 (로그만): 필터 ${JSON.stringify(result.filters)}, actualCount=${actualCount}, total=${totalCustomers}`);
    }

    result.estimated_count = actualCount;
    (result as any).unsubscribe_count = unsubscribeCount;
    (result as any).has_kakao_profile = hasKakaoProfile;

    // ★ D85: 샘플 고객 1명 조회
    // - sample_customer: displayName 키 (프론트 미리보기용 — %이름%, %등급% 등)
    // - sample_customer_raw: column 키 + custom_fields (백엔드 replaceVariables용)
    // 최신 필터 기준으로 WHERE 재생성 (자동완화 시 result.filters가 변경됨)
    const { sql: sampleFilterWhere, params: sampleFilterParams } = buildFilterWhereClauseCompat(result.filters, baseParams.length + 1);
    const sampleUnsubIdx = baseParams.length + sampleFilterParams.length + 1;

    let sampleCustomer: Record<string, string> = {};
    let sampleCustomerRaw: Record<string, any> = {};
    // ★ D142+ (2026-04-29) 0429 PDF B4 — 머지값 max byte 계산용 N명 sample
    //   기존: LIMIT 1 → 자동발송 미리보기 byte ≠ 실발송 byte 차이로 잘림 사고
    //   변경: LIMIT 100 → 프론트 getMaxByteMessage()가 가장 긴 변수값으로 보수적 byte 계산
    let sampleCustomersRaw: Record<string, any>[] = [];
    try {
      const sampleResult = await query(
        `SELECT name, gender, age, grade, points, email, address,
                recent_purchase_store, registered_store, registration_type,
                store_phone, store_name, store_code, region,
                recent_purchase_amount, total_purchase_amount, purchase_count,
                birth_date, recent_purchase_date, custom_fields
         FROM customers c
         WHERE c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true${storeFilter} ${sampleFilterWhere}
         AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${sampleUnsubIdx} AND u.phone = c.phone)
         ORDER BY c.updated_at DESC NULLS LAST LIMIT 100`,
        [...baseParams, ...sampleFilterParams, userId]
      );

      // ★ D142+ B4: 100명 raw 배열 매핑 (column 키 + custom_fields 평면화 + enum 역변환)
      for (const row of sampleResult.rows) {
        const rawRow: Record<string, any> = { ...row };
        for (const fk of Object.keys(FIELD_DISPLAY_MAP)) {
          if (rawRow[fk] != null) rawRow[fk] = reverseDisplayValue(fk, rawRow[fk]);
        }
        // custom_fields JSONB 내부 키를 최상위로 평면화 (getMaxByteMessage가 r.custom_1 직접 접근)
        if (rawRow.custom_fields && typeof rawRow.custom_fields === 'object') {
          for (const [k, v] of Object.entries(rawRow.custom_fields)) {
            if (rawRow[k] === undefined) rawRow[k] = v;
          }
        }
        sampleCustomersRaw.push(rawRow);
      }

      if (sampleResult.rows[0]) {
        const row = sampleResult.rows[0];
        // ★ D85: column 키 raw 데이터 보존 (백엔드 replaceVariables용)
        sampleCustomerRaw = { ...row };
        // ★ B+0407-1: raw에도 enum 필드(gender F→여성) 미리 변환 저장
        //   frontend의 모든 표시 컨트롤타워가 column 키로 접근할 때 이미 정상 표시
        for (const fk of Object.keys(FIELD_DISPLAY_MAP)) {
          if (sampleCustomerRaw[fk] != null) {
            sampleCustomerRaw[fk] = reverseDisplayValue(fk, sampleCustomerRaw[fk]);
          }
        }
        // 표준 필드 → displayName 매핑 (프론트 미리보기용)
        for (const f of FIELD_MAP) {
          if (f.storageType === 'custom_fields' || f.fieldKey === 'phone' || f.fieldKey === 'sms_opt_in') continue;
          const val = row[f.columnName];
          if (val !== null && val !== undefined && val !== '') {
            // ★ B+0407-1: enum 필드는 한글 역변환 우선 (gender 'F' → '여성')
            //   sampleCustomer는 displayName 키(한국어 라벨) 형태이므로
            //   FIELD_DISPLAY_MAP[fieldKey]가 매칭되는 enum은 표시 시점에 이미 변환되어 저장
            if (FIELD_DISPLAY_MAP[f.fieldKey]) {
              sampleCustomer[f.displayName] = reverseDisplayValue(f.fieldKey, val);
            } else if (f.dataType === 'number' && !isNaN(Number(val))) {
              sampleCustomer[f.displayName] = Number(val).toLocaleString();
            } else if (f.dataType === 'date' && val) {
              // ★ D100: 날짜 포맷팅 컨트롤타워 사용 — 순수 YYYY-MM-DD 하루 밀림 방지
              sampleCustomer[f.displayName] = formatDateValue(val);
            } else {
              sampleCustomer[f.displayName] = String(val);
            }
          }
        }
        // 커스텀 필드 → 실제 라벨명 매핑
        // ★ D142 (2026-04-28): Harold님 원칙 — "커스텀 필드는 있는 그대로".
        //   D101에서 field_type 기반 NUMBER/DATE 자동 추론을 넣었으나, 이게 PDF 0428 #5
        //   "한줄로AI 미리보기/스팸필터/메시지추천 모두 콤마" 사고의 핵심 원인.
        //   field_type='NUMBER'여도 사용자가 텍스트(생년월일 14자리 varchar 등)로 올린 경우 콤마 사고.
        //   고정 필드는 단일 진입점(messageUtils.replaceVariables → renderFieldValue)에서 처리되므로
        //   여기서는 String() 원본만 박제. 자동 추론 발동 X.
        if (row.custom_fields && typeof row.custom_fields === 'object') {
          const defResult = await query(
            'SELECT field_key, field_label, field_type FROM customer_field_definitions WHERE company_id = $1',
            [companyId]
          );
          for (const def of defResult.rows) {
            const val = row.custom_fields[def.field_key];
            if (val !== null && val !== undefined && val !== '') {
              sampleCustomer[def.field_label] = String(val);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[AI] 샘플 고객 조회 실패 (무시)', e);
    }
    (result as any).sample_customer = sampleCustomer;
    (result as any).sample_customer_raw = sampleCustomerRaw;
    // ★ D142+ B4: 머지값 max byte 계산용 N명 sample (자동발송 미리보기 byte 정확도 보장)
    (result as any).sample_customers_raw = sampleCustomersRaw;

    return res.json(result);
  } catch (error) {
    console.error('AI 타겟 추천 오류:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ============================================================
// ★ 기능 2: AI 다음 캠페인 추천 (발송 결과 기반)
// 프로 이상 ai_premium_enabled 전용
// ============================================================
router.post('/recommend-next-campaign', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;

    if (!companyId) {
      return res.status(403).json({ error: '회사 권한이 필요합니다' });
    }

    // ★ CT-17: AI 프리미엄 게이팅 (PRO+)
    {
      const ctx = await loadPlanContext(companyId);
      if (!ctx) return res.status(404).json({ error: '회사 정보를 찾을 수 없습니다.' });
      const check = canUseFeature(ctx, 'ai_premium');
      if (!check.allowed) {
        return res.status(403).json({ error: check.errorMsg, code: check.errorCode });
      }
    }

    const { months } = req.body;
    const analysisMonths = Math.min(Math.max(months || 3, 1), 12);

    // 1) 캠페인 성과 집계 — stats-aggregation.ts 컨트롤타워
    const performanceData = await aggregateCampaignPerformance(companyId, analysisMonths);

    if (performanceData.totalCampaigns === 0) {
      return res.json({
        recommended_target: { filters: {}, reasoning: '분석할 캠페인 데이터가 없습니다.' },
        recommended_time: '',
        recommended_channel: 'SMS',
        insights: ['최근 발송한 캠페인이 없어 추천을 생성할 수 없습니다. 캠페인을 발송한 후 다시 시도해주세요.'],
        suggested_objective: '',
        performance_data: performanceData,
      });
    }

    // 2) 고객 통계 조회
    const statsResult = await query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE sms_opt_in = true) as sms_opt_in_count,
        COUNT(*) FILTER (WHERE gender IN ('M', '남', '남성', 'male')) as male_count,
        COUNT(*) FILTER (WHERE gender IN ('F', '여', '여성', 'female')) as female_count
       FROM customers WHERE company_id = $1 AND is_active = true`,
      [companyId]
    );

    // 3) 회사 정보
    const companyResult = await query(
      'SELECT company_name, business_type, brand_name FROM companies WHERE id = $1',
      [companyId]
    );

    // 4) AI 추천 — services/ai.ts 컨트롤타워
    const recommendation = await recommendNextCampaign(
      companyId, performanceData, statsResult.rows[0], companyResult.rows[0]
    );

    return res.json({
      ...recommendation,
      performance_data: performanceData,
    });
  } catch (error) {
    console.error('AI 캠페인 추천 오류:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ============================================================
// 타겟 조건 수정 후 재조회 (AI 맞춤한줄 Step 3 수정하기)
// ============================================================
router.post('/recount-target', authenticate, async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    if (!companyId) {
      return res.status(403).json({ error: '회사 권한이 필요합니다' });
    }

    const { targetCondition, originalTargetFilters } = req.body;

    if (!targetCondition) {
      return res.status(400).json({ error: 'targetCondition이 필요합니다' });
    }

    // targetCondition → targetFilters 변환 (기본 필드)
    const targetFilters: Record<string, any> = {};

    if (targetCondition.gender) {
      const g = targetCondition.gender;
      const gKey = ['남성', '남', '남자', 'male', 'M', 'm'].some(v => g.includes(v)) ? 'M'
        : ['여성', '여', '여자', 'female', 'F', 'f'].some(v => g.includes(v)) ? 'F' : null;
      if (gKey) targetFilters.gender = gKey;
    }

    if (targetCondition.grade) {
      const grades = targetCondition.grade.split(/[,\/\s]+/).map((g: string) => g.trim().toUpperCase()).filter(Boolean);
      if (grades.length > 0) targetFilters.grade = { value: grades, operator: 'in' };
    }

    if (targetCondition.ageRange) {
      const ageMatch = targetCondition.ageRange.match(/(\d+)/g);
      if (ageMatch) {
        const nums = ageMatch.map(Number);
        if (nums.length === 1) {
          const decade = nums[0] < 10 ? nums[0] * 10 : nums[0];
          targetFilters.age = [decade, decade + 9];
        } else {
          const minDecade = Math.min(...nums) < 10 ? Math.min(...nums) * 10 : Math.min(...nums);
          const maxDecade = Math.max(...nums) < 10 ? Math.max(...nums) * 10 + 9 : Math.max(...nums) + 9;
          targetFilters.age = [minDecade, maxDecade];
        }
      }
    }

    if (targetCondition.region) {
      targetFilters.region = { value: [targetCondition.region], operator: 'in' };
    }

    if (targetCondition.storeName) {
      // ★ B+0407-2: 'eq'는 정확 일치만 → 사용자가 "강남점"이라 입력했는데
      //   DB는 "강남직영점"이면 0건. 'contains'로 부분 매칭하여 사용자 친화적으로.
      //   (CT-01 customer-filter는 contains 시 ILIKE '%X%'로 처리됨, D89)
      targetFilters.store_name = { value: targetCondition.storeName, operator: 'contains' };
    }

    // ★ B+0407-2: 최소 구매금액 처리 (B옵션 — 안전 필드)
    //   기존에는 처리 안 되어 originalTargetFilters의 원래 값이 그대로 사용됨 → 사용자 수정 무시 버그
    if (targetCondition.minPurchaseAmount) {
      const numStr = String(targetCondition.minPurchaseAmount).replace(/[^0-9]/g, '');
      const amount = parseInt(numStr);
      if (!isNaN(amount) && amount > 0) {
        targetFilters.total_purchase_amount = { value: amount, operator: 'gte' };
      }
    }

    // birth_date (생일 월 필터)
    if (targetCondition.birthMonth) {
      targetFilters.birth_date = { value: parseInt(targetCondition.birthMonth), operator: 'birth_month' };
    }

    // ★ D84+B+0407-2: 커스텀 필드 + 기타 필드 보존 — parseBriefing이 생성한 custom_fields.*, registered_store 등
    // originalTargetFilters에서 기본 필드(위에서 이미 변환한 것)를 제외한 나머지를 merge
    // ★ B+0407-2: total_purchase_amount 추가 — minPurchaseAmount 새로 처리하므로 originalTargetFilters의 원래 값 무시
    if (originalTargetFilters && typeof originalTargetFilters === 'object') {
      const basicFieldKeys = new Set([
        'gender', 'grade', 'age', 'region', 'store_name', 'birth_date',
        'total_purchase_amount',
      ]);
      for (const [key, value] of Object.entries(originalTargetFilters)) {
        if (!basicFieldKeys.has(key) && value != null) {
          targetFilters[key] = value;
        }
      }
    }

    // 사용자 매장 필터 (일반 사용자는 본인 store_codes만)
    // ★ B16-01: 브랜드 격리 — store-scope 컨트롤타워
    let storeFilter = '';
    const baseParams: any[] = [companyId];

    if (userType === 'company_user' && userId) {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'filtered') {
        storeFilter = ' AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($2::text[]))';
        baseParams.push(scope.storeCodes);
      } else if (scope.type === 'blocked') {
        return res.status(403).json({ error: '소속 브랜드가 지정되지 않았습니다. 관리자에게 문의하세요.' });
      }
    }

    // buildFilterWhereClause 호출 (recommend-target과 동일한 조건)
    const { sql: filterSql, params: filterParams } = buildFilterWhereClauseCompat(targetFilters, baseParams.length + 1);

    // ★ B17-01: 수신거부 user_id 기준 통일
    const unsubIdxB = baseParams.length + filterParams.length + 1;
    const countResult = await query(
      `SELECT COUNT(*) FROM customers c
       WHERE c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true${storeFilter} ${filterSql}
       AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubIdxB} AND u.phone = c.phone)`,
      [...baseParams, ...filterParams, userId]
    );
    const estimatedCount = parseInt(countResult.rows[0].count);

    const unsubResult = await query(
      `SELECT COUNT(*) FROM customers c
       WHERE c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true${storeFilter} ${filterSql}
       AND EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubIdxB} AND u.phone = c.phone)`,
      [...baseParams, ...filterParams, userId]
    );
    const unsubscribeCount = parseInt(unsubResult.rows[0].count);

    res.json({ estimatedCount, unsubscribeCount, targetFilters });
  } catch (error) {
    console.error('타겟 재조회 오류:', error);
    res.status(500).json({ error: '타겟 재조회 실패' });
  }
});
// POST /api/ai/parse-briefing - 프로모션 브리핑 → 구조화 파싱 + 타겟 고객 수 산출
router.post('/parse-briefing', authenticate, async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    if (!companyId) {
      return res.status(403).json({ error: '회사 권한이 필요합니다' });
    }

    // ★ CT-17: 요금제 게이팅 — ai_messaging (BASIC+)
    {
      const ctx = await loadPlanContext(companyId);
      if (!ctx) return res.status(404).json({ error: '회사 정보를 찾을 수 없습니다.' });
      const check = canUseFeature(ctx, 'ai_messaging');
      if (!check.allowed) {
        return res.status(403).json({ error: check.errorMsg, code: check.errorCode });
      }
    }

    const { briefing } = req.body;
    if (!briefing || briefing.trim().length < 10) {
      return res.status(400).json({ error: '브리핑 내용을 10자 이상 입력해주세요' });
    }

    // ★ D84: companyId 전달 → 동적 필드 프롬프트 생성 (커스텀 필드 + 전체 FIELD_MAP 지원)
    const result = await parseBriefing(briefing.trim(), companyId);

    // 사용자 매장 필터 (일반 사용자는 본인 store_codes만)
    // ★ B16-01: store_codes 없는 company_user → 차단
    let storeFilter = '';
    const baseParams: any[] = [companyId];

    // ★ B16-01: 브랜드 격리 — store-scope 컨트롤타워
    if (userType === 'company_user' && userId) {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'filtered') {
        storeFilter = ' AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($2::text[]))';
        baseParams.push(scope.storeCodes);
      } else if (scope.type === 'blocked') {
        return res.status(403).json({ error: '소속 브랜드가 지정되지 않았습니다. 관리자에게 문의하세요.' });
      }
    }

    // targetFilters 기반 고객 수 산출
    const targetFilters = result.targetFilters || {};
    const { sql: filterWhere, params: filterParams } = buildFilterWhereClauseCompat(targetFilters, baseParams.length + 1);

    // ★ B17-01: 수신거부 user_id 기준 통일
    const unsubIdxC = baseParams.length + filterParams.length + 1;
    const countResult = await query(
      `SELECT COUNT(*) FROM customers c
       WHERE c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true${storeFilter} ${filterWhere}
       AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubIdxC} AND u.phone = c.phone)`,
      [...baseParams, ...filterParams, userId]
    );
    const estimatedCount = parseInt(countResult.rows[0].count);

    const unsubResult = await query(
      `SELECT COUNT(*) FROM customers c
       WHERE c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true${storeFilter} ${filterWhere}
       AND EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubIdxC} AND u.phone = c.phone)`,
      [...baseParams, ...filterParams, userId]
    );
    const unsubscribeCount = parseInt(unsubResult.rows[0].count);

    // ★ D88: 타겟 필터에 맞는 샘플 고객 1명 반환 — 미리보기용
    // enabled-fields의 sample(타겟 무관)과 달리, 실제 타겟 고객에서 샘플링
    let sampleCustomer: Record<string, any> = {};
    try {
      const sampleResult = await query(
        `SELECT * FROM customers c
         WHERE c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true${storeFilter} ${filterWhere}
         AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubIdxC} AND u.phone = c.phone)
         ORDER BY c.updated_at DESC NULLS LAST LIMIT 1`,
        [...baseParams, ...filterParams, userId]
      );
      if (sampleResult.rows.length > 0) {
        const row = sampleResult.rows[0];
        sampleCustomer = { ...row };
        // custom_fields JSONB flat 처리 — 프론트에서 field_key로 직접 접근 가능하게
        // ★ D142 (2026-04-28): custom_* 값은 String() 강제 — 프론트 typeof 자동 추론 차단 (Harold님 원칙)
        if (row.custom_fields && typeof row.custom_fields === 'object') {
          for (const [k, v] of Object.entries(row.custom_fields)) {
            if (sampleCustomer[k] === undefined) sampleCustomer[k] = v == null ? '' : String(v);
          }
        }
      }
    } catch (e) { console.warn('[parse-briefing] 샘플 고객 조회 실패:', e); }

    return res.json({
      ...result,
      estimatedCount,
      unsubscribeCount,
      sampleCustomer,
    });
  } catch (error) {
    console.error('브리핑 파싱 오류:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/ai/generate-custom - 개인화 맞춤 문안 생성
router.post('/generate-custom', authenticate, async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId) {
      return res.status(403).json({ error: '회사 권한이 필요합니다' });
    }

    // ★ CT-17: 요금제 게이팅 — ai_messaging (BASIC+)
    {
      const ctx = await loadPlanContext(companyId);
      if (!ctx) return res.status(404).json({ error: '회사 정보를 찾을 수 없습니다.' });
      const check = canUseFeature(ctx, 'ai_messaging');
      if (!check.allowed) {
        return res.status(403).json({ error: check.errorMsg, code: check.errorCode });
      }
    }

    const { briefing, promotionCard, personalFields, fieldLabels, url, tone, brandName, channel, isAd } = req.body;

    if (!promotionCard || !personalFields || personalFields.length === 0) {
      return res.status(400).json({ error: '프로모션 카드와 개인화 필드를 입력해주세요' });
    }

    // 회사 정보 조회
    const companyResult = await query(
      'SELECT COALESCE(reject_number, opt_out_080_number) as reject_number, brand_name, brand_slogan, brand_description, brand_tone FROM companies WHERE id = $1',
      [companyId]
    );
    const companyInfo = companyResult.rows[0] || {};
    // ★ D102: getOpt080Number 컨트롤타워 사용 (인라인 조회 제거)
    const userOpt080 = await getOpt080Number(userId || null, companyId);
    if (userOpt080) companyInfo.reject_number = userOpt080;

    const result = await generateCustomMessages({
      briefing,
      promotionCard,
      personalFields,
      fieldLabels,
      url,
      tone,
      brandName: companyInfo.brand_name || brandName || '브랜드',
      brandTone: companyInfo.brand_tone,
      channel: channel || 'LMS',
      isAd,
      rejectNumber: companyInfo.reject_number,
    });

    return res.json(result);
  } catch (error) {
    console.error('맞춤 문안 생성 오류:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ============================================================
// POST /api/ai/refine-message — AI 인라인 다듬기 (D152+ PDF 0511 funnel fix)
// ============================================================
//
// 직접발송 화면에서 작성 중인 메시지를 톤·길이·이모지·스팸회피 다듬기 적용한 안 4개 반환.
// 요금제 게이팅: requirePlanFeature('ai_messaging') (BASIC+ / TRIAL 자동).
// 5/11 67사 무료체험 funnel(고객DB 업로드 2/67=3%) 절대 병목 해소 — AI 가치를 DB 없이 즉시 체감.
router.post('/refine-message', requirePlanFeature('ai_messaging'), async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다' });
    }
    const { message, tone, companyName: bodyCompanyName } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, error: '다듬을 메시지를 입력해주세요' });
    }
    if (message.length > 4000) {
      return res.status(400).json({ success: false, error: '메시지가 너무 깁니다 (최대 4000자)' });
    }
    // ★ D152+ Harold님 지시 재정정 (2026-05-12): 8→2 컨셉 축소.
    //   ① seasonal — 시즌/월별 감성 자연 반영
    //   ② trendy   — 최신 트렌드 감성 카피
    //   톤 분류 자체는 의미 X — 풍성화 본질이 핵심.
    const VALID_TONES = ['seasonal', 'trendy'] as const;
    type ValidTone = typeof VALID_TONES[number];
    const safeTone: ValidTone = (VALID_TONES as readonly string[]).includes(tone) ? (tone as ValidTone) : 'seasonal';

    // 회사 브랜드명 + 무료수신거부 번호 조회 (body 우선, 미전달 시 DB)
    let companyName: string | undefined = typeof bodyCompanyName === 'string' && bodyCompanyName.trim()
      ? bodyCompanyName.trim()
      : undefined;
    const companyResult = await query(
      'SELECT brand_name, company_name, COALESCE(reject_number, opt_out_080_number) AS reject_number FROM companies WHERE id = $1',
      [companyId],
    );
    const row = companyResult.rows[0] || {};
    if (!companyName) {
      companyName = row.brand_name || row.company_name || undefined;
    }
    // CT-02 (getOpt080Number) — user 단위 080 우선
    const userOpt080 = await getOpt080Number(userId || null, companyId);
    const rejectNumber: string | undefined = userOpt080 || row.reject_number || undefined;

    // D120 패턴 미러 — 회사별 최근 발송 문안 10개 (campaigns.message_content, 30일, status='completed', LENGTH > 30)
    //   AI few-shot 학습용 — 각 회사 톤/스타일 자동 반영해서 다듬기 품질 향상.
    const recentMsgResult = await query(
      `SELECT DISTINCT message_content AS content
         FROM campaigns
        WHERE company_id = $1 AND status = 'completed'
          AND message_content IS NOT NULL
          AND LENGTH(message_content) > 30
          AND sent_at > NOW() - INTERVAL '30 days'
        ORDER BY content
        LIMIT 10`,
      [companyId],
    );
    const recentMessages: string[] = recentMsgResult.rows.map((r: any) => r.content);

    const result = await refineDirectMessage({
      message,
      tone: safeTone,
      companyName,
      recentMessages,
      rejectNumber,
      companyId,  // ★ D225+ Brand Voice Learning — 회사별 가이드라인 자동 주입
    });

    if (result.candidates.length === 0) {
      return res.status(200).json({
        success: false,
        error: 'AI가 다듬은 안을 생성하지 못했습니다. 메시지를 조금 더 구체적으로 작성하거나 다시 시도해 주세요.',
        candidates: [],
      });
    }
    // 성공(다듬은 안 생성) 후 차감 — 문안 다듬기 1크레딧. refineDirectMessage는 callAIWithFallback 우회라 여기서 직접 차감. 실패 시 미차감.
    await deductCreditSafe({ companyId, cost: getCreditCost('refine-direct'), source: 'refine-direct', createdBy: req.user?.userId });
    return res.json({ success: true, candidates: result.candidates });
  } catch (err: any) {
    console.error('[ai/refine-message] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'AI 다듬기 실패' });
  }
});

// ============================================================
// ★ D178 (2026-05-19) — AI Operator 진입 가능 여부 (Harold 박힘 검증 단계 hoyun 박음)
//   Frontend가 메뉴 클릭 시 본 endpoint 박음 → allowed=true 면 /ai-operator 진입, false 면 BetaFeatureModal 박음
// ============================================================
router.get('/operator/access', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.json({ success: true, allowed: false });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.json({ success: true, allowed: false });
    const allowed = isAiOperatorAllowed(planCtx, req.user);
    // ★ D209+ (Harold 명시 2026-05-23): 응답 확장 — frontend BetaFeatureModal 정확 안내 정합
    return res.json({
      success: true,
      allowed,
      planCode: planCtx.planCode,
      legacyGrandfathered: planCtx.legacyGrandfathered,
    });
  } catch (err: any) {
    console.error('[AI Operator /access] 오류:', err);
    return res.json({ success: true, allowed: false });
  }
});

// ============================================================
// ★ D210+ Phase 2-fix1 (Harold 명시 2026-05-23) — 회사 customer DB 실측 프로필 조회
//   본질 = 마케팅 담당자 검토 UI 안내 카드 (CompanyDataProfileCard) data source.
//   "AI가 우리 회사 데이터 이만큼 정확히 활용했네" 시각 확인 + 신뢰감.
//   CT-58 company-data-profile 활용 (1시간 캐시 자동).
// ============================================================
router.get('/operator/data-profile', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    }
    const profile = await getCompanyDataProfile(companyId);
    return res.json({
      success: true,
      totalCustomers: profile.totalCustomers,
      safeFields: profile.safeFields.map((f) => ({
        field: f.field,
        label: f.label,
        percentVar: f.percentVar,
        fillRate: f.fillRate,
      })),
      conditionalFields: profile.conditionalFields.map((f) => ({
        field: f.field,
        label: f.label,
        percentVar: f.percentVar,
        fillRate: f.fillRate,
      })),
      blockedFields: profile.blockedFields.map((f) => ({
        field: f.field,
        label: f.label,
        fillRate: f.fillRate,
      })),
      analyzedAt: profile.analyzedAt,
    });
  } catch (err: any) {
    console.error('[AI Operator /data-profile] 오류:', err);
    return res.status(500).json({ success: false, error: '회사 데이터 프로필 조회 실패' });
  }
});

// ============================================================
// ★ D210+ Phase 2-fix5 (Harold 명시 2026-05-23) — 추출된 타겟 영역 안 상위 1건 고객 조회
//   본질 = 추천 메시지 본문 안 %변수% → 추출 타겟 안 상위 고객 데이터 치환 미리보기 (원본/적용 토글 머지 영역).
//   옛 fix4 사고 = 전체 customer 안 상위 1건 (filters X) → 정정 = proposal.target.filters 매칭 영역 안 상위.
//   응답 = displayName 키 매트릭스 ({ "고객명": "김민수", "등급": "VIP", ... }) — mergeAndHighlightVars 영역 정합.
// ============================================================
router.post('/operator/sample-customer', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    }

    const { triggerEvent, triggerFilters } = req.body || {};
    if (!triggerEvent || typeof triggerEvent !== 'string') {
      return res.json({ success: true, sampleCustomer: null });
    }

    // 여정 trigger 기준 후보 추출 (발송과 동일 컨트롤타워). 상위 30명 추출 후 store-scope 통과 첫 1명.
    const targetIds = await selectJourneyTargetCustomerIds(companyId, triggerEvent, triggerFilters || {}, 30);
    if (targetIds.length === 0) {
      return res.json({ success: true, sampleCustomer: null });
    }

    // ★ B16-01: 브랜드 격리 — store-scope 컨트롤타워 (preview-recipients 정합)
    let storeFilter = '';
    const allParams: any[] = [companyId, targetIds];
    if (userType === 'company_user' && userId) {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'filtered') {
        storeFilter = ' AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($3::text[]))';
        allParams.push(scope.storeCodes);
      } else if (scope.type === 'blocked') {
        return res.json({ success: true, sampleCustomer: null });
      }
    }

    // 추출 순서(trigger ORDER BY — 신규가입=created_at DESC 등) 유지 = array_position
    const sql = `
      SELECT name, grade, gender, age, birth_date, email, region, address,
             store_name, registered_store, points, recent_purchase_date, recent_purchase_amount,
             recent_purchase_store, total_purchase_amount, purchase_count, avg_order_value,
             ltv_score, wedding_anniversary
      FROM customers
      WHERE company_id = $1::uuid
        AND id = ANY($2::uuid[])
        AND is_active = true
        AND sms_opt_in = true
        ${storeFilter}
      ORDER BY array_position($2::uuid[], id)
      LIMIT 1
    `;

    const r = await query(sql, allParams);
    const row = r.rows[0] || null;
    if (!row) {
      return res.json({ success: true, sampleCustomer: null });
    }
    // ANALYZED_FIELDS (CT-58) percentVar 매트릭스 정합 — mergeAndHighlightVars 영역 key 정합.
    const sampleCustomer: Record<string, string | number | null> = {
      '고객명':       row.name || null,
      '등급':         row.grade || null,
      '성별':         row.gender || null,
      '나이':         row.age || null,
      '생일':         row.birth_date ? new Date(row.birth_date).toLocaleDateString('ko-KR') : null,
      '이메일':       row.email || null,
      '지역':         row.region || null,
      '주소':         row.address || null,
      '등록매장':     row.store_name || null,
      '가입매장':     row.registered_store || null,
      '포인트':       row.points != null ? Number(row.points).toLocaleString() : null,
      '최근구매일':   row.recent_purchase_date ? new Date(row.recent_purchase_date).toLocaleDateString('ko-KR') : null,
      '최근구매액':   row.recent_purchase_amount != null ? Number(row.recent_purchase_amount).toLocaleString() : null,
      '최근구매매장': row.recent_purchase_store || null,
      '누적구매액':   row.total_purchase_amount != null ? Number(row.total_purchase_amount).toLocaleString() : null,
      '구매횟수':     row.purchase_count != null ? Number(row.purchase_count).toLocaleString() : null,
      '평균주문액':   row.avg_order_value != null ? Number(row.avg_order_value).toLocaleString() : null,
      'LTV점수':      row.ltv_score != null ? Number(row.ltv_score).toLocaleString() : null,
      '결혼기념일':   row.wedding_anniversary ? new Date(row.wedding_anniversary).toLocaleDateString('ko-KR') : null,
    };
    // ★ D210+ Phase 2-fix9 (Harold 명시 2026-05-23): Liquid 렌더링 영역 (field 키 매트릭스) — renderLiquid 호출 시 customer.X 매칭.
    //   본질 = {% if customer.churn_risk > 0.6 %} 등 Liquid 태그 영역 = 미리보기 영역에서도 사용자별 분기 렌더링 의무.
    //   사고 차단 = mergeAndHighlightVars 영역 안 Liquid 태그 그대로 표시 사고 영역 차단.
    //   Predictive 영역 = 0.5 중립 fallback (옛 cdp_customer_predictions 영역 미참조 시).
    const sampleCustomerFields: Record<string, any> = {
      name: row.name || null,
      grade: row.grade || null,
      gender: row.gender || null,
      age: row.age || null,
      birth_date: row.birth_date || null,
      email: row.email || null,
      region: row.region || null,
      address: row.address || null,
      store_name: row.store_name || null,
      registered_store: row.registered_store || null,
      points: row.points != null ? Number(row.points) : null,
      recent_purchase_date: row.recent_purchase_date || null,
      recent_purchase_amount: row.recent_purchase_amount != null ? Number(row.recent_purchase_amount) : null,
      recent_purchase_store: row.recent_purchase_store || null,
      total_purchase_amount: row.total_purchase_amount != null ? Number(row.total_purchase_amount) : null,
      purchase_count: row.purchase_count != null ? Number(row.purchase_count) : null,
      avg_order_value: row.avg_order_value != null ? Number(row.avg_order_value) : null,
      ltv_score: row.ltv_score != null ? Number(row.ltv_score) : null,
      wedding_anniversary: row.wedding_anniversary || null,
      // Predictive 점수 = 중립 0.5 fallback (실제 발송 시 cdp_customer_predictions 영역 정합)
      churn_risk: 0.5,
      purchase_likelihood: 0.5,
      click_score: 0.5,
    };
    return res.json({ success: true, sampleCustomer, sampleCustomerFields });
  } catch (err: any) {
    console.error('[AI Operator /sample-customer] 오류:', err);
    return res.status(500).json({ success: false, error: '샘플 고객 조회 실패' });
  }
});

// ============================================================
// ★ D164 (2026-05-19) Braze급 SaaS Step 0 — AI Operator 통합 제안서
// ★ D170 (2026-05-19) Multi-Agent Orchestrator로 교체 — services/ai-orchestrator.ts에서 6 Sub-agent 협업
// ★ D178 (2026-05-19) — isAiOperatorAllowed 박음 (ENV AI_OPERATOR_ALLOWED_USERS 박힘 시 본 list만, 박지 X 시 ENT/BUS)
// ============================================================
router.post('/operator/propose', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;

    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    }

    // ★ CT-17 D163 / D178 박힘 검증 단계 — isAiOperatorAllowed (ENV AI_OPERATOR_ALLOWED_USERS 박힘 시 본 list만, 박지 X 시 기존 ENT/BUS 게이팅)
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({
        success: false,
        error: '본 기능은 엔터프라이즈 베타 운영 중입니다.',
        code: 'BETA_GATE',
      });
    }

    const { objective } = req.body;
    if (!objective || typeof objective !== 'string' || objective.trim().length < 5) {
      return res.status(400).json({ success: false, error: '마케팅 목표를 한 줄로 입력해주세요 (5자 이상).' });
    }

    // 회사 정보 + 통계 조회 (Orchestrator에 전달)
    const companyResult = await query(
      `SELECT company_name, business_type, COALESCE(reject_number, opt_out_080_number) as reject_number,
              brand_name, brand_slogan, brand_description, brand_tone, customer_schema,
              cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao
       FROM companies WHERE id = $1::uuid`,
      [companyId]
    );
    const companyInfo: any = companyResult.rows[0] || {};
    companyInfo.name = companyInfo.company_name;

    // ★ D102: getOpt080Number 컨트롤타워 사용
    const userOpt080 = await getOpt080Number(userId || null, companyId);
    if (userOpt080) companyInfo.reject_number = userOpt080;

    // 카카오 프로필 여부 (recommendTarget 채널 추천 hint)
    const kakaoProfileResult = await query(
      'SELECT COUNT(*) FROM kakao_sender_profiles WHERE company_id = $1 AND is_active = true',
      [companyId]
    );
    companyInfo.has_kakao_profile = parseInt(kakaoProfileResult.rows[0].count) > 0;

    // 고객 통계
    const statsResult = await query(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE sms_opt_in = true) as sms_opt_in_count,
         COUNT(*) FILTER (WHERE gender = 'M') as male_count,
         COUNT(*) FILTER (WHERE gender = 'F') as female_count,
         AVG((custom_fields->>'purchase_count')::numeric) as avg_purchase_count,
         AVG((custom_fields->>'total_spent')::numeric) as avg_total_spent
       FROM customers WHERE company_id = $1 AND is_active = true`,
      [companyId]
    );
    const customerStats = statsResult.rows[0];

    // ★ D170: Multi-Agent Orchestrator 호출 — 6 Sub-agent (Target/Verify/Message/Compliance/Cost-ROI) 통합
    // ★ D171-D (2026-05-19): env flag AI_OPERATOR_USE_AI_DECISION=true 시 진정 Orchestrator AI (Opus 4.7 Tool Use) 진입
    //   default false (기존 orchestrate 순차 호출). 실패 시 자동 fallback to orchestrate().
    // ★ D190 #2 (2026-05-22): 회사별 토글 우선 (companies.use_ai_orchestrator) + env flag fallback.
    //   ENT 1사 한정 활성 → 단계적 확장 (1사 → 5사 → ENT 전체 → default true).
    const companyOrchestratorRes = await query(
      `SELECT use_ai_orchestrator FROM companies WHERE id = $1::uuid`,
      [companyId]
    );
    const companyUseAI = companyOrchestratorRes.rows[0]?.use_ai_orchestrator === true;
    const envUseAI = process.env.AI_OPERATOR_USE_AI_DECISION === 'true';
    const useAIDecision = companyUseAI || envUseAI;
    const orchestratorFn = useAIDecision ? orchestrateWithAI : orchestrate;
    // 한줄 입력(propose) = 문안·분석 5. 풀분석(300)은 성과 리포트 전용으로 분리.
    const result = await orchestratorFn({
      companyId,
      userId: userId || null,
      objective: objective.trim(),
      companyInfo,
      customerStats,
    }, { source: 'ai-operator-propose', cost: 5 });

    return res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[AI Operator] propose 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'AI Operator 제안서 생성 실패' });
  }
});

// ============================================================
// ★ D166 (2026-05-19) Braze급 SaaS Step 0 — AI Operator 발송 수신자 조회
// AI 추천 filters → customers 조회 → frontend가 /direct-send에 recipients 전달
// 2-step 분리 = 검증된 /direct-send 흐름 재사용 (라인그룹/중복제거/회신번호/MMS 가드 자동)
// ============================================================
router.post('/operator/preview-recipients', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    }

    // ★ CT-17 D163 / D178 박힘 검증 단계 — isAiOperatorAllowed
    const ctx = await loadPlanContext(companyId);
    if (!ctx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(ctx, req.user)) {
      return res.status(403).json({ success: false, error: '본 기능은 엔터프라이즈 베타 운영 중입니다.', code: 'BETA_GATE' });
    }

    const { filters } = req.body;
    if (!filters || typeof filters !== 'object') {
      return res.status(400).json({ success: false, error: 'filters가 필요합니다.' });
    }

    // ★ B16-01: 브랜드 격리 — store-scope 컨트롤타워 (ai.ts /recommend-target 미러)
    let storeFilter = '';
    const baseParams: any[] = [companyId];
    if (userType === 'company_user' && userId) {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'filtered') {
        storeFilter = ' AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($2::text[]))';
        baseParams.push(scope.storeCodes);
      } else if (scope.type === 'blocked') {
        return res.json({ success: true, recipients: [], total: 0, defaultCallback: null });
      }
    }

    // ★ CT-01 + 공통 안전필터(buildJourneySafetyFilter) — is_opt_out·is_invalid·수신거부(회사+전화) 통일.
    const { sql: filterWhere, params: filterParams } = buildFilterWhereClauseCompat(filters, baseParams.length + 1);
    const { sql, params } = buildSendableRecipientsSql(filterWhere, filterParams, baseParams, storeFilter);

    const result = await query(sql, params);

    // recipients 빌드 — /direct-send body 구조 정합 ({phone, name, extra1~3})
    const recipients = result.rows.map((r: any) => {
      const custom = r.custom_fields || {};
      return {
        phone: r.phone,
        name: r.name || '',
        gender: r.gender || '',
        region: r.region || '',
        birth_date: r.birth_date,
        age: r.age,
        grade: r.grade,
        ...custom,
      };
    });

    // 회사 default callback 조회 (frontend가 별 호출 X)
    const cbResult = await query(
      `SELECT REPLACE(phone, '-', '') AS phone FROM callback_numbers WHERE company_id = $1 AND is_default = true LIMIT 1`,
      [companyId]
    );
    const defaultCallback = cbResult.rows[0]?.phone || null;

    return res.json({
      success: true,
      recipients,
      total: recipients.length,
      defaultCallback,
    });
  } catch (err: any) {
    console.error('[AI Operator] preview-recipients 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '수신자 조회 실패' });
  }
});

// ============================================================
// ★ D174 (2026-05-19) Step 1 — Next Action Advisor (Opus 4.7)
// AI Operator의 "1회성 발송툴 탈출" 진정 가치 박는 영역.
// BUSINESS+ 베타 게이팅 (AI Operator와 동일 정책).
// ============================================================
router.post('/operator/next-action', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });

    // 베타 게이팅 (operator/propose와 동일)
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: '본 기능은 엔터프라이즈 베타 운영 중입니다.', code: 'BETA_GATE' });
    }

    const companyResult = await query(
      `SELECT company_name, business_type, brand_name, brand_tone FROM companies WHERE id = $1::uuid`,
      [companyId]
    );
    const companyInfo = companyResult.rows[0] || {};

    const snapshot = await buildPerformanceSnapshot(companyId);
    const advice = await recommendNextAction(companyId, snapshot, companyInfo);

    return res.json({
      success: true,
      snapshot,
      advice,
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[AI Operator] next-action 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '다음 캠페인 추천 생성 실패' });
  }
});

// ============================================================
// ★ D213+ (2026-05-24) 4번 메뉴 성과리포트 (/performance) 신규 endpoint 8건
//   - GET  /operator/performance/snapshot-v2 (기간 매트릭스 + D144 정합)
//   - POST /operator/performance/explain (Opus 4.7 Explainability)
//   - POST /operator/performance/quick-action (Opus 4.7 1-click 액션)
//   - GET  /operator/performance/campaigns (드릴다운 페이지네이션)
//   - GET  /operator/performance/cohort (가입월별 retention)
//   - GET  /operator/performance/benchmark (요금제별 평균)
//   - GET  /operator/performance/attribution (캠페인 진행 후 반응)
//   - GET  /operator/performance/data-availability (데이터 부족 진단)
// ============================================================

// 1) GET /operator/performance/snapshot-v2?period=7d/14d/30d/90d
router.get('/operator/performance/snapshot-v2', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: '본 기능은 엔터프라이즈 베타 운영 중입니다.', code: 'BETA_GATE' });
    }

    const periodParam = String(req.query.period || '30d');
    const period: PerformancePeriod = (['7d', '14d', '30d', '90d'] as const).includes(periodParam as any)
      ? (periodParam as PerformancePeriod)
      : '30d';

    const snapshot = await buildPerformanceSnapshotV2(companyId, period);
    return res.json({ success: true, snapshot });
  } catch (err: any) {
    console.error('[Performance] snapshot-v2 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '성과 매트릭스 조회 실패' });
  }
});

// POST /api/ai/operator/performance/report-pdf — 기간 성과 종합 PDF 보고서 (풀분석 300 · 회사+기간+날짜 멱등)
//   화면 조회(snapshot-v2)는 무료. 보고서 생성(PDF 다운로드)에만 풀분석 차감. 같은 날 같은 기간 재다운로드는 멱등(무료).
router.post('/operator/performance/report-pdf', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: '본 기능은 엔터프라이즈 베타 운영 중입니다.', code: 'BETA_GATE' });
    }

    const periodParam = String(req.body?.period || '30d');
    const period: PerformancePeriod = (['7d', '14d', '30d', '90d'] as const).includes(periodParam as any)
      ? (periodParam as PerformancePeriod)
      : '30d';

    // 풀분석 300 — 사전 차단(부족 시 402, PDF 스트림 시작 전)
    const cost = getCreditCost('orchestrate');  // 300
    await checkCredit(companyId, cost);

    const snapshot = await buildPerformanceSnapshotV2(companyId, period);
    const companyRow = await query(`SELECT company_name FROM companies WHERE id = $1::uuid`, [companyId]);
    const companyName = companyRow.rows[0]?.company_name || '';

    // 차감 — 회사+기간+날짜 멱등(같은 날 같은 기간 재다운로드는 무료)
    const todayKst = kstDateTag(new Date());
    await deductCreditSafe({
      companyId, cost, source: 'orchestrate', createdBy: userId,
      idempotencyKey: `perf-report:${companyId}:${period}:${todayKst}`,
    });

    // PDF 생성 (billing.ts 패턴 — malgun.ttf 한글 폰트, res 직접 스트림)
    const PDFDocument = require('pdfkit');
    const fs = require('fs');
    const path = require('path');
    const fontPath = path.join(__dirname, '../../fonts/malgun.ttf');
    const fontBoldPath = path.join(__dirname, '../../fonts/malgunbd.ttf');
    const hasFont = fs.existsSync(fontPath);
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="performance_${period}_${todayKst}.pdf"`);
    doc.pipe(res);

    const setFont = (bold = false) => { if (hasFont) doc.font(bold ? fontBoldPath : fontPath); };
    const primary = '#7c3aed';
    const dark = '#1f2937';
    const gray = '#6b7280';
    const won = (v: any) => `${Math.round(Number(v) || 0).toLocaleString()}원`;
    const pctStr = (v: any) => `${((Number(v) || 0) * 100).toFixed(1)}%`;
    const dpct = (m: any) => { const d = Number(m?.diffPct) || 0; return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`; };
    const periodLabel: Record<string, string> = { '7d': '최근 7일', '14d': '최근 14일', '30d': '최근 30일', '90d': '최근 90일' };
    const today = new Date().toISOString().slice(0, 10);

    // 헤더
    setFont(true);
    doc.fontSize(22).fillColor(primary).text('성과 리포트', 50, 50);
    setFont(false);
    doc.fontSize(9).fillColor(gray).text('PERFORMANCE REPORT', 50, 78);
    const rx = 350;
    doc.fontSize(9).fillColor(gray).text('회사:', rx, 50, { continued: true });
    setFont(true); doc.fillColor(dark).text(`  ${companyName || '-'}`);
    setFont(false); doc.fontSize(9).fillColor(gray).text('기간:', rx, 65, { continued: true });
    doc.fillColor(dark).text(`  ${periodLabel[period] || period}`);
    doc.fontSize(9).fillColor(gray).text('발행일:', rx, 80, { continued: true });
    doc.fillColor(dark).text(`  ${today}`);
    doc.moveTo(50, 102).lineTo(545, 102).strokeColor('#e5e7eb').stroke();

    // 요약 6 metric (2열 × 3행)
    let y = 116;
    setFont(true); doc.fontSize(13).fillColor(primary).text('요약', 50, y); y += 20;
    const metrics: Array<[string, string, any]> = [
      ['발송 캠페인', (snapshot.totalCampaigns.current || 0).toLocaleString(), snapshot.totalCampaigns],
      ['총 발송', (snapshot.totalSent.current || 0).toLocaleString(), snapshot.totalSent],
      ['성공률', pctStr(snapshot.successRate.current), snapshot.successRate],
      ['신규 고객', (snapshot.newCustomers.current || 0).toLocaleString(), snapshot.newCustomers],
      ['활성 고객', (snapshot.activeCustomers.current || 0).toLocaleString(), snapshot.activeCustomers],
      ['추정 매출', won(snapshot.estimatedRevenue.current), snapshot.estimatedRevenue],
    ];
    for (let i = 0; i < metrics.length; i++) {
      const col = i % 2;
      const x = 50 + col * 260;
      if (col === 0 && i > 0) y += 46;
      const [label, val, m] = metrics[i];
      const d = Number(m?.diffPct) || 0;
      setFont(false); doc.fillColor(gray).fontSize(9).text(label, x, y);
      setFont(true); doc.fillColor(dark).fontSize(15).text(val, x, y + 11);
      setFont(false); doc.fillColor(d >= 0 ? '#059669' : '#dc2626').fontSize(8).text(`직전 대비 ${dpct(m)}`, x + 120, y + 16);
    }
    y += 60;
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke(); y += 16;

    // 채널별 ROI
    setFont(true); doc.fontSize(13).fillColor(primary).text('채널별 ROI', 50, y); y += 20;
    setFont(true); doc.fontSize(9).fillColor(gray);
    doc.text('채널', 50, y); doc.text('발송', 170, y); doc.text('성공률', 250, y); doc.text('추정 매출', 340, y); doc.text('ROAS', 470, y);
    y += 13; doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke(); y += 6;
    setFont(false); doc.fontSize(9);
    if (snapshot.byChannelROI.length === 0) {
      doc.fillColor(gray).text('데이터 없음', 50, y); y += 16;
    } else {
      for (const c of snapshot.byChannelROI.slice(0, 8)) {
        doc.fillColor(dark).text(c.channel, 50, y);
        doc.text((c.sent || 0).toLocaleString(), 170, y);
        doc.text(pctStr(c.successRate), 250, y);
        doc.text(won(c.estimatedRevenue), 340, y);
        doc.text(`${(Number(c.roas) || 0).toFixed(2)}x`, 470, y);
        y += 16;
      }
    }
    y += 12;

    // 상위 캠페인
    if (snapshot.topCampaigns.length > 0) {
      if (y > 660) { doc.addPage(); y = 50; }
      setFont(true); doc.fontSize(13).fillColor(primary).text('상위 캠페인', 50, y); y += 20;
      setFont(true); doc.fontSize(9).fillColor(gray);
      doc.text('캠페인', 50, y); doc.text('채널', 300, y); doc.text('발송', 360, y); doc.text('성공률', 430, y); doc.text('ROAS', 500, y);
      y += 13; doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke(); y += 6;
      setFont(false); doc.fontSize(9);
      for (const t of snapshot.topCampaigns.slice(0, 5)) {
        doc.fillColor(dark).text((t.name || '-').slice(0, 28), 50, y, { width: 240 });
        doc.text(t.messageType || '-', 300, y);
        doc.text((t.sent || 0).toLocaleString(), 360, y);
        doc.text(pctStr(t.successRate), 430, y);
        doc.text(`${(Number(t.roas) || 0).toFixed(2)}x`, 500, y);
        y += 16;
      }
      y += 12;
    }

    // 요약 진단 (snapshot 수치 기반 — AI 호출 없음)
    if (y > 690) { doc.addPage(); y = 50; }
    const best = [...snapshot.byChannelROI].sort((a, b) => (b.roas || 0) - (a.roas || 0))[0];
    setFont(true); doc.fontSize(12).fillColor(primary).text('요약 진단', 50, y); y += 18;
    setFont(false); doc.fontSize(9).fillColor(dark);
    const lines = [
      `· 기간 추정 매출 ${won(snapshot.estimatedRevenue.current)} (직전 대비 ${dpct(snapshot.estimatedRevenue)})`,
      best ? `· 최고 효율 채널: ${best.channel} (ROAS ${(best.roas || 0).toFixed(2)}x)` : '',
      `· 평균 성공률 ${pctStr(snapshot.successRate.current)} · 활성 고객 ${(snapshot.activeCustomers.current || 0).toLocaleString()}명`,
    ].filter(Boolean);
    for (const ln of lines) { doc.text(ln, 50, y); y += 15; }
    y += 10;

    // Source caption
    setFont(false); doc.fontSize(8).fillColor(gray).text(`Data source — ${snapshot.source} · ${today} 생성`, 50, y);

    doc.end();
    console.log(`[Performance] report-pdf 생성 company=${companyId} period=${period}`);
  } catch (err: any) {
    if (err instanceof InsufficientCreditError) {
      if (!res.headersSent) return res.status(402).json({ success: false, error: '성과 리포트에 필요한 크레딧이 부족합니다. 크레딧을 충전해 주세요.', code: 'INSUFFICIENT_CREDIT' });
    }
    console.error('[Performance] report-pdf 오류:', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: err?.message || 'PDF 보고서 생성 실패' });
    try { res.end(); } catch { /* 이미 종료된 스트림 */ }
  }
});

// 2) POST /operator/performance/explain (Opus 4.7 Explainability)
router.post('/operator/performance/explain', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: '본 기능은 엔터프라이즈 베타 운영 중입니다.', code: 'BETA_GATE' });
    }

    const companyResult = await query(
      `SELECT company_name, business_type, brand_name, brand_tone FROM companies WHERE id = $1::uuid`,
      [companyId]
    );
    const companyInfo = companyResult.rows[0] || {};
    const snapshot = await buildPerformanceSnapshot(companyId);
    const explanation = await explainPerformance(companyId, snapshot, companyInfo);
    return res.json({ success: true, explanation });
  } catch (err: any) {
    console.error('[Performance] explain 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'AI 진단 생성 실패' });
  }
});

// 3) POST /operator/performance/quick-action (Opus 4.7 1-click 액션)
router.post('/operator/performance/quick-action', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: '본 기능은 엔터프라이즈 베타 운영 중입니다.', code: 'BETA_GATE' });
    }

    const actionTypeParam = String(req.body.actionType || '');
    const validActions: QuickActionType[] = ['channel_recovery', 'time_optimization', 'top_performer_replication'];
    if (!validActions.includes(actionTypeParam as QuickActionType)) {
      return res.status(400).json({ success: false, error: '잘못된 actionType' });
    }
    const actionType = actionTypeParam as QuickActionType;

    const companyResult = await query(
      `SELECT company_name, business_type, brand_name, brand_tone FROM companies WHERE id = $1::uuid`,
      [companyId]
    );
    const companyInfo = companyResult.rows[0] || {};
    const snapshot = await buildPerformanceSnapshot(companyId);
    const result = await generateQuickAction(companyId, actionType, snapshot, companyInfo);
    return res.json({ success: true, result });
  } catch (err: any) {
    console.error('[Performance] quick-action 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '1-click 액션 생성 실패' });
  }
});

// 4) GET /operator/performance/campaigns (드릴다운 페이지네이션 + 검색 + 필터 + 정렬)
router.get('/operator/performance/campaigns', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: '본 기능은 엔터프라이즈 베타 운영 중입니다.', code: 'BETA_GATE' });
    }

    const periodParam = String(req.query.period || '30d');
    const periodValid: PerformancePeriod = (['7d', '14d', '30d', '90d'] as const).includes(periodParam as any)
      ? (periodParam as PerformancePeriod)
      : '30d';
    const days = { '7d': 7, '14d': 14, '30d': 30, '90d': 90 }[periodValid];
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.max(1, Math.min(50, parseInt(String(req.query.limit || '10'), 10) || 10));
    const search = String(req.query.search || '').trim();
    const filterChannel = String(req.query.filterChannel || 'all').toLowerCase();
    const filterAd = String(req.query.filterAd || 'all').toLowerCase();
    const sort = String(req.query.sort || 'sent_desc').toLowerCase();

    let where = `c.company_id = $1::uuid AND c.status = 'completed' AND c.sent_at IS NOT NULL AND c.sent_at > NOW() - ($2 || ' days')::interval`;
    const params: any[] = [companyId, days];
    let idx = 3;
    if (search) {
      where += ` AND c.campaign_name ILIKE $${idx}`;
      params.push(`%${search}%`);
      idx++;
    }
    if (filterChannel !== 'all') {
      where += ` AND UPPER(c.message_type) = $${idx}`;
      params.push(filterChannel.toUpperCase());
      idx++;
    }
    if (filterAd === 'ad') where += ` AND c.is_ad = true`;
    else if (filterAd === 'info') where += ` AND c.is_ad = false`;

    const countResult = await query(`SELECT COUNT(*)::int AS cnt FROM campaigns c WHERE ${where}`, params);
    const totalCount = Number(countResult.rows[0]?.cnt) || 0;

    const orderBy =
      sort === 'success_rate_desc' ? `(CASE WHEN c.sent_count > 0 THEN c.success_count::float / c.sent_count ELSE 0 END) DESC` :
      sort === 'sent_at_asc' ? `c.sent_at ASC` :
      sort === 'sent_at_desc' ? `c.sent_at DESC` :
      `c.sent_count DESC NULLS LAST`;
    const offset = (page - 1) * limit;

    const metaResult = await query(
      `SELECT c.id, c.company_id, c.created_by, c.campaign_name, c.message_type, c.is_ad, c.sent_at
         FROM campaigns c
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    const metaRows = metaResult.rows;
    const smsCountMap = await aggregateSmsCountsByCampaign(metaRows as any);
    const kakaoCountMap = await kakaoBatchAggByGroup(metaRows.map((c: any) => c.id));

    const costResult = await query(
      `SELECT cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao FROM companies WHERE id = $1::uuid`,
      [companyId]
    );
    const costRow = costResult.rows[0] || {};
    const costs = {
      sms: Number(costRow.cost_per_sms) || 9,
      lms: Number(costRow.cost_per_lms) || 27,
      mms: Number(costRow.cost_per_mms) || 80,
      kakao: Number(costRow.cost_per_kakao) || 7,
    };

    const campaigns = metaRows.map((c: any) => {
      const sms = smsCountMap.get(c.id) || { total_count: 0, success_count: 0, fail_count: 0 };
      const kakao = kakaoCountMap.get(c.id) || { total: 0, success: 0, fail: 0, pending: 0 };
      const sent = Number(sms.total_count || 0) + kakao.total;
      const success = Number(sms.success_count || 0) + kakao.success;
      const channelRaw = String(c.message_type || 'SMS').toUpperCase();
      const channel =
        channelRaw === 'S' ? 'SMS' :
        channelRaw === 'L' ? 'LMS' :
        channelRaw === 'M' ? 'MMS' :
        channelRaw === 'K' ? 'KAKAO' :
        channelRaw;
      let unitCost = costs.sms;
      if (channel === 'LMS') unitCost = costs.lms;
      else if (channel === 'MMS') unitCost = costs.mms;
      else if (channel === 'KAKAO') unitCost = costs.kakao;
      return {
        id: c.id,
        name: c.campaign_name,
        messageType: channel,
        isAd: Boolean(c.is_ad),
        sent,
        success,
        successRate: sent > 0 ? success / sent : 0,
        cost: success * unitCost,
        sentAt: c.sent_at,
      };
    });

    return res.json({
      success: true,
      campaigns,
      totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit),
      source: 'campaigns + MySQL 큐 직접 집계 (D144 정합)',
    });
  } catch (err: any) {
    console.error('[Performance] campaigns 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '캠페인 드릴다운 조회 실패' });
  }
});

// 5) GET /operator/performance/cohort
router.get('/operator/performance/cohort', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: '본 기능은 엔터프라이즈 베타 운영 중입니다.', code: 'BETA_GATE' });
    }
    const months = Math.max(1, Math.min(24, parseInt(String(req.query.months || '12'), 10) || 12));
    const result = await buildCohortRetention(companyId, months);
    return res.json({ success: true, cohort: result });
  } catch (err: any) {
    console.error('[Performance] cohort 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '코호트 조회 실패' });
  }
});

// 6) GET /operator/performance/benchmark
router.get('/operator/performance/benchmark', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: '본 기능은 엔터프라이즈 베타 운영 중입니다.', code: 'BETA_GATE' });
    }
    const days = Math.max(7, Math.min(90, parseInt(String(req.query.days || '30'), 10) || 30));
    const result = await buildBenchmark(companyId, days);
    return res.json({ success: true, benchmark: result });
  } catch (err: any) {
    console.error('[Performance] benchmark 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '벤치마크 조회 실패' });
  }
});

// 7) GET /operator/performance/attribution
router.get('/operator/performance/attribution', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: '본 기능은 엔터프라이즈 베타 운영 중입니다.', code: 'BETA_GATE' });
    }
    const days = Math.max(7, Math.min(90, parseInt(String(req.query.days || '30'), 10) || 30));
    const result = await buildCampaignAttribution(companyId, days);
    return res.json({ success: true, attribution: result });
  } catch (err: any) {
    console.error('[Performance] attribution 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'attribution 조회 실패' });
  }
});

// 8) GET /operator/performance/data-availability
router.get('/operator/performance/data-availability', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: '본 기능은 엔터프라이즈 베타 운영 중입니다.', code: 'BETA_GATE' });
    }
    const result = await buildDataAvailability(companyId);
    return res.json({ success: true, availability: result });
  } catch (err: any) {
    console.error('[Performance] data-availability 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '데이터 진단 실패' });
  }
});

// ============================================================
// ★ D176 (2026-05-19) Continuous Agentic Operator — 사용자 동의 흐름
//   AI는 매일 회고 + 제안서 박음 / 실행은 항상 사용자 동의 후
//   ENT 자동 실행 옵션 default OFF + 1,000건/5만원/low risk 임계값
// ============================================================

// Operator CRUD
router.post('/operator/continuous', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    if (!companyId || !userId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: 'Continuous Operator 신설은 회사 관리자만 가능합니다.' });
    }

    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: '본 기능은 엔터프라이즈 베타 운영 중입니다.', code: 'BETA_GATE' });
    }

    const { name, objective, schedule, schedule_time } = req.body;
    const operator = await createOperator({
      companyId,
      createdBy: userId,
      name: String(name || '').slice(0, 100),
      objective: String(objective || ''),
      schedule,
      scheduleTime: schedule_time,
    });
    return res.json({ success: true, operator });
  } catch (err: any) {
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ success: false, error: '자동 마케팅 시작에 필요한 크레딧이 부족합니다. 크레딧을 충전해 주세요.', code: 'INSUFFICIENT_CREDIT' });
    }
    console.error('[Operator continuous POST] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Continuous Operator 신설 실패' });
  }
});

router.get('/operator/continuous', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const operators = await listOperators(companyId);
    return res.json({ success: true, operators });
  } catch (err: any) {
    console.error('[Operator continuous GET] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

router.put('/operator/continuous/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '수정은 회사 관리자만 가능합니다.' });
    }
    const {
      name, objective, schedule, schedule_time, status,
      budget_monthly, budget_daily, budget_alert_threshold,
      // ★ D212+ 정책 (2026-05-23 Harold 명시)
      delivery_policy, verification_required_days,
      admin_phone_numbers, backup_admin_phone, admin_alert_channel,
      opt_out_minutes, auto_send_lead_minutes, spam_score_threshold, max_spam_retries,
    } = req.body;
    const operator = await updateOperator(companyId, req.params.id, {
      name, objective, schedule, scheduleTime: schedule_time, status,
      budgetMonthly: budget_monthly === undefined ? undefined : (budget_monthly === null ? null : Number(budget_monthly)),
      budgetDaily: budget_daily === undefined ? undefined : (budget_daily === null ? null : Number(budget_daily)),
      budgetAlertThreshold: budget_alert_threshold !== undefined ? Number(budget_alert_threshold) : undefined,
      // ★ D212+ 정책 (2026-05-23 Harold 명시): 발송 정책 + 검증 + 담당자 영역
      deliveryPolicy: ['daily', 'weekly', 'monthly'].includes(delivery_policy) ? delivery_policy : undefined,
      verificationRequiredDays: verification_required_days !== undefined ? Number(verification_required_days) : undefined,
      adminPhoneNumbers: Array.isArray(admin_phone_numbers) ? admin_phone_numbers.filter((p: any) => typeof p === 'string' && p.trim()) : undefined,
      backupAdminPhone: backup_admin_phone === undefined ? undefined : (backup_admin_phone === null ? null : String(backup_admin_phone)),
      adminAlertChannel: ['sms', 'kakao', 'email'].includes(admin_alert_channel) ? admin_alert_channel : undefined,
      optOutMinutes: opt_out_minutes !== undefined ? Number(opt_out_minutes) : undefined,
      autoSendLeadMinutes: auto_send_lead_minutes !== undefined ? Number(auto_send_lead_minutes) : undefined,
      spamScoreThreshold: spam_score_threshold !== undefined ? Number(spam_score_threshold) : undefined,
      maxSpamRetries: max_spam_retries !== undefined ? Number(max_spam_retries) : undefined,
    });
    if (!operator) return res.status(404).json({ success: false, error: 'Operator를 찾을 수 없습니다.' });
    return res.json({ success: true, operator });
  } catch (err: any) {
    console.error('[Operator continuous PUT] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '수정 실패' });
  }
});

router.delete('/operator/continuous/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '삭제는 회사 관리자만 가능합니다.' });
    }
    const ok = await archiveOperator(companyId, req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: 'Operator를 찾을 수 없습니다.' });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Operator continuous DELETE] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '삭제 실패' });
  }
});

// 수동 제안서 생성 (테스트/즉시 실행)
// ★ D212+ (2026-05-23 Harold 명시): AI 자동 마케팅 학습 영역 요약 endpoint
//   1번 + 2번 + 3번 통합 — ai_company_memory 누적 영역 + variant 자동 영역 + 어제 성과 영역 요약
router.get('/operator/continuous/learning-summary', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });

    // 1. ai_company_memory 영역 누적 영역 + 5 타입 분포
    const memoryRes = await query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE memory_type = 'success_pattern')::int AS success_count,
         COUNT(*) FILTER (WHERE memory_type = 'customer_insight')::int AS insight_count,
         COUNT(*) FILTER (WHERE memory_type = 'brand_tone_evolution')::int AS tone_count,
         COUNT(*) FILTER (WHERE memory_type = 'channel_performance')::int AS channel_count,
         COUNT(*) FILTER (WHERE memory_type = 'compliance_learning')::int AS compliance_count,
         MAX(updated_at) AS last_learned_at,
         AVG(importance) AS avg_importance
       FROM ai_company_memory
       WHERE company_id = $1::uuid`,
      [companyId],
    );
    const mem = memoryRes.rows[0] || {};

    // 2. 옛 30일 영역 안 최고 성과 패턴 5건 (importance 높은 순)
    const topPatternsRes = await query(
      `SELECT memory_type, summary, importance, usage_count, updated_at
       FROM ai_company_memory
       WHERE company_id = $1::uuid AND importance >= 5
       ORDER BY importance DESC, usage_count DESC NULLS LAST
       LIMIT 5`,
      [companyId],
    );

    // 3. 옛 30일 영역 안 자동 마케팅 영역 성과 영역
    const performanceRes = await query(
      `SELECT
         COUNT(*)::int AS total_proposals,
         COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_count,
         COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected_count,
         COUNT(*) FILTER (WHERE auto_executed = true)::int AS auto_executed_count,
         AVG(recipient_count) AS avg_recipients,
         AVG(cost_estimate) AS avg_cost
       FROM operator_proposals
       WHERE company_id = $1::uuid
         AND created_at >= NOW() - INTERVAL '30 days'`,
      [companyId],
    );
    const perf = performanceRes.rows[0] || {};

    // 4. variant 영역 안 옛 winner 영역 — 옛 14일 영역 안 가장 효과 좋은 variant_index
    const variantRes = await query(
      `SELECT
         v.variant_index,
         SUM(v.sent_count)::int AS sent,
         SUM(v.click_count)::int AS clicks,
         CASE WHEN SUM(v.sent_count) > 0 THEN SUM(v.click_count)::float / SUM(v.sent_count) ELSE 0 END AS ctr
       FROM operator_proposal_variants v
       INNER JOIN operator_proposals p ON p.id = v.proposal_id
       WHERE p.company_id = $1::uuid
         AND p.created_at >= NOW() - INTERVAL '14 days'
       GROUP BY v.variant_index
       ORDER BY ctr DESC`,
      [companyId],
    );

    return res.json({
      success: true,
      summary: {
        memory: {
          total: Number(mem.total) || 0,
          successPatterns: Number(mem.success_count) || 0,
          customerInsights: Number(mem.insight_count) || 0,
          brandToneEvolution: Number(mem.tone_count) || 0,
          channelPerformance: Number(mem.channel_count) || 0,
          complianceLearning: Number(mem.compliance_count) || 0,
          lastLearnedAt: mem.last_learned_at,
          avgImportance: Number(mem.avg_importance) || 0,
        },
        topPatterns: topPatternsRes.rows.map((r: any) => ({
          memoryType: r.memory_type,
          summary: r.summary,
          importance: Number(r.importance) || 0,
          usageCount: Number(r.usage_count) || 0,
          updatedAt: r.updated_at,
        })),
        performance: {
          totalProposals30d: Number(perf.total_proposals) || 0,
          approvedCount: Number(perf.approved_count) || 0,
          rejectedCount: Number(perf.rejected_count) || 0,
          autoExecutedCount: Number(perf.auto_executed_count) || 0,
          avgRecipients: Math.round(Number(perf.avg_recipients) || 0),
          avgCost: Math.round(Number(perf.avg_cost) || 0),
        },
        variantWinner: variantRes.rows.length > 0 ? {
          variantLabel: ['A', 'B', 'C'][variantRes.rows[0].variant_index] || 'A',
          ctr: Number(variantRes.rows[0].ctr) || 0,
          sent: Number(variantRes.rows[0].sent) || 0,
          clicks: Number(variantRes.rows[0].clicks) || 0,
        } : null,
      },
    });
  } catch (err: any) {
    console.error('[Continuous learning-summary] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '학습 영역 요약 조회 실패' });
  }
});

router.post('/operator/continuous/:id/run-now', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '수동 실행은 회사 관리자만 가능합니다.' });
    }
    // 권한 검증 — operator가 본 회사 소유인지
    const owner = await query(
      `SELECT id FROM continuous_operators WHERE id = $1::uuid AND company_id = $2::uuid`,
      [req.params.id, companyId]
    );
    if (owner.rows.length === 0) return res.status(404).json({ success: false, error: 'Operator를 찾을 수 없습니다.' });
    const proposal = await generateProposalForOperator(req.params.id);
    if (!proposal) {
      return res.json({ success: true, proposal: null, message: '0건 매칭 또는 생성 실패 — 제안서가 생성되지 않았습니다.' });
    }
    return res.json({ success: true, proposal });
  } catch (err: any) {
    console.error('[Operator run-now] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '제안서 생성 실패' });
  }
});

// Proposals — 사용자 검토/승인/거부
router.get('/operator/proposals', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const status = (req.query.status as string) || 'pending';
    const validStatuses = ['pending', 'approved', 'rejected', 'auto_executed', 'expired', 'scheduled', 'sending', 'sent', 'skipped', 'admin_review', 'admin_stopped', 'all'];
    const proposals = await listProposals(
      companyId,
      validStatuses.includes(status) ? (status as any) : 'pending',
      parseInt(String(req.query.limit || '50')) || 50,
    );
    return res.json({ success: true, proposals });
  } catch (err: any) {
    console.error('[Proposals GET] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

router.post('/operator/proposals/:id/approve', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    if (!companyId || !userId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '승인은 회사 관리자만 가능합니다.' });
    }
    const result = await approveProposal(companyId, req.params.id, userId);
    if (!result.ok) return res.status(400).json({ success: false, error: result.reason });
    // 승인 = 백엔드 즉시 발송(자동 경로와 동일). 크레딧↔발송 원자성.
    const message = result.action === 'sent'
      ? `${result.sentCount ?? 0}명에게 발송했습니다.`
      : (result.reason || '발송 대상이 없어 발송하지 않았습니다.');
    return res.json({ success: true, action: result.action, campaignId: result.campaignId, sentCount: result.sentCount, message });
  } catch (err: any) {
    console.error('[Proposals approve] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '승인 실패' });
  }
});

router.post('/operator/proposals/:id/reject', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    if (!companyId || !userId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '거부는 회사 관리자만 가능합니다.' });
    }
    const ok = await rejectProposal(companyId, req.params.id, userId);
    if (!ok) return res.status(400).json({ success: false, error: 'pending 상태가 아니거나 권한이 없는 제안서입니다.' });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Proposals reject] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '거부 실패' });
  }
});

// ★ D212+ 정책 (2026-05-23 Harold 명시): 담당자 정지 endpoint — AI 학습 통합
//   payload = { reason: 'spam_suspicion' | 'content_correction' | 'no_send' | 'other', detail?: string }
router.post('/operator/proposals/:id/admin-stop', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const { reason, detail } = req.body || {};
    const validReasons = ['spam_suspicion', 'content_correction', 'no_send', 'other'];
    if (!validReasons.includes(reason)) {
      return res.status(400).json({ success: false, error: '정지 사유 영역 의무 (spam_suspicion / content_correction / no_send / other).' });
    }
    const ok = await adminStopProposal(companyId, req.params.id, { reason, detail });
    if (!ok) return res.status(404).json({ success: false, error: '제안 영역 안 찾을 수 없습니다.' });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Proposals admin-stop] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '정지 영역 오류' });
  }
});

// ★ D212+ 정책 (2026-05-23 Harold 명시): 회사 admin 매일 컨펌 endpoint — 검증 영역 안 누적
router.post('/operator/proposals/:id/admin-confirm', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '회사 관리자만 컨펌 가능합니다.' });
    }
    const result = await adminConfirmProposal(companyId, req.params.id);
    if (!result) return res.status(404).json({ success: false, error: '제안 영역 안 찾을 수 없습니다.' });
    return res.json({ success: true, verificationDays: result.verificationDays });
  } catch (err: any) {
    console.error('[Proposals admin-confirm] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '컨펌 영역 오류' });
  }
});

// ============================================================
// ★ D177 (2026-05-19) Self-Optimizing Bandit — variant 추천 + reward 박음
//   사용자 승인 흐름 정합: Bandit은 추천만 박음, 사용자가 발송 박음.
// ============================================================

router.get('/operator/proposals/:id/variants', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    // 권한 검증 — proposal이 본 회사 소유인지
    const owner = await query(
      `SELECT operator_id FROM operator_proposals WHERE id = $1::uuid AND company_id = $2::uuid`,
      [req.params.id, companyId]
    );
    if (owner.rows.length === 0) return res.status(404).json({ success: false, error: '제안서를 찾을 수 없습니다.' });

    const variants = await listVariantsByProposal(req.params.id);
    const operatorId = owner.rows[0].operator_id;
    const recommendation = await recommendVariantForProposal(req.params.id, {
      operatorId,
      useAccumulated: true,
    });
    return res.json({ success: true, variants, recommendation });
  } catch (err: any) {
    console.error('[Proposals variants GET] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

// ============================================================
// ★ D179 (2026-05-19) Multi-Goal Decisioning — 다중 목표 충돌 분석 (Opus 4.7)
//   영구 원칙 정합: AI 단독 실행 X — 분석 결과는 사용자 검토 후 박음
// ============================================================

router.post('/operator/multi-goal/analyze', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });

    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: '본 기능은 엔터프라이즈 베타 운영 중입니다.', code: 'BETA_GATE' });
    }

    const { goals } = req.body;
    if (!Array.isArray(goals) || goals.length === 0) {
      return res.status(400).json({ success: false, error: 'goals 배열은 1건 이상 필요합니다.' });
    }
    if (goals.length > 5) {
      return res.status(400).json({ success: false, error: 'goals는 최대 5건까지 지원합니다.' });
    }

    // 가중치 합 정규화 (0.0~1.0 박지 X 시 자동 정규화)
    const totalWeight = goals.reduce((sum: number, g: any) => sum + (Number(g.weight) || 0), 0);
    const normalizedGoals: OperatorGoal[] = goals.map((g: any) => ({
      name: String(g.name || '').slice(0, 100),
      description: g.description ? String(g.description).slice(0, 500) : undefined,
      weight: totalWeight > 0 ? (Number(g.weight) || 0) / totalWeight : 1.0 / goals.length,
    }));

    // 회사 정보 + 고객 통계
    const companyRes = await query(
      `SELECT company_name, business_type, brand_name, brand_tone FROM companies WHERE id = $1::uuid`,
      [companyId]
    );
    const statsRes = await query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE sms_opt_in = true) AS sms_opt_in_count,
              AVG((custom_fields->>'purchase_count')::numeric) AS avg_purchase_count,
              AVG((custom_fields->>'total_spent')::numeric) AS avg_total_spent
       FROM customers WHERE company_id = $1::uuid AND is_active = true`,
      [companyId]
    );

    const analysis = await analyzeGoalConflicts({
      goals: normalizedGoals,
      companyInfo: companyRes.rows[0] || {},
      customerStats: statsRes.rows[0] || {},
    });

    return res.json({ success: true, analysis });
  } catch (err: any) {
    console.error('[AI Operator multi-goal] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '충돌 분석 실패' });
  }
});

// ============================================================
// ★ D181 (2026-05-19) 회사별 메모리 (Anthropic Memory 패턴) — 회사 admin endpoint
//   영구 원칙 #4 사용자 신뢰 — 회사 admin이 메모리 박은 영역 검토 + 삭제 박을 수 있음
// ============================================================

router.get('/operator/memory', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const memoryType = req.query.type ? (String(req.query.type) as MemoryType) : undefined;
    const limit = Math.min(parseInt(String(req.query.limit || '100')) || 100, 500);
    const memories = await listCompanyMemories(companyId, { memoryType, limit });
    return res.json({ success: true, memories });
  } catch (err: any) {
    console.error('[AI Operator memory GET] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

router.post('/operator/memory', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '메모리 추가는 회사 관리자만 가능합니다.' });
    }
    const { memory_type, memory_key, memory_value, importance, source, metadata } = req.body;
    if (!memory_type || !memory_key || !memory_value) {
      return res.status(400).json({ success: false, error: 'memory_type, memory_key, memory_value는 필수입니다.' });
    }
    const validTypes: MemoryType[] = [
      'success_pattern', 'customer_insight', 'brand_tone_evolution', 'channel_performance', 'compliance_learning',
      'representative_message', 'brand_guideline',  // ★ D225+ Brand Voice Learning
    ];
    if (!validTypes.includes(memory_type)) {
      return res.status(400).json({ success: false, error: `memory_type은 ${validTypes.join('/')} 중 하나여야 합니다.` });
    }
    const entry = await addCompanyMemory({
      companyId,
      memoryType: memory_type,
      memoryKey: String(memory_key),
      memoryValue: String(memory_value),
      importance: importance ? Number(importance) : undefined,
      source: source ? String(source) : 'admin_input',
      metadata: metadata || {},
    });
    return res.json({ success: true, memory: entry });
  } catch (err: any) {
    console.error('[AI Operator memory POST] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '메모리 등록 실패' });
  }
});

router.delete('/operator/memory/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '메모리 삭제는 회사 관리자만 가능합니다.' });
    }
    const ok = await deleteCompanyMemory(companyId, req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: '메모리를 찾을 수 없습니다.' });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[AI Operator memory DELETE] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '삭제 실패' });
  }
});

// ★ D210+ Phase 3 B-7 (2026-05-23 Harold 명시): 자동 갱신 cleanup endpoint (회사 admin 명시 호출 의무)
//   POST /api/ai/operator/memory/cleanup?olderThanDays=90&minImportance=3
//   importance < minImportance + olderThanDays 영역 안 미사용 영역 DELETE
router.post('/operator/memory/cleanup', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '메모리 정리는 회사 관리자만 가능합니다.' });
    }
    const olderThanDays = Math.max(7, Math.min(365, Number(req.body?.olderThanDays) || 90));
    const minImportance = Math.max(1, Math.min(10, Number(req.body?.minImportance) || 3));
    const result = await cleanupDeprecatedMemories(companyId, { olderThanDays, minImportance });
    return res.json({ success: true, ...result, olderThanDays, minImportance });
  } catch (err: any) {
    console.error('[AI Operator memory cleanup] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '메모리 정리 실패' });
  }
});

// ============================================================
// ★ D181 (2026-05-19) Anthropic Batch API — 회사 admin 운영 모니터링 endpoint
//   대량 발송 박은 영역 50% 비용 절감 — Continuous Operator 박은 영역에서 박음
// ============================================================

router.get('/operator/batches', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const limit = Math.min(parseInt(String(req.query.limit || '50')) || 50, 200);
    const batches = await listBatchJobs(companyId, limit);
    return res.json({ success: true, batches });
  } catch (err: any) {
    console.error('[AI Operator batches GET] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

router.post('/operator/batches/:batchId/poll', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    // 권한 검증 — 본 회사 소유 batch
    const owner = await query(
      `SELECT id FROM ai_batch_jobs WHERE batch_id = $1 AND company_id = $2::uuid`,
      [req.params.batchId, companyId]
    );
    if (owner.rows.length === 0) return res.status(404).json({ success: false, error: 'batch를 찾을 수 없습니다.' });
    const job = await pollBatch(req.params.batchId);
    return res.json({ success: true, job });
  } catch (err: any) {
    console.error('[AI Operator batches poll] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'poll 실패' });
  }
});

// ============================================================
// ★ D181 (2026-05-19) Anthropic Citations — AI 응답 근거 박음 (사용자 신뢰)
//   사용자 박은 질문 → 회사 데이터 documents 박음 → Opus 4.7 응답 + citations 박음
//   영구 원칙 #4 사용자 신뢰 — "AI가 박은 근거 박음"
// ============================================================

router.post('/operator/explain', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });

    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: '본 기능은 엔터프라이즈 베타 운영 중입니다.', code: 'BETA_GATE' });
    }

    const { question } = req.body;
    if (!question || typeof question !== 'string' || question.trim().length < 5) {
      return res.status(400).json({ success: false, error: '질문을 입력해주세요 (5자 이상).' });
    }

    const documents = await buildCompanyDocuments(companyId);
    if (documents.length === 0) {
      return res.status(400).json({ success: false, error: '회사 데이터가 부족하여 근거를 제시할 영역이 없습니다. 일부 캠페인을 진행한 후 다시 시도해주세요.' });
    }

    const systemPrompt = `당신은 한줄로AI Operator의 분석 에이전트입니다.
제공된 document에 명시된 사실만 응답 + 출처 근거 명시 (citations 활용).
추측/창작 X — document에 없는 영역은 "정보가 없습니다"로 응답.
한국어 존댓말 (~입니다 / ~합니다).`;

    const answer = await callAIWithCitations({
      model: 'opus',
      system: systemPrompt,
      userMessage: question.trim(),
      documents,
      maxTokens: 1500,
    });

    return res.json({
      success: true,
      text: answer.text,
      citations: answer.citations,
      document_titles: documents.map((d) => d.title),
    });
  } catch (err: any) {
    console.error('[AI Operator explain] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '분석 실패' });
  }
});

router.post('/operator/proposals/:id/variants/:vid/record', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: 'reward 기록은 회사 관리자만 가능합니다.' });
    }
    // 권한 검증
    const owner = await query(
      `SELECT v.id FROM operator_proposal_variants v
       JOIN operator_proposals p ON v.proposal_id = p.id
       WHERE v.id = $1::uuid AND p.id = $2::uuid AND p.company_id = $3::uuid`,
      [req.params.vid, req.params.id, companyId]
    );
    if (owner.rows.length === 0) return res.status(404).json({ success: false, error: 'variant를 찾을 수 없습니다.' });

    const { sent, clicked, converted } = req.body;
    await recordVariantReward({
      variantId: req.params.vid,
      sent: Number(sent || 0),
      clicked: Number(clicked || 0),
      converted: Number(converted || 0),
    });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Proposals variant record] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'reward 기록 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// D187 Journey Builder Lite — 7 표준 여정 (가입/재구매/휴면/장바구니/생일/예약/Custom)
//   영구 룰 정합: AI_OPERATOR_ALLOWED_USERS 게이팅 + BUSINESS+ + 회사 격리
// ════════════════════════════════════════════════════════════════════

// GET /api/ai/operator/journeys — 회사 활성/대기 여정 목록 + 7 템플릿 카탈로그
router.get('/operator/journeys', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }

    const status = (req.query.status as JourneyStatus | 'all') || 'all';
    const journeys = await listJourneys(companyId, status);

    const templates = Object.values(JOURNEY_TEMPLATES).map((t) => ({
      templateCode: t.templateCode,
      name: t.name,
      description: t.description,
      triggerEvent: t.triggerEvent,
      allowReentry: t.allowReentry,
      reentryCooldownDays: t.reentryCooldownDays,
      stepCount: t.steps.length,
      steps: t.steps,
    }));

    return res.json({ success: true, journeys, templates });
  } catch (err: any) {
    console.error('[Journeys list] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '여정 조회 실패' });
  }
});

// POST /api/ai/operator/journeys — 신규 여정 생성 (템플릿 또는 자연어)
router.post('/operator/journeys', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId || !userId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }

    const {
      templateCode,
      name,
      customObjective,
      callbackNumber,
      callbackMode,
      steps,
      thresholdRecipients,
      thresholdCost,
      thresholdRiskLevel,
      budgetMonthly,
      allowReentry,
      reentryCooldownDays,
    } = req.body || {};

    if (!templateCode || !JOURNEY_TEMPLATES[templateCode as JourneyTemplateCode]) {
      return res.status(400).json({ success: false, error: '템플릿 코드가 유효하지 않습니다.' });
    }
    if (!callbackNumber || !String(callbackNumber).trim()) {
      return res.status(400).json({ success: false, error: '회신번호 선택은 필수입니다.' });
    }

    const { journeyId } = await createJourneyFromTemplate({
      companyId,
      createdBy: userId,
      templateCode: templateCode as JourneyTemplateCode,
      name,
      customObjective,
      callbackNumber: String(callbackNumber),
      callbackMode: callbackMode === 'store' ? 'store' : 'fixed',
      steps: Array.isArray(steps) ? steps : undefined,
      thresholdRecipients: thresholdRecipients ?? null,
      thresholdCost: thresholdCost ?? null,
      thresholdRiskLevel: thresholdRiskLevel || 'low',
      budgetMonthly: budgetMonthly ?? null,
      allowReentry,
      reentryCooldownDays,
    });

    const detail = await getJourneyDetail(companyId, journeyId);
    return res.status(201).json({ success: true, journeyId, detail });
  } catch (err: any) {
    console.error('[Journeys create] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '여정 생성 실패' });
  }
});

// GET /api/ai/operator/journeys/:id — 상세 (steps + 통계)
router.get('/operator/journeys/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }

    const detail = await getJourneyDetail(companyId, req.params.id);
    if (!detail) return res.status(404).json({ success: false, error: '여정을 찾을 수 없습니다.' });
    return res.json({ success: true, ...detail });
  } catch (err: any) {
    console.error('[Journeys detail] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '여정 상세 조회 실패' });
  }
});

// POST /api/ai/operator/journeys/:id/activate — 활성화
router.post('/operator/journeys/:id/activate', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId || !userId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }

    // ★ 크레딧: 최초 활성화(draft→active)만 '여정 설계' 150 차감. paused→active 재개는 0(돌려보기 생성은 호출당 3 별도).
    //   멱등키=journey-activate:${journeyId} 고정 → 재개·재시도·동시요청 중복 차감 0(ai_call_log_id FK 무관).
    let stRow;
    try {
      stRow = await query(
        `SELECT status, last_pretest_passed_at FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`,
        [req.params.id, companyId]
      );
    } catch (colErr: any) {
      // ★ Fix #4 + db_alter_safety_net: 컬럼 미존재(미마이그레이션) = 503 + 운영자 안내(500 노출 X).
      const cm = colErr?.message || '';
      if (cm.includes('column') && cm.includes('does not exist')) {
        return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — 운영자에게 journeys.last_pretest_passed_at ALTER 실행 요청 의무', code: 'DB_MIGRATION_PENDING' });
      }
      throw colErr;
    }
    if (stRow.rows.length === 0) return res.status(404).json({ success: false, error: '여정을 찾을 수 없습니다.' });
    // ★ Fix #4 (2026-06-05): 발송 전 문안 검증(스팸필터+형식) 통과 마커 필수 — 프론트 우회로 미검증 활성화 차단.
    //   step/변이 편집 시 마커는 NULL로 무효화되므로, 편집 후엔 재검증해야 활성화된다.
    if (!stRow.rows[0].last_pretest_passed_at) {
      return res.status(400).json({ success: false, error: '발송 전 문안 검증을 먼저 통과해 주세요. 미리보기에서 검증 후 활성화할 수 있습니다.', code: 'PRETEST_REQUIRED' });
    }
    const firstActivation = stRow.rows[0].status === 'draft';
    if (firstActivation) await checkCredit(companyId, getCreditCost('journey-activate'));

    const result = await activateJourney(companyId, req.params.id, userId);
    if (!result.ok) return res.status(400).json({ success: false, error: result.reason || '활성화 실패' });

    if (firstActivation) {
      await deductCreditSafe({
        companyId,
        cost: getCreditCost('journey-activate'),
        source: 'journey-activate',
        createdBy: userId,
        idempotencyKey: `journey-activate:${req.params.id}`,
      });
    }
    return res.json({ success: true });
  } catch (err: any) {
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ success: false, error: '여정 저장에 필요한 크레딧이 부족합니다. 크레딧을 충전해 주세요.', code: 'INSUFFICIENT_CREDIT' });
    }
    console.error('[Journeys activate] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '활성화 실패' });
  }
});

// PATCH /api/ai/operator/journeys/:id/steps/:stepId — step 본문 갱신 (활성화 전 회사 admin 편집)
router.patch('/operator/journeys/:id/steps/:stepId', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    // ★ D188 Phase 2-B-1+2 (2026-05-21): stepType + conditionJsonb + 알림톡 + MMS 영역 patch 확장.
    // ★ D218+ (2026-05-26): notifyManagerOnPretest 추가 — step별 담당자 알림 ON/OFF/default 3 상태
    const {
      messageTemplate, subject, channel, delayHours, isAd,
      stepType, conditionJsonb,
      alimtalkProfileId, alimtalkTemplateCode, alimtalkVariableMap,
      alimtalkNextType, alimtalkNextContents, alimtalkNextSubject,
      mmsImagePaths,
      notifyManagerOnPretest,
    } = req.body || {};
    const ok = await updateJourneyStep(companyId, req.params.id, req.params.stepId, {
      messageTemplate,
      subject,
      channel,
      delayHours: delayHours != null ? Number(delayHours) : undefined,
      isAd,
      stepType,
      conditionJsonb,
      alimtalkProfileId,
      alimtalkTemplateCode,
      alimtalkVariableMap,
      alimtalkNextType,
      alimtalkNextContents,
      alimtalkNextSubject,
      mmsImagePaths,
      notifyManagerOnPretest,
    });
    if (!ok) return res.status(404).json({ success: false, error: 'step을 찾을 수 없거나 수정 권한이 없습니다.' });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Journeys update step] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'step 수정 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// ★ D188 Phase 2-B-3 (2026-05-21): journey_step_variants A/B + Bandit endpoint
// ════════════════════════════════════════════════════════════════════

// GET /api/ai/operator/journeys/:journeyId/steps/:stepId/variants — variants 조회
router.get('/operator/journeys/:journeyId/steps/:stepId/variants', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    // 회사 격리 검증 — journey가 해당 회사 소유인지 확인
    const j = await query(`SELECT 1 FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`, [req.params.journeyId, companyId]);
    if (j.rows.length === 0) return res.status(404).json({ success: false, error: '여정을 찾을 수 없습니다.' });
    const variants = await listJourneyStepVariants(req.params.stepId);
    // ★ D210+ Phase 3 (2026-05-23 Harold 명시): winner 자동 선언 매트릭스 응답 통합 (회사 admin 안내 영역만 — 자동 적용 X)
    const winnerDeclaration = declareVariantWinner(variants);
    // ★ D211+ Phase 1 (2026-05-23 Harold 명시): Beta-Bernoulli 95% 신뢰 구간 응답 통합 — 회사 admin 입장 winner 자동 선언 신뢰 본질
    const variantsCI = computeVariantsCI(variants);
    return res.json({ success: true, variants, winnerDeclaration, variantsCI });
  } catch (err: any) {
    console.error('[Journeys variants list] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'variants 조회 실패' });
  }
});

// POST /api/ai/operator/journeys/:journeyId/steps/:stepId/variants — variant 신규/UPSERT
router.post('/operator/journeys/:journeyId/steps/:stepId/variants', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    // 회사 격리 + 활성 여정 차단 (active 시 variant 신규 X)
    const j = await query(`SELECT status FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`, [req.params.journeyId, companyId]);
    if (j.rows.length === 0) return res.status(404).json({ success: false, error: '여정을 찾을 수 없습니다.' });
    if (j.rows[0].status === 'active') {
      return res.status(409).json({ success: false, error: '활성 여정의 variant는 수정 X. 먼저 일시정지해주세요.' });
    }
    const { variantId, messageTemplate, subject, channel, alimtalkTemplateCode, alimtalkVariableMap, trafficWeight } = req.body || {};
    if (!variantId || typeof variantId !== 'string' || !variantId.trim()) {
      return res.status(400).json({ success: false, error: 'variantId 필수 (예: A/B/C).' });
    }
    const id = await createJourneyStepVariant({
      stepId: req.params.stepId,
      variantId: variantId.trim(),
      messageTemplate,
      subject,
      channel,
      alimtalkTemplateCode,
      alimtalkVariableMap,
      trafficWeight: trafficWeight != null ? Number(trafficWeight) : undefined,
    });
    return res.json({ success: true, id });
  } catch (err: any) {
    console.error('[Journeys variants create] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'variant 신규 실패' });
  }
});

// DELETE /api/ai/operator/journeys/variants/:variantId — variant 삭제
router.delete('/operator/journeys/variants/:variantId', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    // 회사 격리 — variant → step → journey 추적
    const own = await query(
      `SELECT 1 FROM journey_step_variants v
       JOIN journey_steps s ON v.step_id = s.id
       JOIN journeys j ON s.journey_id = j.id
       WHERE v.id = $1::uuid AND j.company_id = $2::uuid AND j.status != 'active'`,
      [req.params.variantId, companyId]
    );
    if (own.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'variant를 찾을 수 없거나 활성 여정 (먼저 일시정지).' });
    }
    const ok = await deleteJourneyStepVariant(req.params.variantId);
    return res.json({ success: ok });
  } catch (err: any) {
    console.error('[Journeys variants delete] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'variant 삭제 실패' });
  }
});

// POST /api/ai/operator/journeys/variants/:variantId/track — click/conversion 트래킹 (외부 webhook 또는 SDK 호출)
router.post('/operator/journeys/variants/:variantId/track', async (req: Request, res: Response) => {
  try {
    // ★ 본 endpoint는 외부 트래킹 영역 — 회사 격리만 가볍게 (variant → journey company_id 확인).
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const own = await query(
      `SELECT 1 FROM journey_step_variants v
       JOIN journey_steps s ON v.step_id = s.id
       JOIN journeys j ON s.journey_id = j.id
       WHERE v.id = $1::uuid AND j.company_id = $2::uuid`,
      [req.params.variantId, companyId]
    );
    if (own.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'variant를 찾을 수 없습니다.' });
    }
    const { clicked, converted } = req.body || {};
    const clickedN = Math.max(0, Math.min(1, Number(clicked) || 0));
    const convertedN = Math.max(0, Math.min(1, Number(converted) || 0));
    await recordJourneyStepVariantReward(req.params.variantId, 0, clickedN, convertedN);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Journeys variants track] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'track 실패' });
  }
});

// PATCH /api/ai/operator/journeys/:id/callback — 회신번호 갱신
router.patch('/operator/journeys/:id/callback', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const { callbackNumber } = req.body || {};
    if (!callbackNumber || !String(callbackNumber).trim()) {
      return res.status(400).json({ success: false, error: '회신번호는 필수입니다.' });
    }
    const ok = await updateJourneyCallback(companyId, req.params.id, String(callbackNumber));
    if (!ok) return res.status(404).json({ success: false, error: '여정을 찾을 수 없거나 활성 상태입니다 (먼저 일시정지).' });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Journeys update callback] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '회신번호 수정 실패' });
  }
});

// ★ D210+ Phase 3 (2026-05-23 Harold 명시): 다중 시뮬레이션 endpoint — Liquid 분기 영역 사전 검증
//    GET /api/ai/operator/journeys/:id/preview-samples
//    회사 안 customer 영역 6 영역 자동 추출:
//      - VIP / Gold / Silver / 신규 (등급 영역 4)
//      - churn_risk > 0.7 (이탈 위험 영역 1)
//      - purchase_likelihood > 0.6 (구매 가능성 영역 1)
//    영구 룰 정합 — 회사 격리 + 실제 DB source (cdp_customer_predictions 영역 정합)
router.get('/operator/journeys/:id/preview-samples', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }

    // 여정 trigger 조회 + 회사 격리
    const jr = await query(
      `SELECT trigger_event, trigger_filters FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`,
      [req.params.id, companyId]
    );
    if (jr.rows.length === 0) return res.status(404).json({ success: false, error: '여정을 찾을 수 없습니다.' });

    // 여정 trigger 기준 미리보기 샘플 10명 + 전체 매칭 수 (발송과 동일 추출 함수). 0명이면 빈 결과 (자동완화 X).
    const triggerEvent = String(jr.rows[0].trigger_event || '');
    const triggerFilters = jr.rows[0].trigger_filters || {};
    const samples = await buildJourneyPreviewSamples(companyId, triggerEvent, triggerFilters, 10, req.params.id);
    const count = await countJourneyTargetCustomers(companyId, triggerEvent, triggerFilters, req.params.id);

    return res.json({ success: true, samples, total: count.total, segments: count.segments, capped: count.capped });
  } catch (err: any) {
    console.error('[Journeys preview-samples] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '미리보기 샘플 조회 실패' });
  }
});

// review 단계(저장 전) 미리보기 샘플 — triggerEvent/triggerFilters로 직접 추출 (preview-samples와 동일 빌더).
router.post('/operator/preview-target-samples', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }

    const { triggerEvent, triggerFilters } = req.body || {};
    if (!triggerEvent || typeof triggerEvent !== 'string') {
      return res.json({ success: true, samples: [], total: 0, segments: [], capped: false });
    }

    const samples = await buildJourneyPreviewSamples(companyId, triggerEvent, triggerFilters || {}, 10);
    const count = await countJourneyTargetCustomers(companyId, triggerEvent, triggerFilters || {});
    return res.json({ success: true, samples, total: count.total, segments: count.segments, capped: count.capped });
  } catch (err: any) {
    console.error('[Journeys preview-target-samples] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '미리보기 샘플 조회 실패' });
  }
});

// ★ D210+ Phase 3 (2026-05-23 Harold 명시): 자동 재진입 토글 endpoint (회사 admin 명시 활성)
//    PATCH /api/ai/operator/journeys/:id/auto-reentry — auto_reentry_enabled 토글 (default OFF)
//    영구 룰 정합: feedback_no_target_auto_relax — 사용자 승인하 자동화 본질
router.patch('/operator/journeys/:id/auto-reentry', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const enabled = !!req.body?.enabled;
    const r = await query(
      `UPDATE journeys SET auto_reentry_enabled = $3, updated_at = NOW()
       WHERE id = $1::uuid AND company_id = $2::uuid
       RETURNING id, auto_reentry_enabled, allow_reentry, reentry_cooldown_days`,
      [req.params.id, companyId, enabled]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ success: false, error: '여정을 찾을 수 없습니다.' });
    }
    return res.json({
      success: true,
      autoReentryEnabled: r.rows[0].auto_reentry_enabled,
      allowReentry: r.rows[0].allow_reentry,
      reentryCooldownDays: r.rows[0].reentry_cooldown_days,
    });
  } catch (err: any) {
    console.error('[Journeys auto-reentry] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '자동 재진입 토글 실패' });
  }
});

// PATCH /api/ai/operator/journeys/:id/options — 여정별 운영 옵션 편집 (Phase 9)
//   트리거 타이밍·포인트 + 임계·예산·재진입·회신을 한 번에. draft/paused만(운영 중 차단).
//   부분 갱신: req.body에 있는 키만 UPDATE(미전달 옵션을 기본값으로 덮어쓰지 않음).
//   값은 normalizeJourneyOptions로 안전 범위 클램프. 컬럼명은 코드 고정(주입 무관, 전부 information_schema 확인).
router.patch('/operator/journeys/:id/options', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }

    const cur = await query(
      `SELECT status, trigger_filters FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`,
      [req.params.id, companyId]
    );
    if (cur.rows.length === 0) return res.status(404).json({ success: false, error: '여정을 찾을 수 없습니다.' });
    if (cur.rows[0].status !== 'draft' && cur.rows[0].status !== 'paused') {
      return res.status(400).json({ success: false, error: '운영 중인 여정은 옵션을 바꿀 수 없습니다. 먼저 일시정지해 주세요.' });
    }

    const body = req.body || {};
    const norm = normalizeJourneyOptions(body);

    const params: any[] = [req.params.id, companyId];
    const sets: string[] = [];
    const add = (col: string, val: any) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    // trigger_filters는 기존 jsonb에 병합(customer_conditions/logic 등 보존, 정규화된 키만 덮어씀).
    params.push(JSON.stringify({ ...(cur.rows[0].trigger_filters || {}), ...norm.triggerFilters }));
    sets.push(`trigger_filters = $${params.length}::jsonb`);

    // 옵션 컬럼 — body에 실제로 온 키만(부분 갱신 안전).
    if ('thresholdRecipients' in body) add('threshold_recipients_per_step', norm.options.thresholdRecipients);
    if ('thresholdCost' in body) add('threshold_cost_per_step', norm.options.thresholdCost);
    if ('thresholdRiskLevel' in body) add('threshold_risk_level', norm.options.thresholdRiskLevel);
    if ('budgetMonthly' in body) add('budget_monthly', norm.options.budgetMonthly);
    if ('allowReentry' in body) add('allow_reentry', norm.options.allowReentry);
    if ('reentryCooldownDays' in body) add('reentry_cooldown_days', norm.options.reentryCooldownDays);
    if ('autoReentryEnabled' in body) add('auto_reentry_enabled', norm.options.autoReentryEnabled);
    if ('callbackNumber' in body && norm.options.callbackNumber) add('callback_number', norm.options.callbackNumber);
    if ('callbackMode' in body) add('callback_mode', norm.options.callbackMode);

    sets.push('updated_at = NOW()');

    const r = await query(
      `UPDATE journeys SET ${sets.join(', ')} WHERE id = $1::uuid AND company_id = $2::uuid RETURNING id`,
      params
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, error: '여정을 찾을 수 없습니다.' });
    return res.json({ success: true });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션이 필요합니다 — 운영자에게 journeys 옵션 컬럼 확인을 요청해 주세요.', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[Journeys update options] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '여정 옵션 수정 실패' });
  }
});

// GET /api/ai/operator/journeys-callback-numbers — 회사 발신번호 합집합 (드롭다운)
router.get('/operator/journeys-callback-numbers', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const r = await query(
      `SELECT DISTINCT phone, source, description, is_default FROM (
         SELECT REPLACE(phone_number, '-', '') AS phone, 'sender' AS source, description, false AS is_default
         FROM sender_numbers
         WHERE company_id = $1::uuid AND is_active = true AND is_verified = true
         UNION
         SELECT REPLACE(phone, '-', '') AS phone, 'callback' AS source, label AS description, is_default
         FROM callback_numbers
         WHERE company_id = $1::uuid
       ) src
       WHERE phone IS NOT NULL AND LENGTH(phone) >= 8
       ORDER BY is_default DESC NULLS LAST, phone ASC`,
      [companyId]
    );
    const opt080 = await getOpt080Number(userId || null, companyId).catch(() => '');
    return res.json({ success: true, numbers: r.rows, opt080Number: opt080 });
  } catch (err: any) {
    console.error('[Journeys callback-numbers] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '회신번호 조회 실패' });
  }
});

// POST /api/ai/operator/journeys-refine-step — AI 문안 다듬기 (3 톤 후보 — 감성/실용/캐주얼)
//   D187-fix3: refineDirectMessage → refineStepMessage (시즌 + 회사 메모리 + 3 톤 다양성)
router.post('/operator/journeys-refine-step', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const { message, channel, isAd, stepIntent } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ success: false, error: '메시지 본문이 비어있습니다.' });
    }
    const ch = ['sms', 'lms', 'mms'].includes(channel) ? channel : 'lms';
    const { candidates } = await refineStepMessage({
      companyId,
      currentMessage: String(message),
      channel: ch,
      isAd: isAd !== false,
      stepIntent: stepIntent ? String(stepIntent) : undefined,
    });
    return res.json({ success: true, candidates });
  } catch (err: any) {
    console.error('[Journeys refine step] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'AI 다듬기 실패' });
  }
});

// POST /api/ai/operator/journeys-ai-generate — One-shot 자연어 → 완전 여정 패키지
//   D187-fix3 핵심: Opus 4.7 + 시즌 + 회사 메모리 + Multi-context → 완전 패키지
router.post('/operator/journeys-ai-generate', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId || !userId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const { objective, templateHint } = req.body || {};
    if ((!objective || !String(objective).trim()) && !templateHint) {
      return res.status(400).json({ success: false, error: '자연어 목표 또는 템플릿 단축 진입 중 하나는 필수입니다.' });
    }
    const pkg = await generateJourneyPackage({
      companyId,
      createdBy: userId,
      objective: objective ? String(objective) : undefined,
      templateHint: templateHint || undefined,
    });
    return res.json({ success: true, package: pkg });
  } catch (err: any) {
    console.error('[Journeys AI generate] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'AI 생성 실패' });
  }
});

// POST /api/ai/operator/journeys/:id/pause — 일시정지
router.post('/operator/journeys/:id/pause', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }

    const reason = String(req.body?.reason || '관리자 일시정지');
    const ok = await pauseJourney(companyId, req.params.id, reason);
    if (!ok) return res.status(404).json({ success: false, error: 'active 상태 여정만 일시정지 가능합니다.' });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Journeys pause] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '일시정지 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// ★ D218+ (2026-05-26): 활성화 검증 + 재활성화 + 정지 이력 조회 endpoint 3건
// ════════════════════════════════════════════════════════════════════

// POST /api/ai/operator/journeys/:id/pretest-validate — 활성화 직전 자동 검증
router.post('/operator/journeys/:id/pretest-validate', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId || !userId) return res.status(403).json({ success: false, error: '회사/사용자 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }

    const result = await validateJourneyForActivation(companyId, req.params.id, userId);
    // ★ Fix #4 (2026-06-05): 검증 통과 시 발송 전 검증 마커 기록 — /activate가 이 마커로 미검증(프론트 우회) 활성화를 차단한다.
    if (result.ok) {
      await query(`UPDATE journeys SET last_pretest_passed_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid`, [req.params.id, companyId]);
    }
    return res.json({ success: true, ...result });
  } catch (err: any) {
    // ★ D214+ db_alter_safety_net 정합 — DB 마이그레이션 미실행 시 503 + 사용자 친화 안내
    const msg = err?.message || '';
    console.error('[Journey pretest-validate] 오류:', err);  // 실제 에러(컬럼명 포함) 항상 로그 — 503 분기가 삼키지 않게
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: '여정 자동 검증을 준비 중입니다. 잠시 후 다시 시도해 주세요.',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    return res.status(500).json({ success: false, error: err?.message || '검증 실패' });
  }
});

// GET /api/ai/operator/journeys/:id/pause-logs — 정지 이력 조회 (admin UI 활용)
router.get('/operator/journeys/:id/pause-logs', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }

    const limit = Number(req.query?.limit) || 50;
    const logs = await getPauseLogs(companyId, req.params.id, limit);
    return res.json({ success: true, logs });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 필요 — journey_step_pause_logs 테이블 생성 요청 의무',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    console.error('[Journey pause-logs] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

// POST /api/ai/operator/journeys/:id/end — 종료
router.post('/operator/journeys/:id/end', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }

    const ok = await endJourney(companyId, req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: '이미 종료된 여정입니다.' });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Journeys end] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '종료 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// ★ D211+ Phase 3 (2026-05-23 Harold 명시): Archive (soft delete) + Hard Delete endpoint 3건
//   - PATCH /operator/journeys/:id/archive — 보관함 이동
//   - PATCH /operator/journeys/:id/unarchive — 보관함 복원
//   - DELETE /operator/journeys/:id — 영구 삭제 (FK CASCADE)
// ════════════════════════════════════════════════════════════════════

// PATCH /api/ai/operator/journeys/:id/archive — 보관함 이동 (soft delete)
router.patch('/operator/journeys/:id/archive', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const ok = await archiveJourney(companyId, req.params.id);
    if (!ok) return res.status(409).json({ success: false, error: '보관 영역 이동 X — 활성 여정 또는 이미 보관함 영역.' });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Journeys archive] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '보관 이동 실패' });
  }
});

// PATCH /api/ai/operator/journeys/:id/unarchive — 보관함 복원
router.patch('/operator/journeys/:id/unarchive', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const ok = await unarchiveJourney(companyId, req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: '보관함 영역 안 찾을 수 없습니다.' });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Journeys unarchive] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '복원 실패' });
  }
});

// DELETE /api/ai/operator/journeys/:id — 영구 삭제 (회사 admin 강력 confirm 후)
router.delete('/operator/journeys/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const result = await deleteJourney(companyId, req.params.id);
    if (!result.ok) return res.status(409).json({ success: false, error: result.reason || '영구 삭제 실패' });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Journeys delete] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '영구 삭제 실패' });
  }
});

// GET /api/ai/operator/journeys/:id/executions — 진입 사용자 리스트 (페이지네이션 + 상태 필터)
// ★ D192 (2026-05-22): CT-51 listJourneyEnteredCustomers 통합 — 회사 격리 + 등급/지역 컬럼 추가
router.get('/operator/journeys/:id/executions', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }

    // ★ D210+ Phase 3 (2026-05-23 Harold 명시): page + search + filter + sort 영역 강화
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '10'), 10) || 10));
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const validStatuses = ['all', 'active', 'completed', 'paused', 'ended', 'failed'];
    const statusRaw = String(req.query.status || 'all');
    const status = validStatuses.includes(statusRaw) ? (statusRaw as any) : 'all';

    const validSorts = ['entered_at_desc', 'entered_at_asc', 'current_step_desc', 'total_cost_desc', 'completed_at_desc'];
    const sortRaw = String(req.query.sort || 'entered_at_desc');
    const sort = validSorts.includes(sortRaw) ? (sortRaw as any) : 'entered_at_desc';

    const result = await listJourneyEnteredCustomers(req.params.id, companyId, { page, limit, search, status, sort });
    return res.json({
      success: true,
      executions: result.rows,
      total: result.total,
      filteredCount: result.filteredCount,
      page: result.page,
      totalPages: result.totalPages,
      limit: result.limit,
    });
  } catch (err: any) {
    console.error('[Journeys executions] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'execution 조회 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// ★ D197 (2026-05-22) Phase B-2 Predictive Suite endpoint 2건
// ════════════════════════════════════════════════════════════════════

// GET /api/ai/operator/predictive/distribution — 회사 예측 점수 분포 + Top 위험 50명 + Top 구매 가능성 50명 + 모델 정확도
router.get('/operator/predictive/distribution', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const distribution = await getCompanyPredictionDistribution(companyId);
    return res.json({ success: true, distribution });
  } catch (err: any) {
    console.error('[Predictive distribution] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '예측 분포 조회 실패' });
  }
});

// GET /api/ai/operator/predictive/settings — 예측 자동 ON/OFF 조회 (연동 회사 매일 자동 분석)
router.get('/operator/predictive/settings', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const r = await query(`SELECT COALESCE(predictive_enabled, true) AS enabled FROM companies WHERE id = $1::uuid`, [companyId]);
    return res.json({ success: true, predictiveEnabled: r.rows[0]?.enabled !== false });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — companies.predictive_enabled 컬럼 추가 요청 의무', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[Predictive settings GET] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '예측 설정 조회 실패' });
  }
});

// PATCH /api/ai/operator/predictive/settings — 예측 자동 ON/OFF 변경 (OFF 시 매일 갱신·차감 0)
router.patch('/operator/predictive/settings', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const enabled = !!req.body?.enabled;
    await query(`UPDATE companies SET predictive_enabled = $2 WHERE id = $1::uuid`, [companyId, enabled]);
    return res.json({ success: true, predictiveEnabled: enabled });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — companies.predictive_enabled 컬럼 추가 요청 의무', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[Predictive settings PATCH] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '예측 설정 변경 실패' });
  }
});

// GET /api/ai/operator/self-diagnosis — AI 자율 진단 + 자동 추천 3건 (회사 admin dashboard 진입 시 호출)
router.get('/operator/self-diagnosis', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const diagnosis = await diagnoseCompanyHealth(companyId);
    return res.json({ success: true, diagnosis });
  } catch (err: any) {
    console.error('[SelfDiagnosis] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '자율 진단 조회 실패' });
  }
});

// GET /api/ai/operator/predictive/summary — 회사 예측 요약 (AI 자율 추천 통합용)
router.get('/operator/predictive/summary', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const summary = await getCompanyPredictionSummary(companyId);
    return res.json({ success: true, summary });
  } catch (err: any) {
    console.error('[Predictive summary] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '예측 요약 조회 실패' });
  }
});

// ★ D210+ Phase 3 (2026-05-23 Harold 명시): 회사 전체 customer 영역 페이지네이션 + 검색 + 필터 + 정렬
//    옛 Top 50명 영역 폐기 → 회사 admin 자유 탐색 본질 정합
//    Query: ?page=1&limit=10&search=홍&filter=high_risk&sort=churn_risk_desc
router.get('/operator/predictive/customers', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }

    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '10'), 10) || 10));
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const validFilters: PredictionFilterType[] = ['all', 'high_risk', 'high_potential', 'high_click', 'high_ltv', 'first_purchase', 'repurchase', 'cold_start'];
    const filterRaw = String(req.query.filter || 'all');
    const filter: PredictionFilterType = (validFilters as string[]).includes(filterRaw)
      ? (filterRaw as PredictionFilterType)
      : 'all';

    const validSorts: PredictionSortType[] = [
      'churn_risk_desc', 'purchase_likelihood_desc', 'click_score_desc', 'ltv_365d_desc',
      'last_activity_asc', 'last_activity_desc',
    ];
    const sortRaw = String(req.query.sort || 'churn_risk_desc');
    const sort: PredictionSortType = (validSorts as string[]).includes(sortRaw)
      ? (sortRaw as PredictionSortType)
      : 'churn_risk_desc';

    const result = await listCompanyPredictionCustomers(companyId, { page, limit, search, filter, sort });
    return res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[Predictive customers] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '예측 고객 조회 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// ★ D211+ Predictive 강화 (2026-05-23 Harold 명시): Explainability + 1-click 액션 prefill endpoint 2건
// ════════════════════════════════════════════════════════════════════

// GET /api/ai/operator/predictive/customers/:id/explain — 단일 customer 영역 예측 안내 (SHAP-like + 자연어)
router.get('/operator/predictive/customers/:id/explain', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const explanation = await explainCustomerPrediction(req.params.id, companyId);
    return res.json({ success: true, explanation });
  } catch (err: any) {
    console.error('[Predictive explain] 오류:', err);
    const isAuthErr = err?.message?.includes('회사 격리');
    return res.status(isAuthErr ? 403 : 500).json({ success: false, error: err?.message || '예측 근거 조회 오류' });
  }
});

// POST /api/ai/operator/predictive/quick-action — 1-click 액션 prefill (회사 admin 명시 AI Operator 진입)
//   payload = { actionType: 'churn_recovery' | 'purchase_push' | 'vip_engagement' }
//   응답 = { objective: 자연어 한 줄, targetFilters: { ... }, suggestedChannel, suggestedTone }
router.post('/operator/predictive/quick-action', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const { actionType } = req.body || {};
    const validTypes = ['churn_recovery', 'purchase_push', 'vip_engagement', 'first_purchase', 'high_engagement', 'repurchase_imminent'];
    if (!validTypes.includes(actionType)) {
      return res.status(400).json({ success: false, error: 'actionType이 올바르지 않습니다.' });
    }

    // 영역별 매칭 customer 카운트 + AI Operator orchestrate 영역 prefill 안내
    let targetCount = 0;
    let objective = '';
    let targetFilters: Record<string, any> = {};
    let suggestedChannel = 'sms';
    let suggestedTone = '감성적';

    if (actionType === 'churn_recovery') {
      const r = await query(
        `SELECT COUNT(*)::int AS cnt FROM cdp_customer_predictions
         WHERE company_id = $1::uuid AND churn_risk > 0.7`,
        [companyId]
      );
      targetCount = Number(r.rows[0]?.cnt) || 0;
      objective = `이탈 위험 70% 이상 고객 ${targetCount.toLocaleString()}명에게 회복 캠페인 — 자주 반응한 채널과 감성적인 메시지로 다시 찾게 만듭니다.`;
      targetFilters = { predictive_churn_risk_min: 0.7 };
      suggestedChannel = 'lms';
      suggestedTone = '감성적';
    } else if (actionType === 'purchase_push') {
      const r = await query(
        `SELECT COUNT(*)::int AS cnt FROM cdp_customer_predictions
         WHERE company_id = $1::uuid AND purchase_likelihood > 0.6`,
        [companyId]
      );
      targetCount = Number(r.rows[0]?.cnt) || 0;
      objective = `구매 가능성 60% 이상 고객 ${targetCount.toLocaleString()}명에게 추천 상품 캠페인 — 다음 구매 예측 시점 직전에 발송하면 효과적입니다.`;
      targetFilters = { predictive_purchase_likelihood_min: 0.6 };
      suggestedChannel = 'sms';
      suggestedTone = '실용적';
    } else if (actionType === 'vip_engagement') {
      // 평균 365일 LTV 영역 × 2 영역 = 고 LTV 영역
      const avgRes = await query(
        `SELECT AVG(ltv_365d) AS avg_ltv FROM cdp_customer_predictions WHERE company_id = $1::uuid`,
        [companyId]
      );
      const avgLtv = Number(avgRes.rows[0]?.avg_ltv) || 0;
      const r = await query(
        `SELECT COUNT(*)::int AS cnt FROM cdp_customer_predictions
         WHERE company_id = $1::uuid AND ltv_365d > $2`,
        [companyId, avgLtv * 2]
      );
      targetCount = Number(r.rows[0]?.cnt) || 0;
      objective = `예측 LTV 상위 고객 ${targetCount.toLocaleString()}명에게 VIP 전용 혜택과 감사 인사 캠페인 — 평균의 두 배가 넘는 핵심 고객층입니다.`;
      targetFilters = { predictive_ltv_365d_min: avgLtv * 2 };
      suggestedChannel = 'kakao';
      suggestedTone = '감성적';
    } else if (actionType === 'first_purchase') {
      const r = await query(
        `SELECT COUNT(*)::int AS cnt FROM cdp_customer_predictions p
         INNER JOIN customers c ON c.id = p.customer_id
         WHERE p.company_id = $1::uuid AND COALESCE(c.purchase_count, 0) = 0`,
        [companyId]
      );
      targetCount = Number(r.rows[0]?.cnt) || 0;
      objective = `아직 첫 구매를 하지 않은 고객 ${targetCount.toLocaleString()}명에게 환영·첫 거래 유도 캠페인 — 부담 없는 첫 메시지로 거래를 트는 데 집중합니다.`;
      targetFilters = { purchase_count_max: 0 };
      suggestedChannel = 'sms';
      suggestedTone = '친근한';
    } else if (actionType === 'high_engagement') {
      const r = await query(
        `SELECT COUNT(*)::int AS cnt FROM cdp_customer_predictions
         WHERE company_id = $1::uuid AND click_score > 0.5`,
        [companyId]
      );
      targetCount = Number(r.rows[0]?.cnt) || 0;
      objective = `메시지에 잘 반응하는 고객 ${targetCount.toLocaleString()}명에게 신상품·이벤트 우선 알림 — 클릭 가능성이 높아 반응을 빠르게 끌어낼 수 있습니다.`;
      targetFilters = { predictive_click_score_min: 0.5 };
      suggestedChannel = 'sms';
      suggestedTone = '활기찬';
    } else if (actionType === 'repurchase_imminent') {
      const r = await query(
        `SELECT COUNT(*)::int AS cnt FROM cdp_customer_predictions
         WHERE company_id = $1::uuid AND next_purchase_days BETWEEN 0 AND 14`,
        [companyId]
      );
      targetCount = Number(r.rows[0]?.cnt) || 0;
      objective = `2주 안에 다시 살 것으로 예측되는 고객 ${targetCount.toLocaleString()}명에게 적시 추천 캠페인 — 구매 직전 타이밍에 추천 상품을 보냅니다.`;
      targetFilters = { predictive_next_purchase_days_max: 14 };
      suggestedChannel = 'sms';
      suggestedTone = '실용적';
    }

    return res.json({
      success: true,
      actionType,
      targetCount,
      objective,
      targetFilters,
      suggestedChannel,
      suggestedTone,
    });
  } catch (err: any) {
    console.error('[Predictive quick-action] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '1-click 액션 처리 오류' });
  }
});

// GET /api/ai/operator/journeys/:id/stats — 완전 통계 (overview + steps + segments + hourly + weekday + variants)
// ★ D192 (2026-05-22): CT-51 buildJourneyStats 통합 — 옛 단순 통계 진화
router.get('/operator/journeys/:id/stats', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }

    const stats = await buildJourneyStats(req.params.id, companyId);
    return res.json({ success: true, stats });
  } catch (err: any) {
    console.error('[Journeys stats] 오류:', err);
    const isAuthErr = err?.message?.includes('회사 격리');
    return res.status(isAuthErr ? 403 : 500).json({ success: false, error: err?.message || '통계 조회 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// ★ D211+ Phase 2 (2026-05-23 Harold 명시): Journey Step Diagnosis endpoint 2건
//   - GET /operator/journeys/:id/step-diagnosis — 여정 단계별 진단 (buildJourneyStats + 분류)
//   - GET /operator/journeys/:id/recommend-next-step — 다음 단계 추천 (Sonnet 4.6)
// ════════════════════════════════════════════════════════════════════

// GET /api/ai/operator/journeys/:id/step-diagnosis — 여정 단계별 진단
router.get('/operator/journeys/:id/step-diagnosis', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const diagnosis = await diagnoseJourneySteps(req.params.id, companyId);
    return res.json({ success: true, diagnosis });
  } catch (err: any) {
    console.error('[Journey step-diagnosis] 오류:', err);
    const isAuthErr = err?.message?.includes('회사 격리');
    return res.status(isAuthErr ? 403 : 500).json({ success: false, error: err?.message || '진단 영역 오류' });
  }
});

// GET /api/ai/operator/journeys/:id/recommend-next-step — 다음 단계 자동 추천
router.get('/operator/journeys/:id/recommend-next-step', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const recommendation = await recommendNextJourneyStep(req.params.id, companyId);
    return res.json({ success: true, recommendation });
  } catch (err: any) {
    console.error('[Journey recommend-next-step] 오류:', err);
    const isAuthErr = err?.message?.includes('회사 격리');
    return res.status(isAuthErr ? 403 : 500).json({ success: false, error: err?.message || '추천 영역 오류' });
  }
});

// ════════════════════════════════════════════════════════════════════
// ★ D211+ Phase A (2026-05-23 Harold 명시): 시뮬레이션 + 실시간 위치 + variant 자동 생성 endpoint 3건
// ════════════════════════════════════════════════════════════════════

// GET /api/ai/operator/journeys/:id/simulate — 활성화 직전 가상 실행 시뮬레이션
router.get('/operator/journeys/:id/simulate', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const simulation = await simulateJourney(req.params.id, companyId);
    return res.json({ success: true, simulation });
  } catch (err: any) {
    console.error('[Journey simulate] 오류:', err);
    const isAuthErr = err?.message?.includes('회사 격리');
    return res.status(isAuthErr ? 403 : 500).json({ success: false, error: err?.message || '시뮬레이션 영역 오류' });
  }
});

// GET /api/ai/operator/journeys/:id/live-positions — 실시간 customer 진행 위치
router.get('/operator/journeys/:id/live-positions', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const snapshot = await getJourneyLiveSnapshot(req.params.id, companyId);
    return res.json({ success: true, snapshot });
  } catch (err: any) {
    console.error('[Journey live-positions] 오류:', err);
    const isAuthErr = err?.message?.includes('회사 격리');
    return res.status(isAuthErr ? 403 : 500).json({ success: false, error: err?.message || '실시간 위치 영역 오류' });
  }
});

// POST /api/ai/operator/journeys/steps/:stepId/variants/auto-generate — AI A/B variant 자동 생성
router.post('/operator/journeys/steps/:stepId/variants/auto-generate', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    // 회사 격리 검증 — step → journey → 회사 영역
    const own = await query(
      `SELECT 1 FROM journey_steps s
       INNER JOIN journeys j ON j.id = s.journey_id
       WHERE s.id = $1::uuid AND j.company_id = $2::uuid`,
      [req.params.stepId, companyId]
    );
    if (own.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'step 영역 찾을 수 없습니다.' });
    }
    const { baseMessage, channel, subject, isAd } = req.body || {};
    if (typeof baseMessage !== 'string' || baseMessage.trim().length < 10) {
      return res.status(400).json({ success: false, error: 'base 메시지 영역 10자 이상 의무.' });
    }
    if (!['sms', 'lms', 'mms', 'kakao'].includes(channel)) {
      return res.status(400).json({ success: false, error: 'channel 영역 sms/lms/mms/kakao 의무.' });
    }
    const result = await generateVariantsFromMessage({
      stepId: req.params.stepId,
      companyId,
      baseMessage: baseMessage.trim(),
      channel,
      subject: typeof subject === 'string' ? subject : null,
      isAd: !!isAd,
    });
    return res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[Journey variants auto-generate] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'variant 자동 생성 영역 오류' });
  }
});

// ════════════════════════════════════════════════════════════════════
// ★ D190 #3 (2026-05-22): 알림톡 자동 템플릿 매칭 + 변수 자동 매핑 endpoint
//   - 캠페인 의도(자연어) → Opus 4.7 매칭 → 정합 1건 추천 + 차선 2~3건 + 변수 자동 매핑
//   - AI 추천만 — 회사 admin 검토 + 승인 후 발송 (영구 원칙 #1)
//   - 정합 0건 시 회사 admin 안내 (자동완화 절대 금지)
// ════════════════════════════════════════════════════════════════════
router.post('/operator/alimtalk/match', authenticate, async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });

    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }

    const { campaignObjective, campaignType } = req.body || {};
    if (!campaignObjective || typeof campaignObjective !== 'string' || campaignObjective.trim().length < 3) {
      return res.status(400).json({ success: false, error: '캠페인 의도(자연어)를 입력해주세요 (3자 이상).' });
    }

    const result = await matchAlimtalkTemplate({
      companyId,
      campaignObjective: campaignObjective.trim(),
      campaignType: typeof campaignType === 'string' ? campaignType : undefined,
    });

    return res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[AI Operator alimtalk match] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '알림톡 매칭 실패' });
  }
});

// ★ D209+ Phase D 비용 안전 매트릭스 — 회사별 AI 사용량 진단 endpoint
//   회사 admin 진입 시 월 사용량 + 한도 + 30일 일별 통계 + cache 통계 반환
router.get('/usage', authenticate, async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(401).json({ success: false, error: '회사 권한이 필요합니다.' });

    // ★ D210+ Phase 3 B-8 (2026-05-23 Harold 명시): 모델별 분포 영역 매트릭스 추가
    const [monthly, daily, breakdown] = await Promise.all([
      getMonthlyUsage(companyId),
      getDailyUsage(companyId, 30),
      getModelBreakdown(companyId, 30),
    ]);
    const cache = getCacheStats();

    // ★ D210+ Phase 3 B-8 (2026-05-23 Harold 명시): cache 비용 절감 영역 계산 (hit rate × 평균 호출 비용)
    const avgCostWon = daily.length > 0
      ? daily.reduce((sum, d) => sum + (d.cost || 0), 0) / Math.max(1, daily.reduce((sum, d) => sum + (d.count || 0), 0))
      : 0;
    const cacheSavingsWon = cache.hit > 0 ? Math.round(cache.hit * avgCostWon) : 0;

    return res.json({
      success: true,
      monthly,
      daily,
      cache,
      breakdown,
      cacheSavingsWon,
    });
  } catch (err: any) {
    console.error('[AI Usage] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '사용량 조회 실패' });
  }
});

export default router;
