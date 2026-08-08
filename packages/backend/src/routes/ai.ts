import { Request, Response, Router } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { checkAPIStatus, extractVarCatalog, filterVarCatalogByData, generateCustomMessages, generateMessages, parseBriefing, recommendTarget, countFilteredCustomers, recommendNextCampaign, refineDirectMessage, callAIWithFallback, suggestSegmentForObjective } from '../services/ai';
import { buildGenderFilter, buildGradeFilter, buildRegionFilter, getGenderVariants, getRegionVariants } from '../utils/normalize';
import { FIELD_MAP, FIELD_DISPLAY_MAP, reverseDisplayValue, getColumnFields, renderFieldValue } from '../utils/standard-field-map';
import { replaceVariables } from '../utils/messageUtils';
import { STANDARD_FIELD_FALLBACKS } from '../utils/var-fallback';
import { selectJourneyTargetCustomerIds } from '../utils/journey-target-extractor';
import { filterByIndividualCallback } from '../utils/callback-filter';
import { isValidCustomFieldKey } from '../utils/safe-field-name';
import { getStoreScope } from '../utils/store-scope';
import { buildFilterWhereClauseCompat } from '../utils/customer-filter';
import { buildSendableRecipientsSql, buildSendableRecipientsTopSql, buildAudienceCountSql, resolveConditionColumns } from '../utils/operator-recipients';
// ★ 2026-07-10 [타겟확인]: 발송 피로도 cap — dispatchProposalSend 준비부와 동일 산출(원칙 2)
import { getFatigueCap } from '../utils/fatigue-guard';
// ★ 2026-08-03 타겟팅 재설계 A-1: 자동마케팅 대상 수·명단은 발송과 같은 게이트를 쓰는 단일 문 경유.
import {
  resolveOperatorAudienceGates, compileOperatorAudience, listSegmentAvailability, resolveOperatorStoreScope,
  assertSegmentUsable,
} from '../utils/operator-audience';
// ★ 2026-08-04 변화 축 — 기준선 유무 판정(화면 첫 회차 안내가 서버 답을 쓴다).
import { segmentNeedsCycleBaseline, normalizeSegmentKey } from '../utils/automarketing-segment';
import { hasCycleBaseline } from '../utils/operator-cycle-snapshot';
import { aggregateCampaignPerformance } from '../utils/stats-aggregation';
import { formatDateValue, getOpt080Number, buildAdMessage, buildAdSubject } from '../utils/messageUtils';
import { resolveJourneyAdFlag } from '../utils/journey-ad-policy';
import { loadPlanContext, canUseFeature, requirePlanFeature, isBetaAccessAllowed, isAiOperatorAllowed } from '../utils/plan-guard';
import { getCompanyCosts } from '../config/defaults';
// ★ D209+ (Harold 명시 2026-05-22) Phase D 비용 안전 매트릭스 — 회사별 월 한도 + cache 통계
import { getMonthlyUsage, getDailyUsage, getModelBreakdown } from '../utils/ai-rate-limit';
import { getCacheStats } from '../utils/ai-cache';
import { orchestrate, orchestrateWithAI } from '../services/ai-orchestrator';
// ★ 크레딧 종량제 — 여정 저장(활성화) 등 endpoint 직접 차감용 (callAIWithFallback 경유 외)
import { checkCredit, deductCreditSafe, InsufficientCreditError } from '../utils/ai-credit';
import { randomUUID } from 'crypto';
import { getCreditCost, kstDateTag, dailyDbAnalysisCredits } from '../utils/ai-credit-calc';
// ★ D174 (2026-05-19): Step 1 Next Action Advisor — Opus 4.7
import { buildPerformanceSnapshot, recommendNextAction, buildPerformanceSnapshotV2, type PerformancePeriod } from '../utils/next-action-advisor';
import { explainPerformance } from '../utils/performance-explainer';
import { generateQuickAction, type QuickActionType } from '../utils/performance-quick-action';
import { buildCohortRetention } from '../utils/performance-cohort';
import { buildBenchmark } from '../utils/performance-benchmark';
import { renderPerformanceReportPdf } from '../utils/performance-pdf-render';
import { buildCampaignAttribution } from '../utils/campaign-response-attribution';
import { buildGradePerformance, buildRecipientAttribution } from '../utils/performance-customer-axis';
import { createJob, getJob } from '../utils/full-analysis-job';
import { stepProgress } from '../utils/full-analysis-steps';
import { runFullAnalysis } from '../utils/full-analysis-runner';
import { buildDataAvailability } from '../utils/performance-data-availability';
// ★ 2026-07-04 스타일 참고(specs/2026-07-04-best-copy-evolution-design.md §4) — 원문의 벽:
//   내 승리 문안(자사 데이터 자사 노출) + 업종 스타일(AI 재창작 예시만, 타사 원문 노출 0)
import { listStyleExamples } from '../utils/best-copy-assets';
import { getTenantRef } from '../utils/training-logger';
import { industryLabel } from '../utils/industry-codes';
import { aggregateSmsCountsByCampaign } from '../utils/stats-aggregation';
// (2026-07-30) 브랜드 SMSQ 합류 — 옛 카카오 IMC 집계 import 폐기
// ★ D176 (2026-05-19): Continuous Agentic Operator (사용자 동의 흐름)
import {
  createOperator,
  listOperators,
  updateOperator,
  archiveOperator,
  adminStopProposal,
  listProposals,
  approveProposal,
  rejectProposal,
  generateProposalForOperator,
  // ★ 2026-08-04 리마인드 명단 — 발송과 같은 코호트를 읽는다(보여준 수 = 나가는 수)
  readCampaignQueuedPhones,
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
  LEARNING_MEMORY_TYPES,
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
  // ★ 2026-08-02 §13-1 — 저장 후 스텝 추가·삭제(화면 흐름 재설계의 선행)
  addJourneyStep,
  deleteJourneyStep,
  JourneyStepGateError,
  updateJourneyCallback,
  JOURNEY_TEMPLATES,
  JourneyTemplateCode,
  JourneyStatus,
} from '../utils/journey-builder';
import { AlimtalkFallbackError } from '../utils/alimtalk-fallback';
// ★ 2026-08-02 §13-5: 구매 문 판정·마지막 도착 시각 — 판정은 CT가 소유하고 라우트는 그대로 전달만 한다.
import { getPurchaseDoorStatus } from '../utils/journey-purchase-ledger';
// ★ 2026-08-02: 등급 서열 — 값 목록·저장·확인 판정은 CT 단일 출처.
import { listCompanyGradeValues, saveGradeRanks, hasUsableGradeOrder, hasGradeOrderConfig } from '../utils/customer-grade-rank';
// ★ D218+ (2026-05-26): 활성화 검증 + 정지 이력 조회
import { validateJourneyForActivation } from '../utils/journey-pretest-validator';
import { getPauseLogs } from '../utils/journey-pause-handler';
// ★ 2026-06-30 여정 일반화 — one_shot 활성 시점 단발 dispatch.
import { dispatchOneShotJourney } from '../utils/journey-anchor-scheduler';
// ★ D187-fix3 (2026-05-21): Journey AI Generator — One-shot 자연어 + 시즌 + 회사 메모리
import { generateJourneyPackage, refineStepMessage, generateAnchorJourneyPlan } from '../utils/journey-ai-generator';
// ★ 2026-07-28 알림톡 템플릿 → 트리거 제안 (후보 밖 값 거부는 CT가 담당)
import { suggestJourneyTrigger } from '../utils/journey-trigger-suggest';
// ★ 2026-06-29: 대화형 여정 수정 — 초안 패키지에 자연어 수정 반영
import { editJourneyPackage } from '../utils/journey-ai-editor';
// ★ 2026-06-29: AI 꾸미기 — 추천 메시지에 선택 컬럼(%변수%) 자연스럽게 녹임
import { decorateOperatorMessages } from '../utils/operator-message-decorator';
import { buildJourneyPreviewSamples, countJourneyTargetCustomers, selectAnchorAudienceIds } from '../utils/journey-target-extractor';
import { describeJourneyTrigger } from '../utils/journey-step-format';
import { normalizeStartKind } from '../utils/journey-start-kind';
// ★ D210+ Phase 2-fix1 (Harold 명시 2026-05-23): CT-58 — 회사 customer DB 실측 프로필 조회.
//   /operator/data-profile endpoint = 마케팅 담당자 검토 UI 안내 카드 data source.
import { getCompanyDataProfile, getCompanyJourneyFacts } from '../utils/company-data-profile';
// ★ 2026-08-01 여정 재설계 §2-3 — 회사가 준 데이터로 만들 수 있는 여정만 연다(못 여는 것은 사유와 함께 잠근다).
import { resolveTriggerAvailability, toAvailabilityMap, hasAnyAvailableTrigger, isImplementedTriggerEvent } from '../utils/journey-trigger-capability';
// ★ D192 (2026-05-22): CT-51 Journey 통계 통합 진입점 — 옛 단순 통계(getJourneyStats/listExecutions)를 완전 진화 — buildJourneyStats (overview + steps + segments + hourly + weekday + variants) + listJourneyEnteredCustomers (회사 격리 + 페이지네이션)
import { buildJourneyStats, listJourneyEnteredCustomers } from '../utils/journey-stats';
// ★ D197 (2026-05-22) Phase B-2: Predictive Suite — 회사 예측 점수 분포 + Top 위험/구매 가능성 + 모델 정확도
// ★ D210+ Phase 3 (2026-05-23 Harold 명시): listCompanyPredictionCustomers — 회사 전체 customer 영역 페이지네이션 + 검색 + 필터 + 정렬
import {
  computeCompanyPredictionsBatch,
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
// ★ 2026-06-29: "오늘의 여정 기회" — 회사 실데이터로 여정 빈 지점 산출 (랜딩 1클릭 생성)
import { buildJourneyOpportunities } from '../utils/journey-opportunities';
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
// ★ 2026-07-04 스타일 참고 갤러리 — AI 문구 추천 모달용.
//   myBest = 자사 발송 이력 성과 상위(자기 데이터 자기 노출 = 오해 소지 0)
//   styles = 업종 스타일 예시(AI 재창작본만 — 타사 실발송 원문은 탈색본이라도 절대 미노출)
router.get('/style-gallery', authenticate, async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다' });

    // 업종 조회 (미설정 시 스타일 예시 없이 myBest만)
    const compR = await query('SELECT industry_code FROM companies WHERE id = $1', [companyId]);
    const industryCode = compR.rows[0]?.industry_code ? String(compR.rows[0].industry_code).trim() : null;

    // 내 승리 문안 — 자사 학습 로그 성과 상위 4 (성과 라벨 있는 발송만, 실데이터)
    const tenantRef = getTenantRef(companyId);
    const myR = await query(
      `SELECT final_message, message_type, sent_count, success_count
       FROM ai_training_logs
       WHERE tenant_ref = $1 AND final_message IS NOT NULL AND length(final_message) >= 10
         AND sent_count IS NOT NULL AND sent_count > 0
       ORDER BY (success_count::float / NULLIF(sent_count, 0)) DESC NULLS LAST, sent_count DESC, created_at DESC
       LIMIT 4`,
      [tenantRef],
    );
    const myBest = myR.rows.map((r: any) => ({
      text: r.final_message,
      messageType: r.message_type,
      sentCount: r.sent_count,
      successRate: r.sent_count > 0 ? Math.round(((r.success_count || 0) / r.sent_count) * 100) : null,
    }));

    // 업종 스타일 예시 — best_copy_assets(kind='style_example'). 테이블/데이터 없으면 빈 배열(degrade)
    const styles = industryCode ? await listStyleExamples(industryCode) : [];

    res.json({
      success: true,
      myBest,
      styles,
      industryLabel: industryCode ? industryLabel(industryCode) : null,
    });
  } catch (err: any) {
    console.error('[style-gallery] 조회 실패:', err?.message);
    res.status(500).json({ error: '스타일 참고 조회에 실패했습니다.' });
  }
});

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

/**
 * POST /api/ai/target-recipients — targetFilters(compat) 기준 추출 대상 리스트 페이징 조회 (2026-07-09)
 *   { targetFilters, page, pageSize } → { success, recipients, total, page, pageSize }
 *   - recount-target과 동일한 WHERE(company·is_active·sms_opt_in·store-scope·user_id 수신거부 제외) + buildFilterWhereClauseCompat.
 *   - 컬럼은 targets/extract 샘플 SQL과 동일(운영 중 검증됨). SELECT 전용.
 *   - 맞춤한줄(AiCustomSendFlow) 등 compat targetFilters 발송툴이 "추출 대상 리스트 보기" 공용 모달에서 소비.
 */
router.post('/target-recipients', authenticate, async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다' });
    }

    const { targetFilters, page, pageSize } = req.body as {
      targetFilters?: Record<string, unknown>;
      page?: number;
      pageSize?: number;
    };
    const safeFilters = targetFilters && typeof targetFilters === 'object' ? targetFilters : {};
    const p = Math.max(1, Math.floor(Number(page) || 1));
    const size = Math.min(100, Math.max(1, Math.floor(Number(pageSize) || 15)));
    const offset = (p - 1) * size;

    // ★ B16-01 브랜드 격리 (recount-target 미러)
    let storeFilter = '';
    const baseParams: any[] = [companyId];
    if (userType === 'company_user' && userId) {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'filtered') {
        storeFilter = ' AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($2::text[]))';
        baseParams.push(scope.storeCodes);
      } else if (scope.type === 'blocked') {
        return res.json({ success: true, recipients: [], total: 0, page: p, pageSize: size });
      }
    }

    const { sql: filterSql, params: filterParams } = buildFilterWhereClauseCompat(safeFilters, baseParams.length + 1);
    const unsubIdx = baseParams.length + filterParams.length + 1; // user_id
    const whereCommon = `c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true${storeFilter} ${filterSql}
       AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${unsubIdx} AND u.phone = c.phone)`;

    const countResult = await query(
      `SELECT COUNT(*)::int AS cnt FROM customers c WHERE ${whereCommon}`,
      [...baseParams, ...filterParams, userId]
    );
    const listResult = await query(
      `SELECT c.id, c.phone, c.name, c.gender, c.grade, c.region, c.last_purchase_date, c.total_purchase_amount
         FROM customers c
        WHERE ${whereCommon}
        ORDER BY c.id ASC
        LIMIT $${unsubIdx + 1} OFFSET $${unsubIdx + 2}`,
      [...baseParams, ...filterParams, userId, size, offset]
    );

    const total = Number(countResult.rows[0]?.cnt ?? 0);
    const recipients = listResult.rows.map((r: any) => ({
      phone: r.phone,
      name: r.name,
      gender: r.gender,
      grade: r.grade,
      region: r.region,
      last_purchase_date: r.last_purchase_date,
      total_purchase_amount: r.total_purchase_amount != null ? Number(r.total_purchase_amount) : null,
    }));

    return res.json({ success: true, recipients, total, page: p, pageSize: size });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        code: 'DB_MIGRATION_PENDING',
        error: 'DB 마이그레이션 필요 — 운영자에게 customers 컬럼 확인을 요청해주세요.',
      });
    }
    console.error('[ai/target-recipients] 오류:', err);
    return res.status(500).json({ success: false, error: '대상 리스트 조회 실패' });
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
// ★ 2026-06-29: sample-customer row → 표시명/Liquid 필드 매핑 (여정 trigger·AI Operator filters 두 경로 공용 — 인라인 중복 제거)
function mapSampleCustomerRow(row: any): { sampleCustomer: Record<string, string | number | null>; sampleCustomerFields: Record<string, any> } {
  // ★ 2026-07-09: 하드코딩 라벨/컬럼 테이블 폐기 — FIELD_MAP 단일 소스 파생.
  //   sampleCustomer 키 = FIELD_MAP displayName(발송 사전 키와 동일) → 미리보기 매칭 = 실제 발송 매칭 100% 일치
  //   (옛 하드코딩은 '등급'·'등록매장'·'최근구매액' 등이 발송 사전 displayName과 어긋나 미리보기만 매칭·발송 빈칸이던 근본 원인).
  //   표시값 = renderFieldValue(발송 치환과 동일 포맷). Liquid 필드(sampleCustomerFields) = column 키 + 예측 점수 fallback.
  const sampleCustomer: Record<string, string | number | null> = {};
  const sampleCustomerFields: Record<string, any> = {};
  for (const f of getColumnFields()) {
    if (f.fieldKey === 'phone' || f.fieldKey === 'sms_opt_in') continue;
    const raw = row[f.columnName];
    const empty = raw === null || raw === undefined || raw === '';
    sampleCustomer[f.displayName] = empty ? null : renderFieldValue(raw, f.fieldKey);
    sampleCustomerFields[f.columnName] = empty ? null : (f.dataType === 'number' ? Number(raw) : raw);
  }
  // Predictive 점수 = 중립 0.5 fallback (Liquid customer.churn_risk 등 — 실제 발송 시 cdp_customer_predictions 정합)
  sampleCustomerFields.churn_risk = 0.5;
  sampleCustomerFields.purchase_likelihood = 0.5;
  sampleCustomerFields.click_score = 0.5;
  return { sampleCustomer, sampleCustomerFields };
}

// ★ 2026-07-09: 샘플 고객 SELECT 컬럼 = FIELD_MAP 컬럼 필드 단일 소스 (mapSampleCustomerRow와 동일 집합). phone/sms_opt_in 제외.
//   컬럼명은 FIELD_MAP 컨트롤타워 값(주입 불가) — filterVarCatalogByData가 이미 운영 쿼리하는 검증된 컬럼 집합.
const SAMPLE_CUSTOMER_COLUMNS = getColumnFields()
  .filter((f) => f.fieldKey !== 'phone' && f.fieldKey !== 'sms_opt_in')
  .map((f) => f.columnName)
  .join(', ');

router.post('/operator/sample-customer', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    }

    const { triggerEvent, triggerFilters, filters } = req.body || {};

    // ★ 2026-06-29 fix: AI Operator 제안 경로 — filters(고객 필드 조건)로 상위 고객 1명 추출 (triggerEvent 없을 때).
    //   기존 버그: AiOperatorPage가 { filters }를 보내는데 엔드포인트는 triggerEvent만 읽어 항상 sampleCustomer=null → 원본/적용 치환 토글이 한 번도 안 떴음.
    if ((!triggerEvent || typeof triggerEvent !== 'string') && filters && typeof filters === 'object' && !Array.isArray(filters)) {
      let fStoreFilter = '';
      const fBaseParams: any[] = [companyId];
      if (userType === 'company_user' && userId) {
        const scope = await getStoreScope(companyId, userId);
        if (scope.type === 'filtered') {
          fStoreFilter = ' AND id IN (SELECT customer_id FROM customer_stores WHERE company_id = $1 AND store_code = ANY($2::text[]))';
          fBaseParams.push(scope.storeCodes);
        } else if (scope.type === 'blocked') {
          return res.json({ success: true, sampleCustomer: null });
        }
      }
      // CT-01 customer-filter (unqualified 컬럼 · leading AND · companyId=$1 전제) — preview-recipients와 동일.
      const { sql: filterWhere, params: filterParams } = buildFilterWhereClauseCompat(filters, fBaseParams.length + 1);
      const fParams = [...fBaseParams, ...filterParams];
      const fSql = `
        SELECT ${SAMPLE_CUSTOMER_COLUMNS}
        FROM customers
        WHERE company_id = $1::uuid AND is_active = true AND sms_opt_in = true
          ${fStoreFilter}
          ${filterWhere}
        ORDER BY COALESCE(ltv_score, 0) DESC, COALESCE(total_purchase_amount, 0) DESC
        LIMIT 1
      `;
      const fr = await query(fSql, fParams);
      const frow = fr.rows[0] || null;
      if (!frow) return res.json({ success: true, sampleCustomer: null });
      const fmapped = mapSampleCustomerRow(frow);
      return res.json({ success: true, sampleCustomer: fmapped.sampleCustomer, sampleCustomerFields: fmapped.sampleCustomerFields });
    }

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
      SELECT ${SAMPLE_CUSTOMER_COLUMNS}
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
    const mapped = mapSampleCustomerRow(row);
    return res.json({ success: true, sampleCustomer: mapped.sampleCustomer, sampleCustomerFields: mapped.sampleCustomerFields });
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
        error: '본 기능은 요금제 가입 후 이용 가능합니다.',
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
              cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao, unit_price_basis
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
      return res.status(403).json({ success: false, error: '본 기능은 요금제 가입 후 이용 가능합니다.', code: 'BETA_GATE' });
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

// ★ 2026-07-10 [타겟확인] 오퍼레이터판 — 추천 타겟 조건 리스트 (상한 100 + 조건 필드 동적 컬럼, Harold 지시).
//   자동마케팅 /operator/proposals/:id/recipients와 동일 계약(SoT: docs/superpowers/specs/2026-07-10-send-target-list-three-phase-design.md §3-1).
//   필터 원천만 요청 body(제안 미저장 단계 — proposal row 없음). 발송 경로(preview-recipients → /direct-send)는 무변경, 열람 전용.
//   소유자 scope 없음(의도) — proposals/:id/recipients의 소유 검증은 영속 proposal 자원 대상이고, 여기는 요청자 본인의
//   propose 결과 필터라 소유 대상이 없다. 접근 정책 = 같은 데이터를 전량 반환하는 preview-recipients와 동일(게이트+storeScope).
//   WHERE = preview-recipients(실발송 대상 조회)와 동일 합성(안전필터+storeScope+filters). 피로도·클릭제외는 이 발송
//   경로가 추출 단계에서 적용하지 않으므로 동봉하지 않는다(보여준 명단 = 나가는 명단 — 원칙 2, campaigns.ts 1589 실측).
/**
 * ★ 2026-08-03 A-6 — 이 회사에서 지금 쓸 수 있는 발송 대상 축과 사유.
 *   화면은 이 결과만 보여준다. 우리가 "이 회사는 이게 된다"를 미리 정하지 않고, 근거가 있는 축만 열린다.
 *   잠긴 축도 숨기지 않고 사유와 함께 보여준다 — 숨기면 담당자는 왜 없는지 알 수 없다.
 */
router.get('/operator/segments', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const ctx = await loadPlanContext(companyId);
    if (!ctx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(ctx, req.user)) {
      return res.status(403).json({ success: false, error: '본 기능은 요금제 가입 후 이용 가능합니다.', code: 'BETA_GATE' });
    }
    return res.json({ success: true, segments: await listSegmentAvailability(companyId) });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — 운영자에게 컬럼 확인을 요청해주세요.', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[AI Operator] segments 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '발송 대상 축 조회 실패' });
  }
});

router.post('/operator/target-recipients', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });

    const ctx = await loadPlanContext(companyId);
    if (!ctx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(ctx, req.user)) {
      return res.status(403).json({ success: false, error: '본 기능은 요금제 가입 후 이용 가능합니다.', code: 'BETA_GATE' });
    }

    // ★ 2026-08-03 A-7: 계약 축(segment_key)이 오면 그 축으로, 아니면 종전대로 filters로.
    const { filters, segment_key, segment_params, operator_id } = req.body;
    const hasSegment = typeof segment_key === 'string' && segment_key.trim();
    if (!hasSegment && (!filters || typeof filters !== 'object')) {
      return res.status(400).json({ success: false, error: 'filters 또는 segment_key가 필요합니다.' });
    }

    // ⛔ 2026-08-03 7R 정정: 화면과 실발송이 같은 해석기를 쓴다. 종전엔 화면은 JWT 역할, 발송은 DB 역할이라
    //   같은 사용자에게 두 판정이 갈렸다(역할 승격 후 옛 토큰이면 화면은 매장 제한·실발송은 전사).
    // ⛔ 8R 정정: 기존 오퍼레이터를 편집 중이면 **그 오퍼레이터 소유자** 기준으로 센다. 관리자가 직원 것을 열면
    //   화면은 전사 수를 보여주고 실발송은 직원 매장으로 나가 서로 달랐다. 신규 등록이면 지금 계정 기준.
    let scopeOwner: string | null = userId || null;
    if (typeof operator_id === 'string' && operator_id.trim()) {
      const own = await query(
        `SELECT created_by FROM continuous_operators WHERE id = $1::uuid AND company_id = $2::uuid`,
        [operator_id.trim(), companyId],
      );
      if (own.rows.length === 0) return res.status(404).json({ success: false, error: '자동마케팅을 찾을 수 없습니다.' });
      // 열람 권한 — 비관리자는 본인 것만(listProposals·approve와 같은 기준).
      if (userType !== 'company_admin' && own.rows[0].created_by !== userId) {
        return res.status(403).json({ success: false, error: '본인이 만든 자동마케팅만 확인할 수 있습니다.' });
      }
      scopeOwner = own.rows[0].created_by || null;
    }
    const scope = await resolveOperatorStoreScope(companyId, scopeOwner);
    if (scope.blocked) {
      return res.json({
        success: true, recipients: [], total: 0, conditionColumns: [],
        blockedReason: '담당 매장이 지정되지 않아 발송 대상을 정할 수 없습니다.',
      });
    }
    const storeFilter = scope.storeFilter;
    const baseParams: any[] = scope.baseParams;

    // ★ 2026-08-04 변화 축 — 비교할 지난 회차가 없으면 세지 않고 "기준 대기"로 답한다.
    //   count 0으로 답하면 담당자는 "대상 없음"으로 오독한다(Codex 조용한0건4 — 오퍼레이터가 있어도
    //   기준선이 아직이면 같은 상태다). 기준선 유무는 서버만 안다 — 화면의 짐작(!operatorId)을 대체한다.
    const opIdForBaseline = typeof operator_id === 'string' && operator_id.trim() ? operator_id.trim() : null;
    if (hasSegment && segmentNeedsCycleBaseline(normalizeSegmentKey(String(segment_key).trim()))) {
      // ⛔ 2R(F7a): 기준선 판정보다 근거 판정이 먼저다. 이 순서가 뒤집히면 잠긴 축·표 미생성까지
      //   "기준 대기" 200으로 포장된다 — 잠긴 사유·503이 먼저 나가야 담당자가 진짜 상태를 본다.
      await assertSegmentUsable(companyId, String(segment_key).trim());
      if (!opIdForBaseline || !(await hasCycleBaseline(opIdForBaseline, companyId))) {
        return res.json({
          success: true, awaitingBaseline: true, recipients: [], total: 0,
          basis: 'segment', segmentKey: String(segment_key).trim(), conditionColumns: [],
        });
      }
    }

    const compiled = await compileOperatorAudience({
      companyId,
      segmentKey: hasSegment ? String(segment_key) : null,
      segmentParams: segment_params,
      legacyFilters: filters || {},
      baseParams,
      // ★ 2026-08-04 변화 축 — 비교할 지난 회차의 주인(위 기준선 게이트를 지난 뒤라 항상 존재).
      operatorId: opIdForBaseline,
    });
    // 조건 필드 동적 컬럼 — FIELD_MAP 화이트리스트 + displayName 라벨 단일 소스.
    //   계약 축은 조건 컬럼을 계약이 정하므로 filters 기반 동적 컬럼을 붙이지 않는다.
    const conditionColumns = compiled.basis === 'segment' ? [] : resolveConditionColumns(filters || {}, FIELD_MAP);
    // ★ 2026-08-03 A-1: 발송 게이트(피로도·미클릭)를 명단에도 적용. 종전 null·null이라 이 화면만 실발송보다 넓었다.
    const gates = await resolveOperatorAudienceGates(companyId, null);
    const { sql, params } = buildSendableRecipientsTopSql(
      compiled.filterWhere, compiled.filterParams, baseParams, storeFilter, gates, conditionColumns,
    );
    const countSql = buildAudienceCountSql(compiled.filterWhere, compiled.filterParams, baseParams, storeFilter, gates);
    const [result, totalRes] = await Promise.all([
      query(sql, params),
      // 총 수도 같은 조건·같은 게이트로 실측 — 명단(상한 100)과 수의 기준이 갈리지 않게.
      query(countSql.sql, countSql.params),
    ]);

    return res.json({
      success: true,
      recipients: result.rows,
      total: Number(totalRes.rows[0]?.count) || 0,
      basis: compiled.basis,
      segmentKey: compiled.segmentKey,
      conditionColumns: conditionColumns.map((c) => ({ key: c.key, label: c.label })),
    });
  } catch (err: any) {
    const msg = err?.message || '';
    // ★ 2026-08-04 변화 축 — 회차 스냅샷 표 미생성. 컴파일 단계가 코드를 붙여 던진다(500 노출 금지).
    if (err?.code === 'DB_MIGRATION_PENDING' || err?.code === '42P01') {
      return res.status(503).json({ success: false, error: '지난번과 달라진 점을 찾는 조건은 준비 중입니다. 잠시 후 다시 시도해 주세요.', code: 'DB_MIGRATION_PENDING' });
    }
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — 운영자에게 customers 컬럼 확인을 요청해주세요.', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[AI Operator] target-recipients 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '추출 대상 조회 실패' });
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
      return res.status(403).json({ success: false, error: '본 기능은 요금제 가입 후 이용 가능합니다.', code: 'BETA_GATE' });
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
      return res.status(403).json({ success: false, error: '본 기능은 요금제 가입 후 이용 가능합니다.', code: 'BETA_GATE' });
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
      return res.status(403).json({ success: false, error: '본 기능은 요금제 가입 후 이용 가능합니다.', code: 'BETA_GATE' });
    }

    const periodParam = String(req.body?.period || '30d');
    const period: PerformancePeriod = (['7d', '14d', '30d', '90d'] as const).includes(periodParam as any)
      ? (periodParam as PerformancePeriod)
      : '30d';

    // 풀분석 300 — 사전 차단(부족 시 402, PDF 스트림 시작 전)
    const cost = getCreditCost('orchestrate');  // 300
    await checkCredit(companyId, cost);

    const snapshot = await buildPerformanceSnapshotV2(companyId, period);
    const days = { '7d': 7, '14d': 14, '30d': 30, '90d': 90 }[period];
    const companyMeta = await query(
      `SELECT company_name, business_type, brand_name, brand_tone FROM companies WHERE id = $1::uuid`,
      [companyId],
    );
    const companyInfo = companyMeta.rows[0] || {};
    const companyName = companyInfo.company_name || '';
    // 풀 보고서 부가 데이터 (실패 graceful — PDF 생성은 계속). AI 진단은 최근 30일 기준.
    let explanation: Awaited<ReturnType<typeof explainPerformance>> | null = null;
    let cohort: Awaited<ReturnType<typeof buildCohortRetention>> | null = null;
    let attribution: Awaited<ReturnType<typeof buildCampaignAttribution>> | null = null;
    try { const sn = await buildPerformanceSnapshot(companyId); explanation = await explainPerformance(companyId, sn, companyInfo); } catch (e: any) { console.log('[report-pdf] explain skip:', e?.message); }
    try { cohort = await buildCohortRetention(companyId, 12); } catch (e: any) { console.log('[report-pdf] cohort skip:', e?.message); }
    try { attribution = await buildCampaignAttribution(companyId, days); } catch (e: any) { console.log('[report-pdf] attribution skip:', e?.message); }
    // ★ 2026-07-03 고객 축 (실패 graceful — PDF 생성은 계속)
    let gradePerformance: Awaited<ReturnType<typeof buildGradePerformance>> | null = null;
    let recipientAttribution: Awaited<ReturnType<typeof buildRecipientAttribution>> | null = null;
    try { gradePerformance = await buildGradePerformance(companyId, days); } catch (e: any) { console.log('[report-pdf] grade skip:', e?.message); }
    try { recipientAttribution = await buildRecipientAttribution(companyId, days); } catch (e: any) { console.log('[report-pdf] recipient-attr skip:', e?.message); }

    // 차감 — 회사+기간+날짜 멱등(같은 날 같은 기간 재다운로드는 무료)
    const todayKst = kstDateTag(new Date());
    await deductCreditSafe({
      companyId, cost, source: 'orchestrate', createdBy: userId,
      idempotencyKey: `perf-report:${companyId}:${period}:${todayKst}`,
    });

    // PDF 생성 (billing.ts 패턴 — malgun.ttf 한글 폰트, res 직접 스트림)
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="performance_${period}_${todayKst}.pdf"`);
    doc.pipe(res);

    // 본문 렌더 = 공통 CT(performance-pdf-render) 재사용 — 인라인 중복 제거(no_inline_duplication).
    renderPerformanceReportPdf(doc, { snapshot, explanation, cohort, attribution, companyName, period, gradePerformance, recipientAttribution });

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

// === 풀분석(Full Analysis) 비동기 job — start/status/download (spec 2026-06-08) ===
router.post('/operator/performance/full-analysis/start', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId; const userId = req.user?.userId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx || !isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, code: 'BETA_GATE', error: '본 기능은 요금제 가입 후 이용 가능합니다.' });
    }
    const periodParam = String(req.body?.period || '30d');
    const period: PerformancePeriod = (['7d', '14d', '30d', '90d'] as const).includes(periodParam as any) ? (periodParam as PerformancePeriod) : '30d';
    const purposeParam = String(req.body?.purpose || 'overall');
    const purpose = ['overall', 'revenue', 'retention', 'channel'].includes(purposeParam) ? purposeParam : 'overall';
    const cost = getCreditCost('orchestrate'); // 300
    try { await checkCredit(companyId, cost); }
    catch (e: any) {
      if (e instanceof InsufficientCreditError) return res.status(402).json({ success: false, code: 'INSUFFICIENT_CREDIT', error: '풀분석에 필요한 크레딧이 부족합니다. 크레딧을 충전해 주세요.' });
      throw e;
    }
    const job = await createJob({ companyId, createdBy: userId ?? null, period, purpose, reportTitle: req.body?.reportTitle ?? null });
    // 차감은 러너가 분석·PDF 성공 직후 수행(멱등 키=jobId). 어느 단계든 실패 시 차감 0 → 환불 불요.
    setImmediate(() => { runFullAnalysis(job.id, companyId, period, userId ?? null).catch((e) => console.log('[full-analysis] runner throw', e?.message)); });
    return res.json({ success: true, jobId: job.id, totalSteps: job.total_steps });
  } catch (err: any) {
    console.error('[full-analysis] start 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '풀분석 시작 실패' });
  }
});

router.get('/operator/performance/full-analysis/status/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const job = await getJob(req.params.id, companyId);
    if (!job) return res.status(404).json({ success: false, error: 'job을 찾을 수 없습니다.' });
    return res.json({ success: true, status: job.status, currentStep: job.current_step, totalSteps: job.total_steps, stepLabel: job.step_label, progress: stepProgress(job.current_step), error: job.error });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || '상태 조회 실패' });
  }
});

router.get('/operator/performance/full-analysis/download/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const job = await getJob(req.params.id, companyId);
    if (!job || job.status !== 'done' || !job.pdf_path) return res.status(409).json({ success: false, error: '아직 준비되지 않았습니다.' });
    const fsmod = require('fs');
    if (!fsmod.existsSync(job.pdf_path)) return res.status(404).json({ success: false, error: 'PDF 파일이 없습니다.' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="full_analysis_${job.period}.pdf"`);
    fsmod.createReadStream(job.pdf_path).pipe(res);
  } catch (err: any) {
    if (!res.headersSent) return res.status(500).json({ success: false, error: err?.message || 'PDF 다운로드 실패' });
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
      return res.status(403).json({ success: false, error: '본 기능은 요금제 가입 후 이용 가능합니다.', code: 'BETA_GATE' });
    }

    const companyResult = await query(
      `SELECT company_name, business_type, brand_name, brand_tone FROM companies WHERE id = $1::uuid`,
      [companyId]
    );
    const companyInfo = companyResult.rows[0] || {};
    const snapshot = await buildPerformanceSnapshot(companyId);
    // ★ 2026-07-03 고객 축 — 등급 실측 상위 라인을 AI 진단 입력에 주입 (실패 시 skip, 진단은 계속)
    let extraLines: string[] | undefined;
    try {
      const grades = await buildGradePerformance(companyId, 30);
      extraLines = grades.slice(0, 4).map((g) =>
        `${g.grade} 등급: 여정 발송 ${g.journeySent.toLocaleString()}건 · DM 수신 ${g.dmSent.toLocaleString()}명(열람 ${g.dmViewers.toLocaleString()}명) · 이메일 클릭 ${g.emailClickers.toLocaleString()}명 · 구매 ${g.buyers.toLocaleString()}명 · 매출 ${Math.round(g.revenue).toLocaleString()}원`);
      if (extraLines.length === 0) extraLines = undefined;
    } catch (e: any) {
      console.log('[Performance] explain 고객 축 주입 skip:', e?.message || e);
    }
    const explanation = await explainPerformance(companyId, snapshot, companyInfo, extraLines);
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
      return res.status(403).json({ success: false, error: '본 기능은 요금제 가입 후 이용 가능합니다.', code: 'BETA_GATE' });
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
      return res.status(403).json({ success: false, error: '본 기능은 요금제 가입 후 이용 가능합니다.', code: 'BETA_GATE' });
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
    // ★ 2026-07-30: 브랜드 행(msg_type='F')이 SMSQ 합류 — SMS 집계 하나가 전 채널을 담는다.
    const smsCountMap = await aggregateSmsCountsByCampaign(metaRows as any);

    const costResult = await query(
      `SELECT cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao, unit_price_basis FROM companies WHERE id = $1::uuid`,
      [companyId]
    );
    // ★ 2026-07-26 인라인 폴백 상수 폐기 — 부가세 기준 해석과 기본 단가를 CT 하나로 통일한다.
    const costs = getCompanyCosts(costResult.rows[0] || {});

    const campaigns = metaRows.map((c: any) => {
      const sms = smsCountMap.get(c.id) || { total_count: 0, success_count: 0, fail_count: 0 };
      const sent = Number(sms.total_count || 0);
      const success = Number(sms.success_count || 0);
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
      return res.status(403).json({ success: false, error: '본 기능은 요금제 가입 후 이용 가능합니다.', code: 'BETA_GATE' });
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
      return res.status(403).json({ success: false, error: '본 기능은 요금제 가입 후 이용 가능합니다.', code: 'BETA_GATE' });
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
      return res.status(403).json({ success: false, error: '본 기능은 요금제 가입 후 이용 가능합니다.', code: 'BETA_GATE' });
    }
    const days = Math.max(7, Math.min(90, parseInt(String(req.query.days || '30'), 10) || 30));
    const result = await buildCampaignAttribution(companyId, days);
    return res.json({ success: true, attribution: result });
  } catch (err: any) {
    console.error('[Performance] attribution 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'attribution 조회 실패' });
  }
});

// 7-2) GET /operator/performance/customer-axis — ★ 2026-07-03 고객 축(등급 성과 + 수신 고객 정밀 기여)
//   설계: docs/superpowers/specs/2026-07-03-performance-customer-axis-design.md
//   snapshot-v2에 얹지 않고 모달 lazy load 전용 (D231 요청 경로 성능 원칙)
router.get('/operator/performance/customer-axis', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: '본 기능은 요금제 가입 후 이용 가능합니다.', code: 'BETA_GATE' });
    }
    const days = Math.max(7, Math.min(90, parseInt(String(req.query.days || '30'), 10) || 30));
    const [gradePerformance, recipientAttribution] = await Promise.all([
      buildGradePerformance(companyId, days),
      buildRecipientAttribution(companyId, days),
    ]);
    return res.json({ success: true, gradePerformance, recipientAttribution });
  } catch (err: any) {
    console.error('[Performance] customer-axis 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '고객 축 조회 실패' });
  }
});

// 7-1) GET /operator/performance/automarketing-roi — ★ 2026-07-02 3차: 자동마케팅 매출 귀속(ROI)
router.get('/operator/performance/automarketing-roi', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: '본 기능은 요금제 가입 후 이용 가능합니다.', code: 'BETA_GATE' });
    }
    const days = Math.max(7, Math.min(90, parseInt(String(req.query.days || '30'), 10) || 30));
    const { buildAutoMarketingRoi } = await import('../utils/automarketing-roi');
    const roi = await buildAutoMarketingRoi(companyId, days);
    return res.json({ success: true, roi });
  } catch (err: any) {
    console.error('[Performance] automarketing-roi 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'ROI 조회 실패' });
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
      return res.status(403).json({ success: false, error: '본 기능은 요금제 가입 후 이용 가능합니다.', code: 'BETA_GATE' });
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
    if (!companyId || !userId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    // 2026-06-19 (Harold 명시): 자동 마케팅 생성은 일반 사용자(company_user)도 가능 — 회사 관리자 전용 게이트 제거.
    //   operator는 회사 스코프이며, 발송·돈 안전망(opt-out/광고080/예산/스팸)은 발송 시점에 그대로 적용된다.

    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: '본 기능은 요금제 가입 후 이용 가능합니다.', code: 'BETA_GATE' });
    }

    const {
      name, objective, schedule, schedule_time, schedule_day_of_week, schedule_day_of_month, schedule_month,
      channel, benefit_content, admin_phone_numbers, backup_admin_phone, admin_alert_channel,
      auto_send_lead_minutes, budget_monthly, budget_daily, budget_alert_threshold, delivery_policy,
      sequence_enabled, sequence_delay_days, sequence_reminder_content, send_time_mode, copy_style,
      calendar_month, target_hint, mms_image_paths,
      // ★ 2026-08-03 A-7: 세그먼트 계약(축 + 파라미터) — 지정하면 회차마다 같은 조건으로 컴파일된다.
      segment_key, segment_params,
    } = req.body;

    // ★ 2026-07-05 마케팅 캘린더 경유 등록 — 같은 달에 살아있는 등록이 있으면 409(200크레딧 중복 차감 차단)
    const calendarMonth = calendar_month != null && Number(calendar_month) >= 1 && Number(calendar_month) <= 12
      ? Math.floor(Number(calendar_month)) : null;
    if (calendarMonth != null) {
      const { getActiveRegistration } = await import('../utils/marketing-calendar-store');
      const existing = await getActiveRegistration(companyId, calendarMonth);
      if (existing) {
        return res.status(409).json({
          success: false,
          error: `${calendarMonth}월 캠페인은 이미 자동마케팅으로 등록되어 있습니다. 자동 마케팅 화면에서 확인해주세요.`,
          code: 'CALENDAR_MONTH_ALREADY_REGISTERED',
        });
      }
    }

    // ★ 2026-08-04 계약 필수화(§5-B ③) — 축을 안 고른 등록(자연어·오늘의 추천·시나리오 미선택)은
    //   **등록 1회에 한해** AI가 목표를 그 회사에서 열려 있는 축으로 옮긴다. 이게 되면 회차마다 목표를
    //   다시 해석하지 않는다(결정성). 축으로 표현이 안 되거나 확신이 없으면 종전대로 자유 해석 —
    //   매핑 실패로 등록을 막지 않는다(기능 우선). 무엇으로 고정됐는지는 응답에 실어 화면이 바로 알린다.
    let finalSegmentKey: string | null = typeof segment_key === 'string' && segment_key.trim() ? segment_key : null;
    let finalSegmentParams: Record<string, number> | null =
      segment_params && typeof segment_params === 'object' && !Array.isArray(segment_params)
        ? (segment_params as Record<string, number>) : null;
    let appliedSegment: { key: string; label: string } | null = null;
    // ⛔ 매핑이 서는 조건 넷(2026-08-04 Codex 반영):
    //   ①축 미지정 ②화면에서 축 선택 UI를 본 등록이 아님(segment_choice_seen — 모달의 "자동 판단" 명시
    //     선택을 덮으면 화면이 거짓말이 된다) ③옛 축(target_hint)도 명시 안 함 — 마케팅 캘린더는 그 축으로
    //     대상을 골라 보낸다. 그 선택을 AI 계약이 덮으면 캘린더 화면이 보여준 축과 실제가 갈린다(2R #8)
    //   ④이름·목표가 실재(빈 등록은 어차피 저장이 거부되는데 AI 호출·호출 한도만 소모한다).
    if (
      !finalSegmentKey
      && req.body?.segment_choice_seen !== true
      && !(typeof target_hint === 'string' && target_hint.trim())
      && typeof objective === 'string' && objective.trim()
      && typeof name === 'string' && name.trim()
    ) {
      try {
        const openAxes = (await listSegmentAvailability(companyId)).filter((a) => a.available);
        const mapped = await suggestSegmentForObjective(companyId, userId || null, objective.trim(), openAxes);
        if (mapped) {
          // 저장 검증을 여기서 미리 통과시킨다 — 매핑된 축이 표 미생성 등으로 저장 불가면 매핑을 버리고
          //   자유 해석으로 등록한다(매핑 실패가 등록 전체를 503으로 만들면 안 된다 — 기능 우선).
          await assertSegmentUsable(companyId, mapped.key);
          finalSegmentKey = mapped.key;
          finalSegmentParams = mapped.params;
          appliedSegment = { key: mapped.key, label: openAxes.find((a) => a.key === mapped.key)?.label || mapped.key };
        }
      } catch (e: any) {
        console.warn('[Operator continuous POST] 축 매핑 생략(자유 해석 등록):', e?.message);
      }
    }

    const operator = await createOperator({
      companyId,
      createdBy: userId,
      name: String(name || '').slice(0, 100),
      objective: String(objective || ''),
      schedule,
      scheduleTime: schedule_time,
      scheduleDayOfWeek: schedule_day_of_week != null ? Number(schedule_day_of_week) : null,
      scheduleDayOfMonth: schedule_day_of_month != null ? Number(schedule_day_of_month) : null,
      scheduleMonth: schedule_month != null ? Number(schedule_month) : null,  // ★ 2026-07-05 yearly 대상 월
      // ★ 2026-06-26: 생성 시에도 채널·혜택·담당자·예산 저장 (#1 채널 / #3 담당자·2h알림 / #4 혜택 fix)
      channel,
      benefitContent: typeof benefit_content === 'string' ? benefit_content : null,
      adminPhoneNumbers: Array.isArray(admin_phone_numbers) ? admin_phone_numbers.filter((p: any) => typeof p === 'string' && p.trim()) : undefined,
      backupAdminPhone: backup_admin_phone === undefined ? undefined : (backup_admin_phone === null ? null : String(backup_admin_phone)),
      adminAlertChannel: ['sms', 'kakao', 'email'].includes(admin_alert_channel) ? admin_alert_channel : undefined,
      autoSendLeadMinutes: auto_send_lead_minutes != null ? Number(auto_send_lead_minutes) : null,
      budgetMonthly: budget_monthly === undefined ? undefined : (budget_monthly === null ? null : Number(budget_monthly)),
      budgetDaily: budget_daily === undefined ? undefined : (budget_daily === null ? null : Number(budget_daily)),
      budgetAlertThreshold: budget_alert_threshold !== undefined ? Number(budget_alert_threshold) : undefined,
      deliveryPolicy: ['daily', 'weekly', 'monthly'].includes(delivery_policy) ? delivery_policy : undefined,
      // ★ Phase3 C: 다단계 시퀀스 (1차 → N일 후 미반응자 리마인드)
      sequenceEnabled: sequence_enabled === true,
      sequenceDelayDays: sequence_delay_days != null ? Number(sequence_delay_days) : null,
      sequenceReminderContent: typeof sequence_reminder_content === 'string' ? sequence_reminder_content : null,
      // ★ 2026-07-02 1단계 B: 발송 시각 모드 — 'fixed'(기본) | 'ai_optimal'
      sendTimeMode: send_time_mode === 'ai_optimal' ? 'ai_optimal' : 'fixed',
      // ★ 2026-07-02 2단계: 문안 스타일 (createOperator가 화이트리스트 정규화)
      copyStyle: typeof copy_style === 'string' ? copy_style : null,
      // ★ 2026-07-07 마케팅 캘린더 완비: 발송 대상 축 (createOperator가 화이트리스트 정규화)
      targetHint: typeof target_hint === 'string' ? target_hint : null,
      // ★ 2026-08-03 A-7: 계약(createOperator가 화이트리스트·범위 정규화). 미지정 = 옛 방식(자유 해석).
      // ★ 2026-08-04: 사용자가 안 골랐으면 위 등록 1회 매핑 결과가 들어온다.
      segmentKey: finalSegmentKey,
      segmentParams: finalSegmentParams,
      // ★ 2026-07-30 (임은지 접수): MMS 이미지 (createOperator가 채널 mms + 최대 3장으로 정규화)
      mmsImagePaths: Array.isArray(mms_image_paths) ? mms_image_paths : null,
    });
    // ★ 2026-07-05: 캘린더 경유 등록 기록 — 실패해도 등록은 성공(fire-safe, 테이블 미생성 = 내부 생략)
    if (calendarMonth != null) {
      const { markCalendarRegistration } = await import('../utils/marketing-calendar-store');
      markCalendarRegistration(companyId, calendarMonth, operator.id).catch((e: any) =>
        console.log('[MarketingCalendar] 등록 기록 실패(등록은 성공):', e?.message || e));
    }
    // appliedSegment — AI 매핑으로 고정된 축. 화면이 즉시 알린다(사용자 몰래 고정되는 상태 금지).
    return res.json({ success: true, operator, appliedSegment });
  } catch (err: any) {
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ success: false, error: '자동 마케팅 시작에 필요한 크레딧이 부족합니다. 크레딧을 충전해 주세요.', code: 'INSUFFICIENT_CREDIT' });
    }
    const msg = err?.message || '';
    if (err?.code === 'DB_MIGRATION_PENDING' || err?.code === '42P01') {
      return res.status(503).json({ success: false, error: '지난번과 달라진 점을 찾는 조건은 준비 중입니다. 다른 조건으로 저장해 주세요.', code: 'DB_MIGRATION_PENDING' });
    }
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션이 필요합니다. 운영자에게 continuous_operators 컬럼 추가(ALTER)를 요청해주세요.', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[Operator continuous POST] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Continuous Operator 신설 실패' });
  }
});

router.get('/operator/continuous', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    // ★ 2026-07-09 노출 범위: 비관리자=본인이 만든 자동마케팅만, 관리자=회사 전체.
    const operators = await listOperators(companyId, req.user?.userType === 'company_admin' ? null : req.user?.userId);
    return res.json({ success: true, operators });
  } catch (err: any) {
    console.error('[Operator continuous GET] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

// ★ 2026-07-02 4차: 마케팅 캘린더 — 1년치 시즌 캠페인 AI 설계 (등록은 기존 POST /operator/continuous 재사용 = 등록당 200 별도).
//   설계 생성 = 매회 50 차감(재생성 포함 — Harold 명시). CREDIT_COST_MAP 'marketing-calendar'가 진실,
//   callAIWithFallback이 사전 잔액 확인 + 성공 후 차감을 담당.
router.post('/operator/marketing-calendar/generate', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: '본 기능은 요금제 가입 후 이용 가능합니다.', code: 'BETA_GATE' });
    }
    const [infoRes, cntRes] = await Promise.all([
      query(`SELECT business_type, brand_name, brand_tone FROM companies WHERE id = $1::uuid`, [companyId]),
      query(`SELECT COUNT(*)::int AS n FROM customers WHERE company_id = $1::uuid AND is_active = true`, [companyId]),
    ]);
    const info = infoRes.rows[0] || {};
    const { buildCalendarSystemPrompt, buildCalendarUserMessage, buildCalendarRepairMessage, missingCalendarMonths, sanitizeCalendarEntries } = await import('../utils/marketing-calendar-policy');
    const { extractJsonObject } = await import('../utils/daily-brief-policy');
    const kstMonth = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCMonth() + 1;
    // ★ 2026-07-05 P2-6: 회사 실데이터 컨텍스트(월별 구매 실측·학습 메모리·기존 캠페인) — best-effort, 실패 축은 생략
    const { buildCompanyCalendarContext } = await import('../utils/marketing-calendar-store');
    const companyCtx = await buildCompanyCalendarContext(companyId);
    const calendarInput = {
      businessType: info.business_type || null,
      brandName: info.brand_name || null,
      brandTone: info.brand_tone || null,
      customerCount: Number(cntRes.rows[0]?.n) || 0,
      currentMonth: kstMonth,
      ...companyCtx,
    };

    // ★ 2026-07-05 차감 구조 정정 — 옛 구조는 AI 응답 시점에 50 차감 → sanitize가 혜택 포함 달을 버려
    //   0건이면 차감 후 502(빈손), 일부 걸러지면 결손 캘린더였다.
    //   사전 잔액 확인 → 무과금 호출(creditCost 0) → 결손 달 1회 보정 재호출(무과금) →
    //   반환할 결과가 있을 때만 50 차감(멱등키). 매회 차감 정책(Harold 명시)은 "성공 반환당 1회"로 유지.
    const cost = getCreditCost('marketing-calendar');
    await checkCredit(companyId, cost);
    const userId = req.user?.userId ? String(req.user.userId) : undefined;
    const callOnce = async (userMessage: string) => callAIWithFallback({
      system: buildCalendarSystemPrompt(),
      userMessage,
      maxTokens: 2400,
      temperature: 0.5,
      model: 'opus',
      companyId,
      userId,
      source: 'marketing-calendar',
      creditCost: 0,
    });

    let entries = sanitizeCalendarEntries(extractJsonObject(await callOnce(buildCalendarUserMessage(calendarInput)))?.entries);
    const missing = missingCalendarMonths(entries);
    if (missing.length > 0 && missing.length < 12) {
      // 일부 달만 결손 — 그 달만 보정 재요청 후 병합(전부 결손이면 보정도 무의미 → 아래 502)
      try {
        const repaired = sanitizeCalendarEntries(extractJsonObject(await callOnce(buildCalendarRepairMessage(calendarInput, missing)))?.entries);
        entries = [...entries, ...repaired.filter((e) => missing.includes(e.month))].sort((a, b) => a.month - b.month);
      } catch (repairErr: any) {
        console.log('[MarketingCalendar] 결손 달 보정 재호출 실패(1차 결과로 진행):', repairErr?.message || repairErr);
      }
    }

    if (entries.length === 0) {
      return res.status(502).json({ success: false, error: '캘린더 설계 생성에 실패했습니다. 크레딧은 차감되지 않았습니다. 잠시 후 다시 시도해주세요.' });
    }
    await deductCreditSafe({
      companyId,
      cost,
      source: 'marketing-calendar',
      createdBy: userId ?? null,
      idempotencyKey: `marketing-calendar:${companyId}:${randomUUID()}`,
    });
    // ★ 2026-07-05: 설계 저장 — 새로고침·이탈에도 유지(50크레딧 증발 방지). 실패해도 응답은 성공.
    try {
      const { saveCalendarEntries } = await import('../utils/marketing-calendar-store');
      await saveCalendarEntries(companyId, entries);
    } catch (saveErr: any) {
      console.log('[MarketingCalendar] 설계 저장 실패(생성은 성공):', saveErr?.message || saveErr);
    }
    return res.json({ success: true, entries });
  } catch (err: any) {
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ success: false, error: 'AI 크레딧이 부족합니다.', code: 'INSUFFICIENT_CREDIT' });
    }
    console.error('[MarketingCalendar] 생성 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '캘린더 설계 실패' });
  }
});

// ★ 2026-07-05 P3: 한 달만 다시 설계 — 10크레딧(12×10 > 전체 50이라 부분 재생성으로 전체 우회 불가).
//   20 미만이라 사전 모달 비대상(버튼에 비용 명시 + 차감 후 토스트). 성공 반환 시에만 차감(멱등키).
router.post('/operator/marketing-calendar/regenerate-month', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: '본 기능은 요금제 가입 후 이용 가능합니다.', code: 'BETA_GATE' });
    }
    const month = Math.floor(Number(req.body?.month));
    if (!(month >= 1 && month <= 12)) {
      return res.status(400).json({ success: false, error: 'month는 1~12 사이여야 합니다.' });
    }

    const { getSavedCalendar, saveCalendarEntries, getActiveRegistration, buildCompanyCalendarContext } = await import('../utils/marketing-calendar-store');
    const saved = await getSavedCalendar(companyId);
    if (!saved || saved.entries.length === 0) {
      return res.status(404).json({ success: false, error: '저장된 설계가 없습니다. 먼저 1년 설계를 생성해주세요.' });
    }
    const registered = await getActiveRegistration(companyId, month);
    if (registered) {
      return res.status(409).json({ success: false, error: `${month}월은 이미 자동마케팅으로 등록되어 있어 다시 설계할 수 없습니다.`, code: 'CALENDAR_MONTH_ALREADY_REGISTERED' });
    }

    const cost = getCreditCost('marketing-calendar-month');
    await checkCredit(companyId, cost);
    const userId = req.user?.userId ? String(req.user.userId) : undefined;

    const [infoRes, cntRes] = await Promise.all([
      query(`SELECT business_type, brand_name, brand_tone FROM companies WHERE id = $1::uuid`, [companyId]),
      query(`SELECT COUNT(*)::int AS n FROM customers WHERE company_id = $1::uuid AND is_active = true`, [companyId]),
    ]);
    const info = infoRes.rows[0] || {};
    const { buildCalendarSystemPrompt, buildCalendarRepairMessage, sanitizeCalendarEntries } = await import('../utils/marketing-calendar-policy');
    const { extractJsonObject } = await import('../utils/daily-brief-policy');
    const kstMonth = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCMonth() + 1;
    const companyCtx = await buildCompanyCalendarContext(companyId);
    const calendarInput = {
      businessType: info.business_type || null,
      brandName: info.brand_name || null,
      brandTone: info.brand_tone || null,
      customerCount: Number(cntRes.rows[0]?.n) || 0,
      currentMonth: kstMonth,
      ...companyCtx,
    };

    // 보정 요청 빌더 재사용 — 대상 달 하나만 다시 설계
    const text = await callAIWithFallback({
      system: buildCalendarSystemPrompt(),
      userMessage: buildCalendarRepairMessage(calendarInput, [month]),
      maxTokens: 1200,
      temperature: 0.5,
      model: 'opus',
      companyId,
      userId,
      source: 'marketing-calendar-month',
      creditCost: 0,
    });
    const regenerated = sanitizeCalendarEntries(extractJsonObject(text)?.entries);
    const entry = regenerated.find((e) => e.month === month);
    if (!entry) {
      return res.status(502).json({ success: false, error: '해당 달 재설계에 실패했습니다. 크레딧은 차감되지 않았습니다. 잠시 후 다시 시도해주세요.' });
    }

    await deductCreditSafe({
      companyId,
      cost,
      source: 'marketing-calendar-month',
      createdBy: userId ?? null,
      idempotencyKey: `marketing-calendar-month:${companyId}:${randomUUID()}`,
    });
    const merged = [...saved.entries.filter((e) => e.month !== month), entry].sort((a, b) => a.month - b.month);
    try {
      await saveCalendarEntries(companyId, merged);
    } catch (saveErr: any) {
      console.log('[MarketingCalendar] 한 달 재설계 저장 실패(재설계는 성공):', saveErr?.message || saveErr);
    }
    return res.json({ success: true, entry, entries: merged });
  } catch (err: any) {
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ success: false, error: 'AI 크레딧이 부족합니다.', code: 'INSUFFICIENT_CREDIT' });
    }
    console.error('[MarketingCalendar] 한 달 재설계 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '한 달 재설계 실패' });
  }
});

// ★ 2026-07-05: 저장된 마케팅 캘린더 조회 — 진입 시 로드(재생성 50크레딧 없이 이어보기) + 등록 상태.
//   registrations는 살아있는(보관 아님) 오퍼레이터만 반환 — 보관했으면 재등록 가능하도록 정직 표기.
router.get('/operator/marketing-calendar', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const { getSavedCalendar } = await import('../utils/marketing-calendar-store');
    const calendar = await getSavedCalendar(companyId);
    if (!calendar) return res.json({ success: true, calendar: null });
    const ids = Object.values(calendar.registrations);
    if (ids.length > 0) {
      const alive = await query(
        `SELECT id FROM continuous_operators WHERE company_id = $1::uuid AND id = ANY($2::uuid[]) AND status != 'archived'`,
        [companyId, ids],
      );
      const aliveSet = new Set(alive.rows.map((r: any) => String(r.id)));
      calendar.registrations = Object.fromEntries(
        Object.entries(calendar.registrations).filter(([, oid]) => aliveSet.has(String(oid))),
      );
    }
    return res.json({ success: true, calendar });
  } catch (err: any) {
    console.error('[MarketingCalendar] 조회 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '캘린더 조회 실패' });
  }
});

// ★ 2026-07-02 3단계: 오늘의 추천 브리핑 — 매일 9시 일일 분석이 저장한 최신 브리핑(회사 격리, 읽기 전용).
router.get('/operator/daily-brief', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const r = await query(
      `SELECT brief_date, headline, recommendations, created_at
         FROM company_daily_briefs
        WHERE company_id = $1::uuid
        ORDER BY brief_date DESC
        LIMIT 1`,
      [companyId],
    );
    return res.json({ success: true, brief: r.rows[0] || null });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 필요 — 운영자에게 company_daily_briefs 테이블 생성 요청이 필요합니다.',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    console.error('[Operator daily-brief GET] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

router.put('/operator/continuous/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    // 2026-06-19 (Harold 명시): 일반 사용자도 본인 회사의 자동 마케팅을 수정 가능 (operator는 회사 스코프).
    const {
      name, objective, schedule, schedule_time, status,
      schedule_day_of_week, schedule_day_of_month, schedule_month,
      budget_monthly, budget_daily, budget_alert_threshold,
      admin_phone_numbers, backup_admin_phone, admin_alert_channel,
      auto_send_lead_minutes,
      channel, benefit_content, mms_image_paths,
      sequence_enabled, sequence_delay_days, sequence_reminder_content, send_time_mode, copy_style,
      target_hint, segment_key, segment_params,
    } = req.body;
    // ★ 2026-07-12 C-2: 죽은 설정 수신 제거(delivery_policy·verification_required_days·opt_out_minutes·
    //   spam_score_threshold·max_spam_retries) — 소비 로직 0. 구클라이언트가 보내도 무시(에러 없음).
    const operator = await updateOperator(companyId, req.params.id, {
      name, objective, schedule, scheduleTime: schedule_time, status,
      scheduleDayOfWeek: schedule_day_of_week === undefined ? undefined : (schedule_day_of_week === null ? null : Number(schedule_day_of_week)),
      scheduleDayOfMonth: schedule_day_of_month === undefined ? undefined : (schedule_day_of_month === null ? null : Number(schedule_day_of_month)),
      scheduleMonth: schedule_month === undefined ? undefined : (schedule_month === null ? null : Number(schedule_month)),  // ★ 2026-07-05 yearly
      budgetMonthly: budget_monthly === undefined ? undefined : (budget_monthly === null ? null : Number(budget_monthly)),
      budgetDaily: budget_daily === undefined ? undefined : (budget_daily === null ? null : Number(budget_daily)),
      budgetAlertThreshold: budget_alert_threshold !== undefined ? Number(budget_alert_threshold) : undefined,
      adminPhoneNumbers: Array.isArray(admin_phone_numbers) ? admin_phone_numbers.filter((p: any) => typeof p === 'string' && p.trim()) : undefined,
      backupAdminPhone: backup_admin_phone === undefined ? undefined : (backup_admin_phone === null ? null : String(backup_admin_phone)),
      adminAlertChannel: ['sms', 'kakao', 'email'].includes(admin_alert_channel) ? admin_alert_channel : undefined,
      autoSendLeadMinutes: auto_send_lead_minutes !== undefined ? Number(auto_send_lead_minutes) : undefined,
      // ★ 2026-07-12 C-4: 타겟 축 — undefined = 유지, null/그 외 = 해제(CT가 화이트리스트 정규화)
      targetHint: target_hint === undefined ? undefined : (typeof target_hint === 'string' ? target_hint : null),
      // ★ 2026-08-03 A-7: 계약 — 미전송 = 유지, null/화이트리스트 밖 = 해제(옛 방식으로 되돌림)
      segmentKey: segment_key === undefined ? undefined : (typeof segment_key === 'string' ? segment_key : null),
      segmentParams: segment_params && typeof segment_params === 'object' && !Array.isArray(segment_params)
        ? (segment_params as Record<string, number>) : null,
      // ★ 2026-06-26: 발송 채널 + 관리자 입력 혜택
      channel: ['sms', 'lms', 'mms'].includes(channel) ? channel : undefined,
      // ★ 2026-07-30 (임은지 접수): MMS 이미지 — 미전송 = 유지, null = 해제, 배열 = 교체(CT가 최대 3장 정규화)
      mmsImagePaths: mms_image_paths === undefined ? undefined : (Array.isArray(mms_image_paths) ? mms_image_paths : null),
      benefitContent: typeof benefit_content === 'string' ? benefit_content : undefined,
      // ★ Phase3 C: 다단계 시퀀스
      sequenceEnabled: sequence_enabled === undefined ? undefined : (sequence_enabled === true),
      sequenceDelayDays: sequence_delay_days === undefined ? undefined : (sequence_delay_days === null ? null : Number(sequence_delay_days)),
      sequenceReminderContent: sequence_reminder_content === undefined ? undefined : (typeof sequence_reminder_content === 'string' ? sequence_reminder_content : null),
      // ★ 2026-07-02 1단계 B: 발송 시각 모드 (미전송 = 변경 없음)
      sendTimeMode: send_time_mode === undefined ? undefined : (send_time_mode === 'ai_optimal' ? 'ai_optimal' : 'fixed'),
      // ★ 2026-07-02 2단계: 문안 스타일 (미전송 = 변경 없음, null/그 외 = 해제)
      copyStyle: copy_style === undefined ? undefined : (typeof copy_style === 'string' ? copy_style : null),
    });
    if (!operator) return res.status(404).json({ success: false, error: 'Operator를 찾을 수 없습니다.' });
    return res.json({ success: true, operator });
  } catch (err: any) {
    const msg = err?.message || '';
    if (err?.code === 'DB_MIGRATION_PENDING' || err?.code === '42P01') {
      return res.status(503).json({ success: false, error: '지난번과 달라진 점을 찾는 조건은 준비 중입니다. 다른 조건으로 저장해 주세요.', code: 'DB_MIGRATION_PENDING' });
    }
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션이 필요합니다. 운영자에게 continuous_operators 컬럼 추가(ALTER)를 요청해주세요.', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[Operator continuous PUT] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '수정 실패' });
  }
});

router.delete('/operator/continuous/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    // 2026-06-19 (Harold 명시): 일반 사용자도 본인 회사의 자동 마케팅을 삭제(보관) 가능 (operator는 회사 스코프).
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

    // 1. ai_company_memory 누적 + 5 타입 분포 — ★ 2026-07-12 학습 5종 한정
    //    (전 타입 집계는 브랜드 자산 등록 회사에서 total·avg가 과대되던 혼입 결함)
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
       WHERE company_id = $1::uuid
         AND memory_type = ANY($2::text[])`,
      [companyId, LEARNING_MEMORY_TYPES],
    );
    const mem = memoryRes.rows[0] || {};

    // 2. 최근 최고 성과 패턴 5건 — ★ 2026-07-12 학습 5종 한정
    //    (무필터면 brand_guideline JSON 원문(중요도 10)이 "패턴 요약"으로 그대로 노출되던 결함)
    const topPatternsRes = await query(
      `SELECT memory_type, memory_value AS summary, importance, usage_count, updated_at
       FROM ai_company_memory
       WHERE company_id = $1::uuid AND importance >= 5
         AND memory_type = ANY($2::text[])
       ORDER BY importance DESC, usage_count DESC NULLS LAST
       LIMIT 5`,
      [companyId, LEARNING_MEMORY_TYPES],
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
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    // ★ 2026-07-09 권한: 회사 관리자 OR 본인이 만든 operator만 실행. (생성/수정/삭제는 이미 사용자 허용 — 실행만 막히던 비대칭 해소)
    const owner = await query(
      `SELECT created_by FROM continuous_operators WHERE id = $1::uuid AND company_id = $2::uuid`,
      [req.params.id, companyId]
    );
    if (owner.rows.length === 0) return res.status(404).json({ success: false, error: 'Operator를 찾을 수 없습니다.' });
    if (userType !== 'company_admin' && owner.rows[0].created_by !== userId) {
      return res.status(403).json({ success: false, error: '본인이 만든 자동마케팅만 실행할 수 있습니다.' });
    }
    const proposal = await generateProposalForOperator(req.params.id);
    if (!proposal) {
      // ★ 2026-08-05(Codex 1R): 예약 확인이 **기준선 안내보다 먼저**다. 변화 축은 첫 회차 뒤 기준선이 계속
      //   존재하므로, 순서가 반대면 이미 예약된 회차가 있어도 "비교 기준을 잡았습니다"가 나가 담당자가
      //   실제 예약을 못 본다. 생성 skip(shouldSkipProposalGeneration)과 동시 실행 차단이 이 안내로 모인다.
      //   ⛔ 조용한 0건 금지(자동마케팅 §2 불변 원칙 3) — "0건 매칭"과 "이미 예약됨"은 다른 사실이다.
      try {
        const openRes = await query(
          `SELECT 1 FROM operator_proposals
            WHERE operator_id = $1::uuid AND company_id = $2::uuid AND status = 'scheduled'
              AND COALESCE(proposal_json->'meta'->>'is_reminder', 'false') <> 'true'
            LIMIT 1`,
          [req.params.id, companyId],
        );
        if (openRes.rows.length > 0) {
          return res.json({
            success: true, proposal: null,
            message: '이미 이번 회차 발송이 예약되어 있습니다. 예약을 취소하거나 발송이 끝난 뒤 다시 실행해 주세요.',
          });
        }
      } catch { /* 안내 실패 = 아래 판정으로 */ }
      // ★ 2026-08-04: 변화 축 첫 회차는 실패가 아니라 기준을 잡은 정상 동작 — 일반 0건과 섞으면 고장으로 읽힌다.
      try {
        // 2R(#12): 회사 결합 — 소유 검증은 위에서 끝났지만 조회 축은 항상 테넌트 경계를 함께 진다.
        const opRow = await query(
          `SELECT segment_key FROM continuous_operators WHERE id = $1::uuid AND company_id = $2::uuid`,
          [req.params.id, companyId],
        );
        const segKey = String(opRow.rows[0]?.segment_key || '');
        if (segKey && segmentNeedsCycleBaseline(normalizeSegmentKey(segKey)) && (await hasCycleBaseline(req.params.id, companyId))) {
          return res.json({
            success: true, proposal: null,
            message: '비교 기준을 잡았습니다. 지난번과 달라진 고객이 생기면 다음 회차부터 대상으로 잡힙니다.',
          });
        }
      } catch { /* 안내 실패 = 일반 메시지로 */ }
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
      // ★ 2026-07-09 노출 범위: 비관리자=본인이 만든 operator의 제안만, 관리자=회사 전체.
      req.user?.userType === 'company_admin' ? null : req.user?.userId,
    );
    return res.json({ success: true, proposals });
  } catch (err: any) {
    console.error('[Proposals GET] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

// ★ 2026-07-10 [타겟확인] — 추천 카드 발송 대상 명단 (SoT: docs/superpowers/specs/2026-07-10-send-target-list-three-phase-design.md §3-1②)
//   발송 추출(dispatchProposalSend 준비부)과 동일 WHERE(안전필터+미클릭+피로도) + 동일 정렬 기준 LIMIT 100 단일 쿼리.
//   COUNT·OFFSET 없음(부하 상수화·Harold 상한 확정) — displayTotal은 proposal.recipient_count(카드 "대상 N명") 재사용.
//   SELECT 전용·크레딧 차감 없음.
router.post('/operator/proposals/:id/recipients', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });

    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: '본 기능은 요금제 가입 후 이용 가능합니다.', code: 'BETA_GATE' });
    }

    // 소유자 scope — listProposals/approve와 동일 기준(비관리자=본인 operator 제안만). 빠지면 타 담당자 고객 명단 노출.
    // ★ 2026-08-04(R1): p.operator_id를 함께 — 변화 축 컴파일이 지난 회차의 주인을 요구한다(없으면 이 화면만 500이었다).
    const pRes = await query(
      `SELECT p.proposal_json, p.recipient_count, p.status, p.operator_id, o.created_by, o.name AS operator_name
         FROM operator_proposals p
         JOIN continuous_operators o ON o.id = p.operator_id
        WHERE p.id = $1::uuid AND p.company_id = $2::uuid`,
      [req.params.id, companyId]
    );
    if (pRes.rows.length === 0) return res.status(404).json({ success: false, error: '제안서를 찾을 수 없습니다.' });
    const prow = pRes.rows[0];
    if (userType !== 'company_admin' && prow.created_by !== userId) {
      return res.status(403).json({ success: false, error: '본인이 만든 자동마케팅의 발송 대상만 확인할 수 있습니다.' });
    }

    const pj = prow.proposal_json || {};
    // dispatchProposalSend 준비부(utils/continuous-operator.ts 1380행대)와 동일 해석 — 값이 갈리면 원칙 2 위반.
    const filters = pj.target?.filters || {};
    // ⛔ 2026-08-03 1R 정정: 게이트를 손으로 조립하지 않는다 — 발송이 쓰는 해석기 하나만 쓴다
    //   (리마인드 코호트 경계가 여기 빠지면 화면 명단이 실발송보다 넓어진다).
    const gates = await resolveOperatorAudienceGates(companyId, pj);

    // ★ 2026-08-04 리마인드 명단 = 발송과 같은 코호트(Codex 1R-a — target 재컴파일이면 화면 ≠ 실발송).
    //   1차 캠페인의 실수신 성공 번호 ∩ 게이트. 1차가 종결 전이거나 명단이 비면 그 상태를 그대로 말한다.
    let reminderCohort: string[] | null = null;
    if (pj.meta?.is_reminder === true) {
      const primaryCampaignId = String(pj.meta?.primary_campaign_id || '').trim();
      const emptyReminder = (label: string) => res.json({
        success: true, recipients: [], displayTotal: 0, proposedTotal: Number(prow.recipient_count) || 0,
        criteria: pj.target?.criteria || null, segmentName: pj.target?.suggestedName || prow.operator_name || null,
        basisLabel: label, conditionColumns: [],
      });
      if (!primaryCampaignId) return emptyReminder('1차 발송 정보가 없어 대상을 확인할 수 없습니다');
      const camp = await query(
        `SELECT status, send_config, created_by, COALESCE(sent_at, scheduled_at, created_at) AS ref_date
           FROM campaigns WHERE id = $1::uuid AND company_id = $2::uuid`,
        [primaryCampaignId, companyId],
      );
      const crow = camp.rows[0];
      if (!crow || String(crow.status) !== 'completed') {
        return emptyReminder('1차 발송이 아직 완료되지 않아 리마인드 대상을 셀 수 없습니다 (완료 후 다시 확인해 주세요)');
      }
      reminderCohort = await readCampaignQueuedPhones(companyId, primaryCampaignId, crow, { successOnly: true });
      if (reminderCohort.length === 0) return emptyReminder('1차를 실제로 받은 고객이 확인되지 않았습니다');
    }

    // ⛔ 2026-08-03 7R 정정: 이 화면이 답해야 하는 것은 "이 제안이 실제로 누구에게 나가는가"다.
    //   열람자 기준이 아니라 **오퍼레이터 소유자 기준** 범위를 쓴다 — 관리자가 직원 제안을 열면 종전엔
    //   화면은 전사, 실발송은 직원 매장이라 서로 달랐다. 열람 권한은 위 소유자 검증이 이미 담당한다.
    const scope = await resolveOperatorStoreScope(companyId, prow.created_by || null);
    if (scope.blocked) {
      return res.json({
        success: true, recipients: [], displayTotal: 0, proposedTotal: Number(prow.recipient_count) || 0,
        criteria: pj.target?.criteria || null, segmentName: null,
        basisLabel: '담당 매장이 지정되지 않아 발송 대상을 정할 수 없습니다 (발송 보류)',
        conditionColumns: [],
      });
    }
    const storeFilter = scope.storeFilter;
    const baseParams: any[] = scope.baseParams;

    // ★ 2026-08-03 A-7: 발송이 쓰는 컴파일과 같은 문 — 계약 제안이면 축으로, 옛 제안이면 filters로.
    //   리마인드는 조건 컴파일이 아니라 코호트 semi-join(발송 dispatch와 같은 형태).
    let filterWhere: string;
    let filterParams: any[];
    if (reminderCohort) {
      filterWhere = `AND regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g') = ANY($${baseParams.length + 1}::text[])`;
      filterParams = [reminderCohort];
    } else {
      const compiled = await compileOperatorAudience({
        companyId,
        segmentKey: pj.target?.segmentKey || null,
        segmentParams: pj.target?.segmentParams || null,
        legacyFilters: filters,
        baseParams,
        // ★ 2026-08-04(R1): 변화 축은 이 제안의 오퍼레이터 스냅샷과 비교한다 — 발송 경로와 같은 축.
        operatorId: prow.operator_id || null,
      });
      filterWhere = compiled.filterWhere;
      filterParams = compiled.filterParams;
    }
    // 조건 필드 동적 컬럼 — FIELD_MAP 화이트리스트 + displayName 라벨 단일 소스(0709 개인화 라벨 통일 교훈).
    const conditionColumns = resolveConditionColumns(filters, FIELD_MAP);
    const { sql, params } = buildSendableRecipientsTopSql(
      filterWhere, filterParams, baseParams, storeFilter, gates, conditionColumns,
    );
    // ★ 2026-08-03 A-1: 총 수도 명단과 같은 게이트로 실측. 종전엔 제안 생성 시점 recipient_count를 그대로 보여
    //   같은 화면에서 "명단 기준 ≠ 총 수 기준"이었다(명단은 피로도 반영, 수는 미반영).
    const liveCountSql = buildAudienceCountSql(filterWhere, filterParams, baseParams, storeFilter, gates);
    const [result, liveTotalRes] = await Promise.all([
      query(sql, params),
      query(liveCountSql.sql, liveCountSql.params),
    ]);
    const liveTotal = Number(liveTotalRes.rows[0]?.count) || 0;

    // 시점 정직 라벨(원칙 1) — 승인 대기/예약(리스트화 이후)=확정 기준. 발송 직전 수신거부·피로도는 발송 시점에 또 걸러진다.
    const basisLabel = reminderCohort
      ? '1차를 받은 고객 중 클릭하지 않은 분 (지금 기준 실측 · 발송 시점 재추출)'
      : ['pending', 'scheduled', 'admin_review'].includes(String(prow.status))
        ? '발송 확정 기준 명단 (지금 기준 실측 · 발송 시점 안전필터 재반영)'
        : '예상 대상 (지금 기준 실측 · 발송 시점 재추출)';

    return res.json({
      success: true,
      recipients: result.rows,
      displayTotal: liveTotal,
      // 제안 생성 시점 수 — 지금 수와 다르면 화면이 그 차이를 그대로 보여준다(감추면 담당자가 판단을 잘못한다).
      proposedTotal: Number(prow.recipient_count) || 0,
      criteria: pj.target?.criteria || null,
      segmentName: pj.target?.suggestedName || prow.operator_name || null,
      basisLabel,
      conditionColumns: conditionColumns.map((c) => ({ key: c.key, label: c.label })),
    });
  } catch (err: any) {
    const msg = err?.message || '';
    // ★ 2026-08-04 2R(F7b): 변화 축 스냅샷 표 미생성 — 컴파일이 코드를 붙여 던진다(500 노출 금지).
    if (err?.code === 'DB_MIGRATION_PENDING' || err?.code === '42P01') {
      return res.status(503).json({ success: false, error: '지난번과 달라진 점을 찾는 조건은 준비 중입니다. 잠시 후 다시 시도해 주세요.', code: 'DB_MIGRATION_PENDING' });
    }
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — 운영자에게 customers/operator_proposals 컬럼 확인을 요청해주세요.', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[Proposals recipients] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '발송 대상 조회 실패' });
  }
});

router.post('/operator/proposals/:id/approve', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;
    if (!companyId || !userId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    // ★ 2026-07-09 권한: 회사 관리자 OR 본인이 만든 operator의 제안만 승인·발송. (조회 scope와 동일 소유 기준)
    const own = await query(
      `SELECT o.created_by FROM operator_proposals p
         JOIN continuous_operators o ON o.id = p.operator_id
        WHERE p.id = $1::uuid AND p.company_id = $2::uuid`,
      [req.params.id, companyId]
    );
    if (own.rows.length === 0) return res.status(404).json({ success: false, error: '제안서를 찾을 수 없습니다.' });
    if (userType !== 'company_admin' && own.rows[0].created_by !== userId) {
      return res.status(403).json({ success: false, error: '본인이 만든 자동마케팅만 승인·발송할 수 있습니다.' });
    }
    // ★ 발송 개시 경로 — 생성/propose와 동일 요금제 게이트. 강등 회사가 남은 pending을 수동 발송하는 구멍 차단(조회·거부·정지는 열어 둠).
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx || !isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: '본 기능은 요금제 가입 후 이용 가능합니다.', code: 'BETA_GATE' });
    }
    // ★ 2026-07-09 문안 3안: 사용자가 고른 변형 index + (편집 시) 본문/제목. 미지정이면 Bandit 추천(자동 경로 동일).
    const sel = req.body && Number.isInteger(req.body.variantIndex)
      ? {
          variantIndex: Number(req.body.variantIndex),
          body: typeof req.body.body === 'string' ? req.body.body : undefined,
          subject: typeof req.body.subject === 'string' ? req.body.subject : undefined,
        }
      : null;
    const result = await approveProposal(companyId, req.params.id, userId, sel);
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
    // ★ 2026-07-09 권한: 회사 관리자 OR 본인이 만든 operator의 제안만 거부.
    const own = await query(
      `SELECT o.created_by FROM operator_proposals p
         JOIN continuous_operators o ON o.id = p.operator_id
        WHERE p.id = $1::uuid AND p.company_id = $2::uuid`,
      [req.params.id, companyId]
    );
    if (own.rows.length === 0) return res.status(404).json({ success: false, error: '제안서를 찾을 수 없습니다.' });
    if (userType !== 'company_admin' && own.rows[0].created_by !== userId) {
      return res.status(403).json({ success: false, error: '본인이 만든 자동마케팅만 거부할 수 있습니다.' });
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

// (admin-confirm 라우트 제거 — 2026-07-12 C-2: 프론트 호출 0건 죽은 라우트, 검증 7일 게이팅 폐기분 잔재)

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
      return res.status(403).json({ success: false, error: '본 기능은 요금제 가입 후 이용 가능합니다.', code: 'BETA_GATE' });
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
    // ★ 2026-07-12 — type 미지정 시 학습 5종 한정 (비학습 타입 혼입으로 화면 "자세히 분석" 집계가 오염되던 결함).
    //   소비처 = AiMemoryPage 1곳 실측(학습 화면 전용). 특정 타입 조회는 기존 type 파라미터 그대로.
    const memories = await listCompanyMemories(
      companyId,
      memoryType ? { memoryType, limit } : { memoryTypes: LEARNING_MEMORY_TYPES, limit },
    );
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
    // ★ 2026-07-12 — 학습 5종만 허용. representative_message·brand_guideline은 구조 JSON이라 전용
    //   endpoint(/api/ai-memory/brand-voice/*)로만 저장 — 본 자유 텍스트 경로로 upsert되면 구조가 파손돼
    //   브랜드보이스 주입 전체가 조용히 소멸하는 우회 벡터였다(UI는 원래 5종만 노출).
    const validTypes: MemoryType[] = LEARNING_MEMORY_TYPES;
    if (!validTypes.includes(memory_type)) {
      return res.status(400).json({ success: false, error: `memory_type은 ${validTypes.join('/')} 중 하나여야 합니다.` });
    }
    // ★ 2026-07-12 — 서버 길이 가드(UI 2000자와 동일 기준). 무제한 저장 = 매 AI 호출 프롬프트 토큰 폭증.
    if (String(memory_value).length > 2000) {
      return res.status(400).json({ success: false, error: '상세 내용은 2000자 이내로 입력해주세요.' });
    }
    // ★ Codex 1R (2026-07-12) — source는 서버가 강제. 클라이언트가 'ai_auto'로 위장하면 워커의
    //   자동 생성분 정리(stale grade DELETE 등) 대상이 되는 신뢰 경계 구멍이었다.
    void source;
    const entry = await addCompanyMemory({
      companyId,
      memoryType: memory_type,
      memoryKey: String(memory_key),
      memoryValue: String(memory_value),
      importance: importance ? Number(importance) : undefined,
      source: 'admin_input',
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
      return res.status(403).json({ success: false, error: '본 기능은 요금제 가입 후 이용 가능합니다.', code: 'BETA_GATE' });
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

// GET /api/ai/operator/journeys-opportunities — "오늘의 여정 기회" (회사 실데이터 집계, AI 호출 없음)
router.get('/operator/journeys-opportunities', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }

    const opportunities = await buildJourneyOpportunities(companyId);
    return res.json({ success: true, opportunities });
  } catch (err: any) {
    // DB 마이그레이션 미실행(신규 CDP 컬럼 부재) 케이스 — 503 + 친화 안내 (db_alter_safety_net)
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: '데이터 준비 중입니다. 잠시 후 다시 시도해주세요.', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[Journeys opportunities] 오류:', err);
    // 기회 카드는 보조 기능 — 실패해도 빈 배열로 페이지 정상 동작
    return res.json({ success: true, opportunities: [] });
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
      goalExitEnabled,
      // ★ 2026-06-30 여정 일반화 — 시작 방식(start_kind) + 트리거/대상 + 날짜축/one_shot.
      startKind,
      triggerEvent,
      triggerFilters,
      anchorDate,
      anchorRecurrence,
      anchorRecurrenceDay,
      anchorHourKst,
      oneShotScheduledAt,
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
      goalExitEnabled: goalExitEnabled === true,
      startKind,
      triggerEvent,
      triggerFilters,
      anchorDate,
      anchorRecurrence,
      anchorRecurrenceDay,
      anchorHourKst,
      oneShotScheduledAt,
    });

    const detail = await getJourneyDetail(companyId, journeyId);
    return res.status(201).json({ success: true, journeyId, detail });
  } catch (err: any) {
    // ★ db_alter_safety_net — start_kind/anchor_* 등 신규 컬럼 미마이그레이션 시 503 + 운영자 안내(500 노출 X).
    const cm = err?.message || '';
    if (cm.includes('column') && cm.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — 운영자에게 journeys/journey_steps 여정 일반화 ALTER 실행 요청 의무', code: 'DB_MIGRATION_PENDING' });
    }
    if (err instanceof JourneyStepGateError) {
      return res.status(409).json({ success: false, error: err.message, code: err.code });
    }
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
// ★ 2026-06-22 Phase 6 (가): 실발송 미리보기 — 발송 함수(replaceVariables)로 회사 대표 고객 치환 = 미리보기 = 실발송 100% 일치
router.post('/operator/journeys/preview-message', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const { journeyId, message, subject, isAd, channel } = req.body as { journeyId?: string; message?: string; subject?: string; isAd?: boolean; channel?: string };
    if (!message) return res.json({ success: true, previewMessage: '', previewSubject: '', hasSample: false, sampleName: null });

    const companyRow = await query('SELECT customer_schema FROM companies WHERE id = $1::uuid', [companyId]);
    const { fieldMappings } = extractVarCatalog(companyRow.rows[0]?.customer_schema);

    // ★ 추출된 발송 대상(여정 타겟 세그먼트) 중 상위 고객 1명으로 치환 = 실발송 미리보기 (회사 전체 아무나 X)
    let sampleRaw: Record<string, any> | null = null;
    if (journeyId) {
      const jrow = await query('SELECT trigger_event, trigger_filters FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid', [journeyId, companyId]);
      const j = jrow.rows[0];
      if (j?.trigger_event) {
        try {
          const ids = await selectJourneyTargetCustomerIds(companyId, j.trigger_event, j.trigger_filters || {}, 50);
          if (ids.length > 0) {
            const cr = await query(
              `SELECT name, gender, age, grade, points, email, address,
                      recent_purchase_store, registered_store, registration_type,
                      store_phone, store_name, store_code, region,
                      recent_purchase_amount, total_purchase_amount, purchase_count,
                      birth_date, recent_purchase_date, custom_fields
               FROM customers
               WHERE company_id = $1::uuid AND id = ANY($2::uuid[])
               ORDER BY recent_purchase_amount DESC NULLS LAST, total_purchase_amount DESC NULLS LAST LIMIT 1`,
              [companyId, ids]
            );
            if (cr.rows[0]) {
              const sr: Record<string, any> = { ...cr.rows[0] };
              for (const fk of Object.keys(FIELD_DISPLAY_MAP)) {
                if (sr[fk] != null) sr[fk] = reverseDisplayValue(fk, sr[fk]);
              }
              sampleRaw = sr;
            }
          }
        } catch { /* 타겟 추출 실패 시 sampleRaw null → hasSample false (미리보기는 변수명/대체값으로) */ }
      }
    }

    // 표준 대체값 (Phase 1) — 빈 변수 시 발송과 동일하게 채워 줄 누락 방지
    const fieldDefaults: Record<string, string> = {};
    for (const [varName, m] of Object.entries(fieldMappings)) {
      const fb = STANDARD_FIELD_FALLBACKS[(m as { column: string }).column];
      if (fb) fieldDefaults[varName] = fb;
    }

    let previewMessage = replaceVariables(message, sampleRaw, fieldMappings, undefined, { fieldDefaults });
    let previewSubject = subject ? replaceVariables(subject, sampleRaw, fieldMappings, undefined, { fieldDefaults }) : '';

    // ★ 2026-06-23: 미리보기 = 실발송 100% 일치 — 발송과 동일하게 (광고)+무료수신거부 본문 합성.
    //   비카카오 여정은 무조건 광고(resolveJourneyAdFlag) → buildAdMessage가 발송(journey-executor)과 동일 합성.
    //   카카오(알림톡)는 정보성이라 합성하지 않음. 이전엔 변수 치환만 해 본문에 (광고)가 빠져 보이던 문제.
    const previewChannel = String(channel || 'lms').toLowerCase();
    if (previewChannel !== 'kakao') {
      const previewMsgType = previewChannel === 'lms' ? 'LMS' : previewChannel === 'mms' ? 'MMS' : 'SMS';
      const previewAdFlag = resolveJourneyAdFlag(channel, isAd);
      const previewOpt080 = await getOpt080Number(req.user?.userId || null, companyId);
      previewMessage = buildAdMessage(previewMessage, previewMsgType, previewAdFlag, previewOpt080);
      previewSubject = buildAdSubject(previewSubject, previewMsgType, previewAdFlag);
    }

    return res.json({
      success: true,
      previewMessage,
      previewSubject,
      sampleName: sampleRaw?.name ? String(sampleRaw.name) : null,
      hasSample: !!sampleRaw,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || '미리보기 생성 실패' });
  }
});

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
        `SELECT status, last_pretest_passed_at, start_kind, callback_mode, trigger_event, trigger_filters FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`,
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

    // ★ 매장번호 발송(store 모드) 미등록 회신번호 pre-flight — 미등록이 있으면 확인 모달 요청(활성화 보류).
    //   실제 발송 시 실행기가 미등록 store_phone을 자동 실패 처리하므로, 활성화 전 사용자에게 실패 예정 인원 고지.
    const confirmCbExcl = !!(req.body && (req.body as any).confirmCallbackExclusion);
    if (stRow.rows[0].callback_mode === 'store' && stRow.rows[0].trigger_event && !confirmCbExcl) {
      try {
        const cbIds = await selectJourneyTargetCustomerIds(companyId, stRow.rows[0].trigger_event, stRow.rows[0].trigger_filters || {}, 1000);
        if (cbIds.length > 0) {
          const cbCust = await query(
            `SELECT store_phone, callback, custom_fields FROM customers WHERE company_id = $1::uuid AND id = ANY($2::uuid[])`,
            [companyId, cbIds]
          );
          const cbResult = await filterByIndividualCallback(cbCust.rows, companyId, userId, 'store_phone');
          if (cbResult.callbackUnregisteredCount > 0) {
            return res.json({
              success: false,
              callbackConfirmRequired: true,
              callbackUnregisteredCount: cbResult.callbackUnregisteredCount,
              unregisteredDetails: cbResult.unregisteredDetails,
              message: `매장번호가 등록 발신번호가 아닌 고객 ${cbResult.callbackUnregisteredCount}명은 발송이 자동 실패 처리됩니다. 계속 활성화할까요?`,
            });
          }
        }
      } catch (cbErr: any) {
        console.warn('[Journeys activate] 미등록 회신번호 pre-flight 검증 실패(무시):', cbErr?.message);
      }
    }

    const firstActivation = stRow.rows[0].status === 'draft';
    if (firstActivation) await checkCredit(companyId, getCreditCost('journey-activate'));

    const result = await activateJourney(companyId, req.params.id, userId);
    if (!result.ok) return res.status(400).json({ success: false, error: result.reason || '활성화 실패' });

    // ★ 2026-06-30 여정 일반화 — one_shot은 최초 활성 시 대상군에 1회 단발 발송 enqueue(즉시/예약).
    //   firstActivation 1회만(멱등: dispatchOneShotJourney가 execution 존재 시 skip). 발송·돈 영향 격리(try-catch).
    if (firstActivation && String(stRow.rows[0].start_kind) === 'one_shot') {
      try {
        const dr = await dispatchOneShotJourney(companyId, req.params.id);
        console.log(`[Journeys activate] one_shot dispatch journey=${req.params.id} enqueued=${dr.enqueued} reason=${dr.reason || ''}`);
      } catch (dispErr: any) {
        console.error('[Journeys activate] one_shot dispatch 실패:', dispErr?.message);
      }
    }

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
      allowActiveMessageEdit,
    } = req.body || {};
    // ★ 2026-07-27: 알림톡 전환재발송 검증은 updateJourneyStep 안에서 기존값과 병합한 최종 상태로 한다.
    //   여기서 요청값만 보고 판정하면, 제목만 ''로 보내는 요청은 검증을 건너뛰고 타입만 보내는 요청은
    //   멀쩡한 저장값이 있어도 거부된다(Codex 3R 지적). 위반은 AlimtalkFallbackError로 올라와 아래 catch가 400으로 돌린다.
    const ok = await updateJourneyStep(companyId, req.params.id, req.params.stepId, {
      allowActiveMessageEdit: allowActiveMessageEdit === true,
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
    // ★ 2026-07-27: 전환재발송 규칙 위반은 입력 오류라 400으로 돌린다(500 = 서버 결함으로 오인).
    if (err instanceof AlimtalkFallbackError) {
      return res.status(400).json({ success: false, error: err.message });
    }
    if (err instanceof JourneyStepGateError) {
      return res.status(409).json({ success: false, error: err.message, code: err.code });
    }
    console.error('[Journeys update step] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'step 수정 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// ★ 2026-08-02 §13-1 — 저장 후 스텝 추가·삭제
//   스텝을 늘려 가며 쓰는 화면(설계서 §6-3)의 선행. 크레딧 0 — 200은 최초 활성화 1회다(§7).
//   판정·재번호는 전부 CT(journey-builder)가 소유한다. 여기서 SQL을 쓰지 않는다.
// ════════════════════════════════════════════════════════════════════

// POST /api/ai/operator/journeys/:id/steps — step 추가 (맨 뒤)
router.post('/operator/journeys/:id/steps', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const {
      stepType, delayHours, channel, messageTemplate, subject, isAd, conditionJsonb,
      alimtalkProfileId, alimtalkTemplateCode, alimtalkVariableMap,
      alimtalkNextType, alimtalkNextContents, alimtalkNextSubject,
      mmsImagePaths, delayMode, targetHourKst, anchorOffsetDays,
      notMetGoto, waitEventName, waitTimeoutHours,
    } = req.body || {};

    const result = await addJourneyStep(companyId, req.params.id, {
      stepType: stepType || 'message',
      delayHours: delayHours != null ? Number(delayHours) : 0,
      channel,
      messageTemplate,
      subject,
      isAd,
      conditionJsonb,
      alimtalkProfileId,
      alimtalkTemplateCode,
      alimtalkVariableMap,
      alimtalkNextType,
      alimtalkNextContents,
      alimtalkNextSubject,
      mmsImagePaths,
      delayMode,
      targetHourKst: targetHourKst != null ? Number(targetHourKst) : undefined,
      anchorOffsetDays: anchorOffsetDays != null ? Number(anchorOffsetDays) : undefined,
      notMetGoto,
      waitEventName,
      waitTimeoutHours: waitTimeoutHours != null ? Number(waitTimeoutHours) : undefined,
    });
    if (!result) return res.status(404).json({ success: false, error: '여정을 찾을 수 없거나 수정 권한이 없습니다.' });
    return res.json({ success: true, stepId: result.stepId, stepOrder: result.stepOrder });
  } catch (err: any) {
    if (err instanceof JourneyStepGateError) {
      return res.status(409).json({ success: false, error: err.message, code: err.code });
    }
    const msg = String(err?.message || '');
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — journey_steps ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[Journeys add step] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'step 추가 실패' });
  }
});

// DELETE /api/ai/operator/journeys/:id/steps/:stepId — step 삭제 + 재번호
router.delete('/operator/journeys/:id/steps/:stepId', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const result = await deleteJourneyStep(companyId, req.params.id, req.params.stepId);
    if (!result) return res.status(404).json({ success: false, error: 'step을 찾을 수 없거나 수정 권한이 없습니다.' });
    return res.json({ success: true, deletedOrder: result.deletedOrder, renumbered: result.renumbered });
  } catch (err: any) {
    // 게이트(마지막 스텝·발송 이력·진행 중 고객)는 상태 문제라 409 — 사유가 화면에 그대로 나간다.
    if (err instanceof JourneyStepGateError) {
      return res.status(409).json({ success: false, error: err.message, code: err.code });
    }
    const msg = String(err?.message || '');
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — journey_steps ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[Journeys delete step] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'step 삭제 실패' });
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
    // ⛔ 2026-08-02 — 여정만 회사로 검증하고 stepId는 안 보던 구멍(쓰기와 같은 부류의 읽기 판).
    //   URL의 journeyId가 내 것이어도 stepId가 남의 것이면 **다른 회사 변이 본문이 읽힌다.**
    //   대상 자원 자체를 소유 사슬(step → journey → company)로 확인한다.
    const j = await query(
      `SELECT 1 FROM journey_steps s
         INNER JOIN journeys j ON j.id = s.journey_id
        WHERE s.id = $1::uuid AND j.id = $2::uuid AND j.company_id = $3::uuid`,
      [req.params.stepId, req.params.journeyId, companyId]
    );
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
      companyId,
      journeyId: req.params.journeyId,
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

// ★ 2026-07-11 여정 [타겟확인] — 발송 추출과 동일 함수로 "지금 조건 매칭 표본" LIMIT 100 명단.
//   (0710 자동마케팅 [타겟확인]과 동일 계약: 1회 로드 → 클라 페이징, 시점 정직 라벨.)
//   기존 검증 컬럼만 사용(journeys.trigger_event/trigger_filters/start_kind · customers 표시 필드) — 신규 컬럼 0.
router.post('/operator/journeys/:id/target-recipients', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }

    const jr = await query(
      `SELECT name, trigger_event, trigger_filters, start_kind FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`,
      [req.params.id, companyId]
    );
    if (jr.rows.length === 0) return res.status(404).json({ success: false, error: '여정을 찾을 수 없습니다.' });
    const journeyRow = jr.rows[0];
    const triggerEvent = String(journeyRow.trigger_event || '');
    const triggerFilters = journeyRow.trigger_filters || {};
    const startKind = normalizeStartKind(journeyRow.start_kind);

    // 추출 — 발송과 동일 함수(자동완화 X). date_anchor는 앵커 대상 함수, 그 외는 트리거 추출.
    let ids: string[] = [];
    let displayTotal = 0;
    let capped = false;
    if (startKind === 'date_anchor') {
      ids = await selectAnchorAudienceIds(companyId, triggerFilters, 100);
      // 앵커 대상 전용 count 헬퍼 없음 — 10,000 상한 실측(정직 표기)
      const totalProbe = await selectAnchorAudienceIds(companyId, triggerFilters, 10001);
      capped = totalProbe.length > 10000;
      displayTotal = capped ? 10000 : totalProbe.length;
    } else {
      ids = await selectJourneyTargetCustomerIds(companyId, triggerEvent, triggerFilters, 100, req.params.id);
      const cnt = await countJourneyTargetCustomers(companyId, triggerEvent, triggerFilters, req.params.id);
      displayTotal = cnt.total;
      capped = cnt.capped;
    }

    let recipients: any[] = [];
    if (ids.length > 0) {
      const rowsRes = await query(
        `SELECT name, phone, grade, gender, region, age, points, recent_purchase_date
           FROM customers
          WHERE company_id = $1::uuid AND id = ANY($2::uuid[])
          ORDER BY array_position($2::uuid[], id)`,
        [companyId, ids]
      );
      recipients = rowsRes.rows.map((r: any) => ({
        name: r.name || null,
        phone: r.phone || null,
        grade: r.grade || null,
        gender: r.gender || null,
        region: r.region || null,
        age: r.age != null ? Number(r.age) : null,
        points: r.points != null ? Number(r.points).toLocaleString() : null,
        recent_purchase: r.recent_purchase_date
          ? new Date(r.recent_purchase_date).toLocaleDateString('ko-KR')
          : null,
      }));
    }

    return res.json({
      success: true,
      recipients,
      displayTotal,
      capped,
      criteria: describeJourneyTrigger(triggerEvent, triggerFilters),
      journeyName: journeyRow.name || null,
      basisLabel: '발송 추출과 동일 함수 실측 — 실제 진입·발송은 트리거 발생/스케줄 시점 기준',
      conditionColumns: [
        { key: 'points', label: '포인트' },
        { key: 'recent_purchase', label: '최근구매일' },
      ],
    });
  } catch (err: any) {
    console.error('[Journeys target-recipients] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '발송 대상 조회 실패' });
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
    const body = req.body || {};
    if (cur.rows[0].status !== 'draft' && cur.rows[0].status !== 'paused') {
      // ★ 2026-07-10 목표 달성 자동 종료 토글만 운영(active) 중에도 변경 허용 — 발송을 줄이는 안전 방향.
      //   그 외 옵션(타이밍·한도·예산·재진입·회신)은 기존 규칙 유지(일시정지 후 편집).
      const keys = Object.keys(body);
      // ★ 2026-07-11: 목표 종류(goalKind)도 운영 중 변경 허용 — 목표 축 키 2종만이면 통과(그 외 옵션은 기존 규칙).
      const onlyGoalToggle = cur.rows[0].status === 'active' && keys.length > 0 && keys.every((k) => k === 'goalExitEnabled' || k === 'goalKind');
      if (!onlyGoalToggle) {
        return res.status(400).json({ success: false, error: '운영 중인 여정은 옵션을 바꿀 수 없습니다. 먼저 일시정지해 주세요. (목표 달성 자동 종료는 운영 중에도 변경 가능)' });
      }
    }

    const norm = normalizeJourneyOptions(body);

    const params: any[] = [req.params.id, companyId];
    const sets: string[] = [];
    const add = (col: string, val: any) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    // trigger_filters는 기존 jsonb에 병합(customer_conditions/logic 등 보존, 정규화된 키만 덮어씀).
    // ⛔ 2026-08-02 Codex 5R — **DB 안에서 병합**하고, 필터 키가 온 요청에서만 건드린다.
    //   옛 코드는 트랜잭션 밖에서 읽은 JSON을 통째로 다시 썼다. 상한만 저장하는 요청과 다른 탭의
    //   휴면일수·포인트 임계 편집이 겹치면 둘 다 같은 옛 JSON을 읽고 **나중 요청이 앞 요청의 필터를 되돌린다**
    //   (그 뒤 모달이 되돌아간 필터로 재검증·활성화해 의도보다 넓은 고객군에 나간다).
    if (Object.keys(norm.triggerFilters || {}).length > 0) {
      params.push(JSON.stringify(norm.triggerFilters));
      sets.push(`trigger_filters = COALESCE(trigger_filters, '{}'::jsonb) || $${params.length}::jsonb`);
    }

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
    if ('goalExitEnabled' in body) add('goal_exit_enabled', norm.options.goalExitEnabled);  // 실측 컬럼(2026-07-10 DDL 실행 확인)
    // ★ 2026-07-11 신규 컬럼(goal_kind·holdout_pct·personal_send_time) — DDL 실행 전이면 UPDATE가 42703 → catch의 DB_MIGRATION_PENDING 503 (기존 가드)
    if ('goalKind' in body) add('goal_kind', norm.options.goalKind);
    if ('holdoutPct' in body) add('holdout_pct', norm.options.holdoutPct);
    if ('personalSendTime' in body) add('personal_send_time', norm.options.personalSendTime);

    // ⛔ 2026-08-02 Codex 3R — **검증 입력을 바꾸는 옵션 변경은 사전검사 통과를 무효로 만든다.**
    //   회신번호·상한·재진입을 검증 통과 뒤에 바꾸면, 활성화는 마커가 남아 있어 그대로 켜진다 —
    //   검사받지 않은 구성으로 발송이 시작된다. 목표 자동 종료 토글 2종만 예외다(운영 중에도 허용되는,
    //   발송을 줄이는 방향의 값이라 문안 검증 결과를 바꾸지 않는다).
    const bodyKeys = Object.keys(body || {});
    const onlyGoalKeys = bodyKeys.length > 0 && bodyKeys.every((k) => k === 'goalExitEnabled' || k === 'goalKind');
    if (!onlyGoalKeys) sets.push('last_pretest_passed_at = NULL');

    sets.push('updated_at = NOW()');

    // ★ 2026-08-01 Codex 5R — 읽은 status를 쓰기 조건으로 건다(낙관적 동시성).
    //   status를 읽고 검증한 뒤 조건 없이 쓰면, 그 사이 활성화가 성사됐을 때
    //   **활성 여정의 수신자 상한을 비울 수 있다**. 그러면 워커가 상한 검사를 건너뛴다.
    params.push(cur.rows[0].status);
    const r = await query(
      `UPDATE journeys SET ${sets.join(', ')}
        WHERE id = $1::uuid AND company_id = $2::uuid AND status = $${params.length}
        RETURNING id`,
      params
    );
    if (r.rows.length === 0) {
      return res.status(409).json({ success: false, error: '여정 상태가 방금 바뀌었습니다. 새로고침 후 다시 시도해 주세요.', code: 'JOURNEY_STATE_CHANGED' });
    }
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

// GET /api/ai/operator/journeys-data-capability — 이 회사가 지금 만들 수 있는 여정 (2026-08-01, 설계서 §2-3)
//   우리는 정답표를 갖지 않는다. 고객사가 준 데이터로 판정하고, 못 만드는 트리거는 숨기지 않고 사유와 함께 잠근다.
//   지금은 만들어지고 켜지고 0건으로 도는데, 고객사는 켜 뒀다고 믿고 우리는 아무것도 안 보낸다 — 그게 제일 나쁘다.
router.get('/operator/journeys-data-capability', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const list = resolveTriggerAvailability(await getCompanyJourneyFacts(companyId));
    // ★ 2026-08-02 §13-5 — 매장 구매 정책을 화면이 말하려면 어느 문이 진실인지와 마지막 도착 시각이 필요하다.
    //   조회가 실패해도 가능 여부 판정까지 막지 않는다(문구가 빠질 뿐이다).
    const purchaseDoor = await getPurchaseDoorStatus(companyId).catch(() => null);
    return res.json({ success: true, triggers: toAvailabilityMap(list), anyAvailable: hasAnyAvailableTrigger(list), purchaseDoor });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션이 필요합니다 — 운영자에게 확인을 요청해 주세요.', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[Journeys data capability] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '여정 가능 여부 조회 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// ★ 2026-08-02 등급 서열 — 회사가 한 번 확인하는 설정. 확인 전에는 등급 트리거가 잠긴다.
//   ⛔ 값 목록은 그 회사 고객 데이터에서 뽑는다. 우리가 등급 사전을 갖지 않는다.
// ════════════════════════════════════════════════════════════════════

// GET /api/ai/operator/grade-ranks — 이 회사 등급 값 + 저장된 순서
router.get('/operator/grade-ranks', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const values = await listCompanyGradeValues(companyId);
    // configured = 저장한 적이 있는가 / confirmed = 상승 판정이 가능한가.
    // ⛔ 둘은 다르다 — "전부 순서 없음"으로 저장한 회사는 configured이지만 confirmed는 아니다.
    //   화면이 이 둘을 구분하지 못하면 저장한 상태를 못 복원하고 매번 초안으로 되돌아간다.
    const [configured, confirmed] = await Promise.all([
      hasGradeOrderConfig(companyId),
      hasUsableGradeOrder(companyId),
    ]);
    return res.json({ success: true, values, configured, confirmed });
  } catch (err: any) {
    const msg = err?.message || '';
    if (err?.code === '42P01' || (msg.includes('relation') && msg.includes('does not exist'))) {
      return res.status(503).json({ success: false, error: '등급 순서 설정을 준비 중입니다. 잠시 후 다시 시도해 주세요.', code: 'DB_MIGRATION_PENDING' });
    }
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요 — 운영자에게 customer_grade_ranks 생성 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[Grade ranks get] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '등급 순서 조회 실패' });
  }
});

// PUT /api/ai/operator/grade-ranks — 순서 저장(사람이 확인한 것만 믿는다)
router.put('/operator/grade-ranks', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const rows = Array.isArray(req.body?.ranks) ? req.body.ranks : null;
    if (!rows) return res.status(400).json({ success: false, error: '등급 순서를 보내주세요.' });

    // ⛔ 그 회사에 실제로 있는 값만 저장한다 — 없는 값을 넣으면 판정 표가 데이터와 어긋난다.
    const actual = new Set((await listCompanyGradeValues(companyId)).map((v) => v.gradeValue));
    const filtered = rows
      .map((x: any) => ({
        gradeValue: String(x?.gradeValue || '').trim(),
        rankOrder: x?.rankOrder == null ? null : Number(x.rankOrder),
      }))
      .filter((x: any) => actual.has(x.gradeValue));

    const { saved } = await saveGradeRanks(companyId, userId || null, filtered);
    return res.json({ success: true, saved, confirmed: await hasUsableGradeOrder(companyId) });
  } catch (err: any) {
    const msg = err?.message || '';
    if (err?.code === '42P01' || (msg.includes('relation') && msg.includes('does not exist'))) {
      return res.status(503).json({ success: false, error: '등급 순서 설정을 준비 중입니다. 잠시 후 다시 시도해 주세요.', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[Grade ranks put] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '등급 순서 저장 실패' });
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

// POST /api/ai/operator/journeys-refine-step — AI 문안 다듬기
//   D187-fix3: refineDirectMessage → refineStepMessage (시즌 + 회사 메모리 + 톤 다양성)
//   ★ 2026-08-08: 후보 수는 호출부가 정한다 — `variants: 1`(스튜디오 = 비포/애프터 한 쌍) / 미지정 = 3안(날짜축 등 옛 흐름)
router.post('/operator/journeys-refine-step', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    // ★ 2026-08-02 §13-3: 본문이 비어도 **여정 맥락이 있으면** 생성 모드로 간다.
    //   옛 흐름은 사람이 먼저 열 글자를 써야 AI를 부를 수 있었다(추가 입력 요구 = 1클릭 원칙 위반).
    //   맥락도 본문도 없을 때만 거절한다 — 지어낼 근거가 없기 때문이다.
    const { message, channel, isAd, stepIntent, journey, variants } = req.body || {};
    const body = message != null ? String(message) : '';
    const jc = journey && typeof journey === 'object' ? journey : undefined;
    const hasContext = !!jc && (!!jc.triggerLabel || !!jc.objective || (Array.isArray(jc.previousMessages) && jc.previousMessages.length > 0));
    if (!body.trim() && !hasContext) {
      return res.status(400).json({ success: false, error: '메시지 본문이 비어있습니다.' });
    }
    const ch = ['sms', 'lms', 'mms'].includes(channel) ? channel : 'lms';
    const { candidates } = await refineStepMessage({
      companyId,
      currentMessage: body,
      channel: ch,
      isAd: isAd !== false,
      stepIntent: stepIntent ? String(stepIntent) : undefined,
      // ★ 2026-08-08 — 화면이 비포/애프터 한 쌍으로 보여 주면 안은 하나면 된다. 미지정이면 옛 흐름(3안).
      variants: Number(variants) === 1 ? 1 : 3,
      journey: jc
        ? {
            triggerLabel: jc.triggerLabel ? String(jc.triggerLabel).slice(0, 100) : undefined,
            objective: jc.objective ? String(jc.objective).slice(0, 300) : undefined,
            stepOrder: jc.stepOrder != null ? Number(jc.stepOrder) : undefined,
            hoursFromTrigger: jc.hoursFromTrigger != null ? Number(jc.hoursFromTrigger) : undefined,
            previousMessages: Array.isArray(jc.previousMessages)
              ? jc.previousMessages.slice(0, 6).map((p: any) => ({
                  stepOrder: Number(p?.stepOrder) || 0,
                  hoursFromTrigger: Number(p?.hoursFromTrigger) || 0,
                  message: String(p?.message || '').slice(0, 400),
                }))
              : undefined,
          }
        : undefined,
    });
    return res.json({ success: true, candidates, mode: body.trim() ? 'refine' : 'create' });
  } catch (err: any) {
    console.error('[Journeys refine step] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'AI 다듬기 실패' });
  }
});

// POST /api/ai/operator/journeys-suggest-trigger — 알림톡 템플릿 → 트리거 제안 (2026-07-28)
//   알림톡은 승인 템플릿이 본체라 AI가 문안을 지을 수 없다. 방향을 뒤집어, 고른 템플릿 본문을 읽고
//   "언제 보낼지"만 고르게 한다. 후보는 프론트가 템플릿 변수 호환으로 이미 걸러 보낸 목록이고,
//   그 목록 밖 값은 CT가 버린다(트리거 = 발송 대상이라 지어낸 값이 채택되면 안 된다).
//   제안일 뿐 저장이 아니다 — 사용자가 검토 화면에서 확인한 뒤에야 여정이 만들어진다.
router.post('/operator/journeys-suggest-trigger', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const { templateName, templateContent, candidates } = req.body || {};
    if (!templateContent || !String(templateContent).trim()) {
      return res.status(400).json({ success: false, error: '템플릿을 먼저 선택해주세요.' });
    }
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ success: false, error: '고를 수 있는 트리거가 없습니다.' });
    }
    const suggestion = await suggestJourneyTrigger({
      companyId,
      templateName: String(templateName || ''),
      templateContent: String(templateContent),
      candidates: candidates
        .filter((c: any) => c && c.key)
        .map((c: any) => ({ key: String(c.key), label: String(c.label || ''), desc: String(c.desc || '') })),
    });
    // 판단이 안 서면 제안하지 않는다 — 억지로 고른 트리거가 발송 대상이 되는 것보다 낫다.
    return res.json({ success: true, suggestion });
  } catch (err: any) {
    console.error('[Journeys suggest trigger] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '트리거 제안 실패' });
  }
});

// ★ 2026-06-30 여정 일반화 SP-B — 자연어 목표 → 날짜축 여정 자동 생성(스텝 일괄).
//   "7일전 3일전 당일"을 파싱해 D-7/D-3/D-0 스텝 + 각 LMS 문안을 자동 작성. 문안 1건당 1크레딧(생성 스텝 수만큼).
router.post('/operator/journeys/anchor-generate-plan', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const { objective } = req.body || {};
    if (!objective || String(objective).trim().length < 3) {
      return res.status(400).json({ success: false, error: '무엇을 알릴지 목표를 입력해주세요.' });
    }
    const { steps } = await generateAnchorJourneyPlan({ companyId, objective: String(objective) });
    if (steps.length === 0) {
      return res.status(502).json({ success: false, error: 'AI 자동 생성에 실패했습니다. 잠시 후 다시 시도해주세요.' });
    }
    return res.json({ success: true, steps });
  } catch (err: any) {
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ success: false, error: '자동 생성에 필요한 크레딧이 부족합니다. 크레딧을 충전해 주세요.', code: 'INSUFFICIENT_CREDIT' });
    }
    console.error('[Journeys anchor plan] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'AI 자동 생성 실패' });
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
    const { objective, templateHint, preferTriggerEvent, benefitText } = req.body || {};
    // ★ 2026-08-08 이어달리기 — 프리셋만 온 경로(다음 수 카드)는 목표 골격을 서버가 파생한다(클릭 1회).
    if ((!objective || !String(objective).trim()) && !templateHint && !preferTriggerEvent) {
      return res.status(400).json({ success: false, error: '자연어 목표 또는 템플릿 단축 진입 중 하나는 필수입니다.' });
    }
    // ★ 2026-08-08 이어달리기 — 추천 카드가 약속한 트리거. 등록·구현된 값만 받는다(fail-closed).
    //   여기서 거르지 않으면 만들 수 없는 트리거로 초안이 만들어지고 저장·활성화에서야 막힌다.
    if (preferTriggerEvent && !isImplementedTriggerEvent(String(preferTriggerEvent))) {
      return res.status(400).json({ success: false, error: '지원하지 않는 발송 조건입니다. 트리거를 다시 선택해 주세요.' });
    }
    const pkg = await generateJourneyPackage({
      companyId,
      createdBy: userId,
      objective: objective ? String(objective) : undefined,
      templateHint: templateHint || undefined,
      preferTriggerEvent: preferTriggerEvent ? String(preferTriggerEvent) : undefined,
      benefitText: benefitText ? String(benefitText) : undefined,   // 상한·정규화는 생성기가 한다
    });
    return res.json({ success: true, package: pkg });
  } catch (err: any) {
    console.error('[Journeys AI generate] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'AI 생성 실패' });
  }
});

// POST /api/ai/operator/journeys-ai-edit — 대화형 여정 수정 (초안 패키지에 자연어 수정 반영)
router.post('/operator/journeys-ai-edit', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const { package: currentPackage, instruction } = req.body || {};
    if (!currentPackage || !Array.isArray(currentPackage.steps)) {
      return res.status(400).json({ success: false, error: '수정할 여정 패키지가 없습니다.' });
    }
    if (!instruction || String(instruction).trim().length < 2) {
      return res.status(400).json({ success: false, error: '수정 요청 문구를 입력해주세요.' });
    }
    const pkg = await editJourneyPackage({ companyId, currentPackage, instruction: String(instruction) });
    return res.json({ success: true, package: pkg });
  } catch (err: any) {
    console.error('[Journeys AI edit] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'AI 수정 실패' });
  }
});

// POST /api/ai/operator/decorate-message — AI 꾸미기 (추천 메시지에 선택 컬럼 %변수% 녹임)
router.post('/operator/decorate-message', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const { message, messages, selectedVars, channel, isAd } = req.body || {};
    const list: string[] = Array.isArray(messages)
      ? messages.map((m: any) => String(m || ''))
      : (message ? [String(message)] : []);
    if (list.length === 0 || list.some((m) => m.trim().length < 5)) {
      return res.status(400).json({ success: false, error: '꾸밀 메시지가 너무 짧습니다.' });
    }
    if (!Array.isArray(selectedVars) || selectedVars.length === 0) {
      return res.status(400).json({ success: false, error: '활용할 컬럼을 1개 이상 선택해주세요.' });
    }
    // 꾸미기 1회(여러 변형 일괄) = 단일 AI 호출 = 3크레딧(액션 단위, 변형당 차감 X)
    const decoratedList = await decorateOperatorMessages({
      companyId,
      messages: list,
      selectedVars: selectedVars.map((v: any) => String(v)),
      channel: ['sms', 'lms', 'mms'].includes(channel) ? channel : 'lms',
      isAd: !!isAd,
      userId: userId || undefined,
    });
    return res.json({ success: true, messages: decoratedList, message: decoratedList[0] });
  } catch (err: any) {
    console.error('[Operator decorate] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || 'AI 꾸미기 실패' });
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

    // ★ 2026-08-02 Codex 2R — 검사 **시작 시점**의 여정 판을 잡아 둔다.
    //   검사가 스텝 목록을 읽은 뒤 스텝이 추가되면(추가는 updated_at을 올린다) 마커는 옛 판을 통과시킨 기록이 된다.
    //   ⛔ 시각은 `::text` 원문으로 주고받는다 — JS Date 왕복은 µs를 절사해 같은 판을 다른 판으로 만든다(§11 커서 교훈).
    const beforeRow = await query(
      `SELECT updated_at::text AS rev FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`,
      [req.params.id, companyId]
    );
    const revBefore: string | null = beforeRow.rows[0]?.rev ?? null;

    const result = await validateJourneyForActivation(companyId, req.params.id, userId);
    // ★ Fix #4 (2026-06-05): 검증 통과 시 발송 전 검증 마커 기록 — /activate가 이 마커로 미검증(프론트 우회) 활성화를 차단한다.
    if (result.ok) {
      const mark = await query(
        `UPDATE journeys SET last_pretest_passed_at = NOW()
          WHERE id = $1::uuid AND company_id = $2::uuid AND updated_at IS NOT DISTINCT FROM $3::timestamptz
          RETURNING id`,
        [req.params.id, companyId, revBefore]
      );
      if (mark.rows.length === 0) {
        // 검사 도중 스텝·옵션이 바뀌었다 — 통과로 기록하지 않는다(안 켜지는 방향이 안전하다).
        return res.json({
          success: true,
          ...result,
          ok: false,
          staleRevision: true,
          error: '검증하는 사이에 여정이 바뀌었습니다. 한 번 더 검증해 주세요.',
        });
      }
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

    const validStatuses = ['all', 'active', 'completed', 'paused', 'ended', 'failed', 'goal_met'];  // ★ 2026-07-10 목표 달성 종료
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
    // ★ 2026-07-02 1차(좌측 진단 패널 개편): 일일 브리핑 + 자동마케팅 현황을 같은 응답에 동봉 — 추가 fetch 0.
    //   브리핑이 있으면 화면이 룰 기반 추천 대신 브리핑(실데이터·학습 반영)을 단일 소스로 쓴다.
    let brief: any = null;
    try {
      const br = await query(
        `SELECT brief_date, headline, recommendations FROM company_daily_briefs
          WHERE company_id = $1::uuid ORDER BY brief_date DESC LIMIT 1`,
        [companyId],
      );
      brief = br.rows[0] || null;
    } catch (e: any) {
      // 테이블 미생성(마이그레이션 전) = 브리핑 없음으로 처리 — 진단 응답은 정상 유지.
      if (!(e?.message || '').includes('does not exist')) console.warn('[SelfDiagnosis] 브리핑 조회 경고:', e?.message);
    }
    let autoMarketing = { active: 0, pendingProposals: 0 };
    try {
      const [a, p] = await Promise.all([
        query(`SELECT COUNT(*)::int AS n FROM continuous_operators WHERE company_id = $1::uuid AND status = 'active'`, [companyId]),
        query(`SELECT COUNT(*)::int AS n FROM operator_proposals WHERE company_id = $1::uuid AND status IN ('pending', 'admin_review')`, [companyId]),
      ]);
      autoMarketing = { active: Number(a.rows[0]?.n) || 0, pendingProposals: Number(p.rows[0]?.n) || 0 };
    } catch (e: any) {
      console.warn('[SelfDiagnosis] 자동마케팅 현황 조회 경고:', e?.message);
    }
    return res.json({ success: true, diagnosis, brief, autoMarketing });
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
         WHERE company_id = $1::uuid AND ltv_365d > $2::numeric`,
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

// POST /api/ai/operator/predictive/recompute — 지금 전체 재계산 (연동 무관·회사 전체 즉시)
//   매일 워커는 연동 회사(싱크/SDK)만 돌려 비연동 회사는 갱신이 안 된다. 운영자가 직접 전체 갱신.
//   크레딧 = 매일 자동과 동일 멱등키(회사+날짜) — 그날 이미 차감됐으면 0.
router.post('/operator/predictive/recompute', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const planCtx = await loadPlanContext(companyId);
    if (!planCtx) return res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' });
    if (!isAiOperatorAllowed(planCtx, req.user)) {
      return res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    }
    const result = await computeCompanyPredictionsBatch(companyId);
    // DB 규모 기준 일일 분석 차감 (v2). 워커와 같은 멱등키(회사+날짜) → 오늘 이미 차감됐으면 no-op.
    const cntRes = await query(`SELECT COUNT(*)::int AS n FROM customers WHERE company_id = $1::uuid`, [companyId]);
    const cost = dailyDbAnalysisCredits(Number(cntRes.rows[0]?.n) || 0);
    await deductCreditSafe({
      companyId,
      cost,
      source: 'predictive-daily',
      createdBy: req.user?.userId || null,
      idempotencyKey: `predictive-daily:${companyId}:${kstDateTag(new Date())}`,
    });
    return res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[Predictive recompute] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '전체 재계산 오류' });
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
