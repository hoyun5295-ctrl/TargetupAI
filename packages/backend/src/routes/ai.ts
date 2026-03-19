import { Request, Response, Router } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { checkAPIStatus, extractVarCatalog, generateCustomMessages, generateMessages, parseBriefing, recommendTarget, countFilteredCustomers, relaxFilters, recommendNextCampaign } from '../services/ai';
import { buildGenderFilter, buildGradeFilter, buildRegionFilter, getGenderVariants, getRegionVariants } from '../utils/normalize';
import { FIELD_MAP } from '../utils/standard-field-map';
import { isValidCustomFieldKey } from '../utils/safe-field-name';
import { getStoreScope } from '../utils/store-scope';
import { buildFilterWhereClauseCompat } from '../utils/customer-filter';
import { autoSpamTestWithRegenerate } from '../utils/spam-test-queue';
import { aggregateCampaignPerformance } from '../utils/stats-aggregation';


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

    const { prompt, filters, productName, discountRate, eventName, brandName, channel, isAd, usePersonalization, personalizationVars } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: '프롬프트를 입력해주세요' });
    }

    // 회사 정보 조회 (브랜드 정보 포함)
    const companyResult = await query(
      'SELECT COALESCE(reject_number, opt_out_080_number) as reject_number, brand_name, brand_slogan, brand_description, brand_tone, customer_schema FROM companies WHERE id = $1',
      [companyId]
    );
    const companyInfo = companyResult.rows[0] || {};
    // ★ B17-11: 사용자별 080번호 우선 적용
    if (userId) {
      const userOptResult = await query('SELECT opt_out_080_number FROM users WHERE id = $1', [userId]);
      const userOpt080 = userOptResult.rows[0]?.opt_out_080_number;
      if (userOpt080) companyInfo.reject_number = userOpt080;
    }
    const { fieldMappings: varCatalog, availableVars } = extractVarCatalog(companyInfo.customer_schema);

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
      personalizationVars,
      availableVarsCatalog: varCatalog,
      availableVars: availableVars,
    };

    const result = await generateMessages(prompt, targetInfo, extraContext);

    // ★ D78: 프로 이상 자동 스팸검사 + 재생성
    const planCheck = await query(
      `SELECT p.auto_spam_test_enabled FROM companies c
       LEFT JOIN plans p ON c.plan_id = p.id
       WHERE c.id = $1`,
      [companyId]
    );
    const autoSpamEnabled = planCheck.rows[0]?.auto_spam_test_enabled === true;

    if (autoSpamEnabled && result.variants && result.variants.length > 0 && channel !== '카카오') {
      // 발신번호 조회 (사용자별 우선)
      let callbackNumber = companyInfo.reject_number || '';
      if (!callbackNumber) {
        const senderResult = await query(
          `SELECT number FROM sender_numbers WHERE company_id = $1 AND is_active = true LIMIT 1`,
          [companyId]
        );
        callbackNumber = senderResult.rows[0]?.number || '';
      }

      if (callbackNumber) {
        try {
          const spamResult = await autoSpamTestWithRegenerate({
            companyId: companyId!,
            userId: userId!,
            callbackNumber,
            messageType: (channel === 'LMS' || channel === 'MMS') ? channel : 'SMS',
            variants: result.variants.map((v: any) => ({
              variantId: v.variant_id || v.variantId || 'A',
              messageText: v.message_text || v.sms_text || v.lms_text || '',
              subject: v.subject,
            })),
            isAd: isAd || false,
            rejectNumber: companyInfo.reject_number,
            // 재생성 콜백: 스팸 차단된 variant를 새로 생성
            regenerateCallback: async (blockedVariantId: string) => {
              try {
                console.log(`[AI] 스팸 차단 variant ${blockedVariantId} 재생성 시도`);
                const regenResult = await generateMessages(
                  prompt + '\n(이전 문안이 스팸필터에 차단되었습니다. 다른 표현으로 작성해주세요.)',
                  targetInfo,
                  extraContext
                );
                if (regenResult.variants && regenResult.variants.length > 0) {
                  const nv = regenResult.variants[0] as any;
                  return {
                    messageText: nv.message_text || nv.sms_text || nv.lms_text || '',
                    subject: nv.subject,
                  };
                }
                return null;
              } catch (err) {
                console.error(`[AI] variant ${blockedVariantId} 재생성 실패:`, err);
                return null;
              }
            },
          });

          // 스팸 테스트 결과를 variants에 병합 (동적 속성 → as any 캐스팅)
          const resultAny = result as any;
          for (const spamVariant of spamResult.variants) {
            const originalVariant = resultAny.variants.find(
              (v: any) => (v.variant_id || v.variantId) === spamVariant.variantId
            );
            if (originalVariant) {
              // 재생성되었으면 메시지 교체
              if (spamVariant.regenerated) {
                originalVariant.message_text = spamVariant.messageText;
                if (spamVariant.subject) originalVariant.subject = spamVariant.subject;
                if (channel === 'SMS') originalVariant.sms_text = spamVariant.messageText;
                else originalVariant.lms_text = spamVariant.messageText;
              }
              // 스팸 결과 추가
              originalVariant.spam_result = spamVariant.spamResult;
              originalVariant.spam_carrier_results = spamVariant.carrierResults;
              originalVariant.spam_regenerated = spamVariant.regenerated;
              originalVariant.spam_regenerate_count = spamVariant.regenerateCount;
            }
          }

          // 배치 ID 추가
          resultAny.spamTestBatchId = spamResult.batchId;
          resultAny.spamTestCompleted = true;
          resultAny.spamTestTotalCount = spamResult.totalTestCount;
          resultAny.spamTestRegenerateCount = spamResult.totalRegenerateCount;

          console.log(`[AI] D78 자동 스팸검사 완료 — batch=${spamResult.batchId}, tests=${spamResult.totalTestCount}, regenerated=${spamResult.totalRegenerateCount}`);
        } catch (spamErr) {
          console.error('[AI] D78 자동 스팸검사 오류 (무시, 결과는 그대로 반환):', spamErr);
          // 스팸 테스트 실패해도 AI 결과는 그대로 반환
        }
      }
    }

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

    // ★ D53: 요금제 게이팅 — ai_messaging_enabled 체크
    const planCheck = await query(
      `SELECT p.ai_messaging_enabled FROM companies c
       LEFT JOIN plans p ON c.plan_id = p.id
       WHERE c.id = $1`,
      [companyId]
    );
    if (!planCheck.rows[0]?.ai_messaging_enabled) {
      return res.status(403).json({
        error: 'AI 추천 발송은 베이직 이상 요금제에서 이용 가능합니다.',
        code: 'PLAN_FEATURE_LOCKED'
      });
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
    // ★ B17-11: 사용자별 080번호 우선 적용
    if (userId) {
      const userOptResult = await query('SELECT opt_out_080_number FROM users WHERE id = $1', [userId]);
      const userOpt080 = userOptResult.rows[0]?.opt_out_080_number;
      if (userOpt080) companyInfo.reject_number = userOpt080;
    }

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
    let actualCount = filterResult.count;
    let unsubscribeCount = filterResult.unsubscribeCount;
    console.log(`[AI] 필터 카운트 결과: ${actualCount}명 (수신거부: ${unsubscribeCount}명)`);

    // ★ 기능 4: 0명일 때 AI 자동 조건완화 (프로 이상 ai_premium_enabled 전용)
    let autoRelaxed = false;
    let originalFilters: Record<string, any> | null = null;
    let relaxedFields: string[] = [];

    // ★ auto_relax 파라미터: 프론트에서 ON/OFF 제어 (기본 true — 프로 이상이면 자동 시도)
    const autoRelaxRequested = req.body.auto_relax !== false;

    if (actualCount === 0 && Object.keys(result.filters).length > 0 && autoRelaxRequested) {
      // 프로 이상 게이팅 체크
      const premiumCheck = await query(
        `SELECT p.ai_premium_enabled FROM companies c LEFT JOIN plans p ON c.plan_id = p.id WHERE c.id = $1`,
        [companyId]
      );
      const isPremium = premiumCheck.rows[0]?.ai_premium_enabled === true;

      if (isPremium) {
        console.log('[AI] 0명 매칭 → 자동 조건완화 시도 (프로 이상)');
        originalFilters = { ...result.filters };

        // 최대 2회 시도
        for (let attempt = 1; attempt <= 2; attempt++) {
          const relaxResult = await relaxFilters(
            result.filters,
            result.reasoning,
            statsResult.rows[0],
            '' // activeFieldsPrompt는 recommendTarget 내부에서 이미 사용됨
          );

          if (Object.keys(relaxResult.filters).length === 0) {
            console.warn(`[AI] 조건완화 ${attempt}회차 — 빈 필터 반환, 중단`);
            break;
          }

          let relaxCount: { count: number; unsubscribeCount: number };
          try {
            relaxCount = await countFilteredCustomers(companyId, relaxResult.filters, userId!, storeFilter, baseParams);
          } catch (relaxErr) {
            console.warn(`[AI] 조건완화 ${attempt}회차 — 카운트 쿼리 실패, 중단:`, relaxErr);
            break;
          }

          if (relaxCount.count > 0) {
            console.log(`[AI] 조건완화 ${attempt}회차 성공 — ${relaxCount.count}명 매칭`);
            result.filters = relaxResult.filters;
            result.reasoning = relaxResult.reasoning;
            actualCount = relaxCount.count;
            unsubscribeCount = relaxCount.unsubscribeCount;
            autoRelaxed = true;
            relaxedFields = relaxResult.relaxed_fields;
            break;
          }

          console.log(`[AI] 조건완화 ${attempt}회차 — 여전히 0명`);
          // 다음 시도를 위해 현재 완화된 필터를 기준으로 재시도
          result.filters = relaxResult.filters;
          result.reasoning = relaxResult.reasoning;
        }
      }
    }

    // ★ 풀백 감지 — 로그만 남김 (DB 추출 결과는 정확하므로 임의로 0으로 덮어쓰지 않음)
    const totalCustomers = parseInt(statsResult.rows[0].sms_opt_in_count || statsResult.rows[0].total);
    if (Object.keys(result.filters).length > 0 && actualCount >= totalCustomers * 0.95) {
      console.warn(`[AI] ⚠️ 풀백 감지 (로그만): 필터 ${JSON.stringify(result.filters)}, actualCount=${actualCount}, total=${totalCustomers}`);
    }

    result.estimated_count = actualCount;
    (result as any).unsubscribe_count = unsubscribeCount;
    (result as any).has_kakao_profile = hasKakaoProfile;
    (result as any).auto_relaxed = autoRelaxed;
    if (autoRelaxed && originalFilters) {
      (result as any).original_filters = originalFilters;
      (result as any).relaxed_fields = relaxedFields;
    }

    // ★ 샘플 고객 1명 조회 (미리보기 치환용 — displayName 키 기반)
    // 최신 필터 기준으로 WHERE 재생성 (자동완화 시 result.filters가 변경됨)
    const { sql: sampleFilterWhere, params: sampleFilterParams } = buildFilterWhereClauseCompat(result.filters, baseParams.length + 1);
    const sampleUnsubIdx = baseParams.length + sampleFilterParams.length + 1;

    let sampleCustomer: Record<string, string> = {};
    try {
      const sampleResult = await query(
        `SELECT name, gender, age, grade, points, email, address,
                recent_purchase_store, registered_store, registration_type,
                store_phone, recent_purchase_amount, total_purchase_amount,
                birth_date, custom_fields
         FROM customers c
         WHERE c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true${storeFilter} ${sampleFilterWhere}
         AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $${sampleUnsubIdx} AND u.phone = c.phone)
         ORDER BY name ASC NULLS LAST LIMIT 1`,
        [...baseParams, ...sampleFilterParams, userId]
      );

      if (sampleResult.rows[0]) {
        const row = sampleResult.rows[0];
        // 표준 필드 → displayName 매핑
        for (const f of FIELD_MAP) {
          if (f.storageType === 'custom_fields' || f.fieldKey === 'phone' || f.fieldKey === 'sms_opt_in') continue;
          const val = row[f.columnName];
          if (val !== null && val !== undefined && val !== '') {
            sampleCustomer[f.displayName] = f.dataType === 'number' && !isNaN(Number(val))
              ? Number(val).toLocaleString()
              : String(val);
          }
        }
        // 커스텀 필드 → 실제 라벨명 매핑
        if (row.custom_fields && typeof row.custom_fields === 'object') {
          const defResult = await query(
            'SELECT field_key, field_label FROM customer_field_definitions WHERE company_id = $1',
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

    // ★ 프로 이상 게이팅
    const premiumCheck = await query(
      `SELECT p.ai_premium_enabled FROM companies c LEFT JOIN plans p ON c.plan_id = p.id WHERE c.id = $1`,
      [companyId]
    );
    if (!premiumCheck.rows[0]?.ai_premium_enabled) {
      return res.status(403).json({
        error: 'AI 캠페인 추천은 프로 이상 요금제에서 이용 가능합니다.',
        code: 'PLAN_FEATURE_LOCKED'
      });
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
      targetFilters.store_name = { value: targetCondition.storeName, operator: 'eq' };
    }

    // birth_date (생일 월 필터)
    if (targetCondition.birthMonth) {
      targetFilters.birth_date = { value: parseInt(targetCondition.birthMonth), operator: 'birth_month' };
    }

    // ★ D84: 커스텀 필드 + 기타 필드 보존 — parseBriefing이 생성한 custom_fields.*, registered_store 등
    // originalTargetFilters에서 기본 필드(위에서 이미 변환한 것)를 제외한 나머지를 merge
    if (originalTargetFilters && typeof originalTargetFilters === 'object') {
      const basicFieldKeys = new Set(['gender', 'grade', 'age', 'region', 'store_name', 'birth_date']);
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

    // ★ D53: 요금제 게이팅 — ai_messaging_enabled 체크
    const planCheck = await query(
      `SELECT p.ai_messaging_enabled FROM companies c
       LEFT JOIN plans p ON c.plan_id = p.id
       WHERE c.id = $1`,
      [companyId]
    );
    if (!planCheck.rows[0]?.ai_messaging_enabled) {
      return res.status(403).json({
        error: 'AI 맞춤한줄은 베이직 이상 요금제에서 이용 가능합니다.',
        code: 'PLAN_FEATURE_LOCKED'
      });
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

    return res.json({
      ...result,
      estimatedCount,
      unsubscribeCount,
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

    // ★ D53: 요금제 게이팅 — ai_messaging_enabled 체크
    const planCheck = await query(
      `SELECT p.ai_messaging_enabled FROM companies c
       LEFT JOIN plans p ON c.plan_id = p.id
       WHERE c.id = $1`,
      [companyId]
    );
    if (!planCheck.rows[0]?.ai_messaging_enabled) {
      return res.status(403).json({
        error: 'AI 맞춤한줄은 베이직 이상 요금제에서 이용 가능합니다.',
        code: 'PLAN_FEATURE_LOCKED'
      });
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
    // ★ B17-11: 사용자별 080번호 우선 적용
    if (userId) {
      const userOptResult = await query('SELECT opt_out_080_number FROM users WHERE id = $1', [userId]);
      const userOpt080 = userOptResult.rows[0]?.opt_out_080_number;
      if (userOpt080) companyInfo.reject_number = userOpt080;
    }

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

export default router;
