/**
 * ★ D69: 자동발송 CRUD API
 *
 * 마운트: /api/auto-campaigns
 * 권한: company_admin + company_user (store_code 범위 내)
 * 게이팅: plans.auto_campaign_enabled (프로 이상)
 * 제한: plans.max_auto_campaigns (PRO: 5, BUSINESS: 10, ENTERPRISE: 무제한)
 *
 * 기존 컨트롤타워 100% 재활용:
 * - store-scope.ts → 브랜드 격리
 * - customer-filter.ts → 타겟 필터링 (preview)
 * - unsubscribe-helper.ts → 수신거부 제외 (preview)
 */

import { Request, Response, Router } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { getStoreScope } from '../utils/store-scope';
import { buildFilterQueryCompat } from '../utils/customer-filter';
import { buildUnsubscribeFilter, CAMPAIGN_OPT080_SELECT_EXPR, buildCampaignOpt080LeftJoin } from '../utils/unsubscribe-helper';
import { fetchTargetSampleCustomer } from '../utils/target-sample';
import { kstToUtc } from '../utils/auto-campaign-worker';

const router = Router();

router.use(authenticate);

// ============================================================
// 공통 헬퍼
// ============================================================

/** 요금제 게이팅 + 최대 활성 수 조회
 * - plans.auto_campaign_enabled / max_auto_campaigns 기본 참조
 * - companies.auto_campaign_override가 NULL이 아니면 회사별 오버라이드 우선 적용
 *   (특정 업체에 서비스로 자동발송 N건 제공 시 사용)
 */
async function checkPlanGating(companyId: string): Promise<{
  allowed: boolean;
  maxAutoCampaigns: number | null;
  errorMsg?: string;
}> {
  const result = await query(
    `SELECT p.auto_campaign_enabled, p.max_auto_campaigns, p.plan_code, c.auto_campaign_override,
            c.subscription_status,
            NOW() > c.created_at + INTERVAL '7 days' as is_trial_expired
     FROM companies c
     LEFT JOIN plans p ON c.plan_id = p.id
     WHERE c.id = $1`,
    [companyId]
  );
  const row = result.rows[0];

  // ★ D88: 구독 만료/트라이얼 만료 시 차단
  if (row?.subscription_status === 'expired' || row?.subscription_status === 'suspended') {
    return { allowed: false, maxAutoCampaigns: null, errorMsg: '구독이 만료되었습니다. 요금제를 갱신해주세요.' };
  }
  if (row?.plan_code === 'FREE' && row?.is_trial_expired) {
    return { allowed: false, maxAutoCampaigns: null, errorMsg: '무료체험이 만료되었습니다. 요금제를 업그레이드해주세요.' };
  }

  // 회사별 오버라이드가 있으면 플랜 설정보다 우선
  if (row?.auto_campaign_override != null) {
    const override = Number(row.auto_campaign_override);
    if (override <= 0) {
      return { allowed: false, maxAutoCampaigns: null, errorMsg: '자동발송이 비활성화되어 있습니다.' };
    }
    return { allowed: true, maxAutoCampaigns: override };
  }

  // 오버라이드 없으면 플랜 설정 따름
  if (!row?.auto_campaign_enabled) {
    return {
      allowed: false,
      maxAutoCampaigns: null,
      errorMsg: '자동발송은 프로 요금제 이상에서 이용 가능합니다.',
    };
  }
  return { allowed: true, maxAutoCampaigns: row.max_auto_campaigns };
}

/** AI 프리미엄 게이팅 체크 (ai_generate_enabled 사용 시) */
async function checkAiPremiumGating(companyId: string): Promise<boolean> {
  const result = await query(
    `SELECT p.ai_premium_enabled
     FROM companies c
     LEFT JOIN plans p ON c.plan_id = p.id
     WHERE c.id = $1`,
    [companyId]
  );
  return result.rows[0]?.ai_premium_enabled === true;
}

/** 활성 자동캠페인 수 제한 체크 */
async function checkActiveLimit(companyId: string, maxAutoCampaigns: number | null): Promise<{
  ok: boolean;
  current: number;
  errorMsg?: string;
}> {
  // NULL = 무제한 (ENTERPRISE)
  if (maxAutoCampaigns === null || maxAutoCampaigns === undefined) {
    return { ok: true, current: 0 };
  }
  const countResult = await query(
    `SELECT COUNT(*)::int as cnt FROM auto_campaigns WHERE company_id = $1 AND status = 'active'`,
    [companyId]
  );
  const current = countResult.rows[0]?.cnt || 0;
  if (current >= maxAutoCampaigns) {
    return {
      ok: false,
      current,
      errorMsg: `자동발송은 최대 ${maxAutoCampaigns}개까지 활성화할 수 있습니다. (현재 ${current}개)`,
    };
  }
  return { ok: true, current };
}

/** store-scope 기반 소유권 확인 (수정/삭제/pause/resume 시) */
async function checkOwnership(
  autoCampaignId: string,
  companyId: string,
  userType: string,
  userId: string
): Promise<{ ok: boolean; campaign?: any; errorMsg?: string; statusCode?: number }> {
  // ★ B2: opt_out_080_number 포함을 위해 LEFT JOIN (자동발송은 ac.user_id 기반)
  const result = await query(
    `SELECT ac.*, ${CAMPAIGN_OPT080_SELECT_EXPR}
     FROM auto_campaigns ac
     ${buildCampaignOpt080LeftJoin('ac', 'user_id')}
     WHERE ac.id = $1 AND ac.company_id = $2 AND ac.status != 'deleted'`,
    [autoCampaignId, companyId]
  );
  if (result.rows.length === 0) {
    return { ok: false, errorMsg: '자동발송을 찾을 수 없습니다.', statusCode: 404 };
  }
  const campaign = result.rows[0];

  // company_user는 본인 store_code 범위만
  if (userType === 'company_user') {
    const scope = await getStoreScope(companyId, userId);
    if (scope.type === 'blocked') {
      return { ok: false, errorMsg: '소속 브랜드가 지정되지 않았습니다. 관리자에게 문의하세요.', statusCode: 403 };
    }
    if (scope.type === 'filtered') {
      // campaign의 store_code가 사용자의 범위 내인지 확인
      if (campaign.store_code && !scope.storeCodes.includes(campaign.store_code)) {
        return { ok: false, errorMsg: '해당 자동발송에 대한 권한이 없습니다.', statusCode: 403 };
      }
    }
  }
  return { ok: true, campaign };
}

/**
 * next_run_at 계산
 * - monthly: 이번 달 schedule_day가 안 지났으면 이번 달, 지났으면 다음 달
 * - weekly: 이번 주 schedule_day(요일)가 안 지났으면 이번 주, 지났으면 다음 주
 * - daily: 오늘 schedule_time이 안 지났으면 오늘, 지났으면 내일
 */
function calcNextRunAt(scheduleType: string, scheduleDay: number | null, scheduleTime: string): Date {
  // ★ D83: 서버 타임존에 관계없이 정확한 KST→UTC 변환
  // 이전: toLocaleString + kstToUtc 조합 → KST 서버에서 이중 변환 → 9시간 오차
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const [hours, minutes] = scheduleTime.split(':').map(Number);

  // 현재 KST 시간 구하기 (서버 타임존 무관)
  const now = new Date();
  const kstMs = now.getTime() + KST_OFFSET_MS;
  const kstDate = new Date(kstMs); // getUTC* 메서드가 KST 값을 반환
  const kstYear = kstDate.getUTCFullYear();
  const kstMonth = kstDate.getUTCMonth();
  const kstDay = kstDate.getUTCDate();
  const kstDow = kstDate.getUTCDay();
  const kstNowMinutes = kstDate.getUTCHours() * 60 + kstDate.getUTCMinutes();
  const targetMinutes = hours * 60 + minutes;

  let tYear = kstYear, tMonth = kstMonth, tDay: number;

  if (scheduleType === 'daily') {
    tDay = kstDay;
    if (targetMinutes <= kstNowMinutes) tDay++;
  } else if (scheduleType === 'weekly') {
    const daysUntil = (scheduleDay! - kstDow + 7) % 7;
    tDay = kstDay + daysUntil;
    if (daysUntil === 0 && targetMinutes <= kstNowMinutes) tDay += 7;
  } else if (scheduleType === 'monthly') {
    tDay = scheduleDay!;
    if (tDay < kstDay || (tDay === kstDay && targetMinutes <= kstNowMinutes)) {
      tMonth++;
      if (tMonth > 11) { tMonth = 0; tYear++; }
    }
  } else {
    throw new Error(`Invalid schedule_type: ${scheduleType}`);
  }

  // KST 목표 시각 → UTC 변환 (KST = UTC + 9)
  return new Date(Date.UTC(tYear, tMonth, tDay, hours, minutes, 0) - KST_OFFSET_MS);
}

// ★ D79: 인라인 kstToUtc 제거 → auto-campaign-worker.ts에서 import

// ============================================================
// ★ B5: POST /preview-sample — 타겟 첫 고객 1명 조회 (스팸필터/미리보기 개인화용)
//
//   자동발송 모달에서 사용자가 스팸필터 테스트 또는 미리보기를 열 때,
//   recommend-target 호출 없이도 즉시 타겟 매칭 첫 고객 데이터를 받기 위함.
//
//   body: { target_filter: any, store_code?: string }
//   응답: { customer: Record<string, any> | null, matched: boolean }
// ============================================================
router.post('/preview-sample', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId || !userId) {
      return res.status(400).json({ error: '회사 정보가 없습니다.' });
    }

    const { target_filter, store_code } = req.body;

    const result = await fetchTargetSampleCustomer({
      companyId,
      targetFilter: target_filter || {},
      userId,
      storeCode: store_code || null,
    });

    return res.json({
      customer: result.raw,
      matched: result.matched,
    });
  } catch (err: any) {
    console.error('[auto-campaigns] preview-sample 실패:', err);
    return res.status(500).json({ error: '타겟 샘플 조회에 실패했습니다.' });
  }
});

// ============================================================
// 1. GET / — 자동캠페인 목록 조회 (게이팅 없이, store-scope만 적용)
// ============================================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    if (!companyId || !userId) {
      return res.status(400).json({ error: '회사 정보가 없습니다.' });
    }

    // store-scope 필터
    let storeFilter = '';
    const params: any[] = [companyId];

    if (userType === 'company_user') {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'blocked') {
        return res.status(403).json({ error: '소속 브랜드가 지정되지 않았습니다. 관리자에게 문의하세요.' });
      }
      if (scope.type === 'filtered') {
        storeFilter = ` AND (ac.store_code IS NULL OR ac.store_code = ANY($2::text[]))`;
        params.push(scope.storeCodes);
      }
    }

    // 요금제 정보도 함께 조회 (프론트에서 게이팅 판단용) + 회사별 오버라이드 반영 + 구독 상태
    const planResult = await query(
      `SELECT p.auto_campaign_enabled, p.max_auto_campaigns, p.ai_premium_enabled, p.plan_code,
              c.auto_campaign_override, c.subscription_status,
              NOW() > c.created_at + INTERVAL '7 days' as is_trial_expired
       FROM companies c LEFT JOIN plans p ON c.plan_id = p.id WHERE c.id = $1`,
      [companyId]
    );

    // ★ B2: opt_out_080_number 포함을 위해 LEFT JOIN (자동발송은 ac.user_id 기반)
    const result = await query(
      `SELECT ac.*,
              u.login_id as creator_login_id,
              ${CAMPAIGN_OPT080_SELECT_EXPR},
              (SELECT COUNT(*)::int FROM auto_campaign_runs acr WHERE acr.auto_campaign_id = ac.id) as run_count
       FROM auto_campaigns ac
       LEFT JOIN users u ON ac.user_id = u.id
       ${buildCampaignOpt080LeftJoin('ac', 'user_id')}
       WHERE ac.company_id = $1 AND ac.status != 'deleted'${storeFilter}
       ORDER BY ac.created_at DESC`,
      params
    );

    const activeCount = result.rows.filter(r => r.status === 'active').length;

    // 회사별 오버라이드 반영하여 프론트에 전달
    const planRow = planResult.rows[0];
    let planForFront = { auto_campaign_enabled: false, max_auto_campaigns: null as number | null, ai_premium_enabled: false };

    // ★ D88: 구독/트라이얼 만료 시 auto_campaign_enabled = false 강제
    const isSubscriptionBlocked = planRow?.subscription_status === 'expired' || planRow?.subscription_status === 'suspended'
      || (planRow?.plan_code === 'FREE' && planRow?.is_trial_expired);

    if (isSubscriptionBlocked) {
      planForFront = { auto_campaign_enabled: false, max_auto_campaigns: null, ai_premium_enabled: false };
    } else if (planRow?.auto_campaign_override != null) {
      const override = Number(planRow.auto_campaign_override);
      planForFront = { auto_campaign_enabled: override > 0, max_auto_campaigns: override > 0 ? override : null, ai_premium_enabled: planRow.ai_premium_enabled ?? false };
    } else if (planRow) {
      planForFront = { auto_campaign_enabled: planRow.auto_campaign_enabled, max_auto_campaigns: planRow.max_auto_campaigns, ai_premium_enabled: planRow.ai_premium_enabled ?? false };
    }

    res.json({
      autoCampaigns: result.rows,
      plan: planForFront,
      activeCount,
    });
  } catch (err: any) {
    console.error('[auto-campaigns] 목록 조회 실패:', err);
    res.status(500).json({ error: '자동발송 목록 조회에 실패했습니다.' });
  }
});

// ============================================================
// 2. GET /:id — 자동캠페인 상세 + 실행 이력
// ============================================================
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    if (!companyId || !userId) {
      return res.status(400).json({ error: '회사 정보가 없습니다.' });
    }

    const ownership = await checkOwnership(req.params.id, companyId, userType!, userId);
    if (!ownership.ok) {
      return res.status(ownership.statusCode || 403).json({ error: ownership.errorMsg });
    }

    // 실행 이력 조회 (최근 20건)
    const runsResult = await query(
      `SELECT acr.*,
              c.campaign_name as linked_campaign_name
       FROM auto_campaign_runs acr
       LEFT JOIN campaigns c ON acr.campaign_id = c.id
       WHERE acr.auto_campaign_id = $1
       ORDER BY acr.run_number DESC
       LIMIT 20`,
      [req.params.id]
    );

    res.json({
      autoCampaign: ownership.campaign,
      runs: runsResult.rows,
    });
  } catch (err: any) {
    console.error('[auto-campaigns] 상세 조회 실패:', err);
    res.status(500).json({ error: '자동발송 상세 조회에 실패했습니다.' });
  }
});

// ============================================================
// 3. POST / — 자동캠페인 생성
// ============================================================
router.post('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    if (!companyId || !userId) {
      return res.status(400).json({ error: '회사 정보가 없습니다.' });
    }

    // ★ 요금제 게이팅
    const gating = await checkPlanGating(companyId);
    if (!gating.allowed) {
      return res.status(403).json({ error: gating.errorMsg, code: 'PLAN_FEATURE_LOCKED' });
    }

    // ★ 활성 수 제한 체크
    const limit = await checkActiveLimit(companyId, gating.maxAutoCampaigns);
    if (!limit.ok) {
      return res.status(403).json({ error: limit.errorMsg, code: 'AUTO_CAMPAIGN_LIMIT' });
    }

    // store-scope 체크 (company_user)
    let userStoreCode: string | null = null;
    if (userType === 'company_user') {
      const scope = await getStoreScope(companyId, userId);
      if (scope.type === 'blocked') {
        return res.status(403).json({ error: '소속 브랜드가 지정되지 않았습니다. 관리자에게 문의하세요.' });
      }
      if (scope.type === 'filtered') {
        // 요청에 store_code가 있으면 범위 내인지 확인
        if (req.body.store_code && !scope.storeCodes.includes(req.body.store_code)) {
          return res.status(403).json({ error: '해당 브랜드에 대한 권한이 없습니다.' });
        }
        // store_code가 없으면 첫 번째 store_code 자동 할당 (단일 브랜드)
        if (!req.body.store_code && scope.storeCodes.length === 1) {
          userStoreCode = scope.storeCodes[0];
        }
      }
    }

    const {
      campaign_name, description, schedule_type, schedule_day, schedule_time,
      target_filter, store_code, message_type, message_content, message_subject,
      callback_number, sender_number_id, is_ad, pre_notify, notify_phones,
      use_individual_callback, // ★ D93: 수신자별 회신번호 칼럼 사용
      // ★ AI 프리미엄 필드 (기능 3)
      ai_generate_enabled, ai_prompt, ai_tone, fallback_message_content,
    } = req.body;

    // 필수값 검증
    if (!campaign_name?.trim()) {
      return res.status(400).json({ error: '자동발송 이름을 입력해주세요.' });
    }
    if (!['monthly', 'weekly', 'daily'].includes(schedule_type)) {
      return res.status(400).json({ error: '스케줄 유형은 monthly, weekly, daily 중 하나여야 합니다.' });
    }
    if (schedule_type !== 'daily' && (schedule_day === null || schedule_day === undefined)) {
      return res.status(400).json({ error: '발송일/요일을 선택해주세요.' });
    }
    if (schedule_type === 'monthly' && (schedule_day < 1 || schedule_day > 28)) {
      return res.status(400).json({ error: '매월 발송일은 1~28일 사이여야 합니다.' });
    }
    if (schedule_type === 'weekly' && (schedule_day < 0 || schedule_day > 6)) {
      return res.status(400).json({ error: '요일은 0(일)~6(토) 사이여야 합니다.' });
    }
    if (!schedule_time) {
      return res.status(400).json({ error: '발송 시각을 선택해주세요.' });
    }
    if (!target_filter || typeof target_filter !== 'object') {
      return res.status(400).json({ error: '타겟 필터를 설정해주세요.' });
    }
    // ★ AI 문안생성 모드: 프리미엄 게이팅 + 필수값 검증
    if (ai_generate_enabled) {
      const aiPremium = await checkAiPremiumGating(companyId);
      if (!aiPremium) {
        return res.status(403).json({
          error: 'AI 문안 자동생성은 프로 요금제 이상에서 이용 가능합니다.',
          code: 'AI_PREMIUM_LOCKED',
        });
      }
      if (!ai_prompt?.trim()) {
        return res.status(400).json({ error: 'AI 문안생성 모드에서는 마케팅 컨셉(프롬프트)을 입력해주세요.' });
      }
      if (!fallback_message_content?.trim()) {
        return res.status(400).json({ error: 'AI 생성 실패 시 사용할 폴백 메시지를 입력해주세요.' });
      }
    }

    if (!message_content?.trim() && !ai_generate_enabled) {
      return res.status(400).json({ error: '메시지 내용을 입력해주세요.' });
    }
    // ★ D93: 개별회신번호 사용 시 발신번호 미필수
    if (!use_individual_callback && !callback_number?.trim()) {
      return res.status(400).json({ error: '발신번호를 선택해주세요.' });
    }

    // 발신번호 등록 여부 확인 (개별회신번호 사용 시 스킵)
    if (!use_individual_callback && callback_number) {
      const cbCheck = await query(
        `SELECT id FROM callback_numbers WHERE company_id = $1 AND phone = $2`,
        [companyId, callback_number]
      );
      if (cbCheck.rows.length === 0) {
        return res.status(400).json({ error: '등록되지 않은 발신번호입니다.' });
      }
    }

    // next_run_at 계산
    const nextRunAt = calcNextRunAt(schedule_type, schedule_day, schedule_time);
    const finalStoreCode = store_code || userStoreCode || null;

    // ★ B+0407-4: personal_fields 추가 — AI 문안 생성 시 개인화 변수 전달
    //   프론트(AutoSendFormModal)는 personal_fields를 보내지만 기존 INSERT는 컬럼 누락으로 무시했음
    const personal_fields = req.body.personal_fields;

    const insertResult = await query(
      `INSERT INTO auto_campaigns (
        company_id, user_id, campaign_name, description,
        schedule_type, schedule_day, schedule_time, target_filter, store_code,
        message_type, message_content, message_subject, callback_number,
        sender_number_id, is_ad, pre_notify, notify_phones,
        use_individual_callback,
        ai_generate_enabled, ai_prompt, ai_tone, fallback_message_content,
        personal_fields,
        status, next_run_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8, $9,
        $10, $11, $12, $13,
        $14, $15, $16, $17,
        $18,
        $19, $20, $21, $22,
        $23,
        'active', $24
      ) RETURNING *`,
      [
        companyId, userId, campaign_name.trim(), description || null,
        schedule_type, schedule_day ?? null, schedule_time, JSON.stringify(target_filter), finalStoreCode,
        message_type || 'SMS', message_content?.trim() || null, message_subject || null, (callback_number || '').trim() || null,
        sender_number_id || null, is_ad ?? false, pre_notify ?? true, notify_phones || null,
        use_individual_callback ?? false,
        ai_generate_enabled ?? false, ai_prompt?.trim() || null, ai_tone || 'friendly', fallback_message_content?.trim() || null,
        Array.isArray(personal_fields) && personal_fields.length > 0 ? personal_fields : null,
        nextRunAt,
      ]
    );

    console.log(`[auto-campaigns] 생성 완료: ${insertResult.rows[0].id} (${campaign_name}) by user=${userId}`);

    res.status(201).json({ autoCampaign: insertResult.rows[0] });
  } catch (err: any) {
    console.error('[auto-campaigns] 생성 실패:', err);
    res.status(500).json({ error: '자동발송 생성에 실패했습니다.' });
  }
});

// ============================================================
// 4. PUT /:id — 자동캠페인 수정
// ============================================================
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    if (!companyId || !userId) {
      return res.status(400).json({ error: '회사 정보가 없습니다.' });
    }

    // 요금제 게이팅
    const gating = await checkPlanGating(companyId);
    if (!gating.allowed) {
      return res.status(403).json({ error: gating.errorMsg, code: 'PLAN_FEATURE_LOCKED' });
    }

    // 소유권 확인
    const ownership = await checkOwnership(req.params.id, companyId, userType!, userId);
    if (!ownership.ok) {
      return res.status(ownership.statusCode || 403).json({ error: ownership.errorMsg });
    }

    const {
      campaign_name, description, schedule_type, schedule_day, schedule_time,
      target_filter, message_type, message_content, message_subject,
      callback_number, sender_number_id, is_ad, pre_notify, notify_phones,
      use_individual_callback, // ★ D93: 수신자별 회신번호 칼럼 사용
      // ★ AI 프리미엄 필드 (기능 3)
      ai_generate_enabled, ai_prompt, ai_tone, fallback_message_content,
      // ★ B+0407-4: 개인화 필드 (AI 문안 생성 시 변수 전달용)
      personal_fields,
    } = req.body;

    // 스케줄 변경 시 유효성 검증
    const finalScheduleType = schedule_type || ownership.campaign.schedule_type;
    const finalScheduleDay = schedule_day !== undefined ? schedule_day : ownership.campaign.schedule_day;
    const finalScheduleTime = schedule_time || ownership.campaign.schedule_time;

    if (schedule_type && !['monthly', 'weekly', 'daily'].includes(schedule_type)) {
      return res.status(400).json({ error: '스케줄 유형은 monthly, weekly, daily 중 하나여야 합니다.' });
    }

    // ★ AI 문안생성 모드 활성화/수정 시: 프리미엄 게이팅 + 필수값 검증
    const finalAiEnabled = ai_generate_enabled !== undefined ? ai_generate_enabled : ownership.campaign.ai_generate_enabled;
    if (finalAiEnabled) {
      const aiPremium = await checkAiPremiumGating(companyId);
      if (!aiPremium) {
        return res.status(403).json({
          error: 'AI 문안 자동생성은 프로 요금제 이상에서 이용 가능합니다.',
          code: 'AI_PREMIUM_LOCKED',
        });
      }
      // AI 모드를 새로 켤 때만 prompt/fallback 필수 체크
      if (ai_generate_enabled === true) {
        const finalPrompt = ai_prompt?.trim() || ownership.campaign.ai_prompt;
        const finalFallback = fallback_message_content?.trim() || ownership.campaign.fallback_message_content;
        if (!finalPrompt) {
          return res.status(400).json({ error: 'AI 문안생성 모드에서는 마케팅 컨셉(프롬프트)을 입력해주세요.' });
        }
        if (!finalFallback) {
          return res.status(400).json({ error: 'AI 생성 실패 시 사용할 폴백 메시지를 입력해주세요.' });
        }
      }
    }

    // 발신번호 변경 시 등록 여부 확인
    if (callback_number) {
      const cbCheck = await query(
        `SELECT id FROM callback_numbers WHERE company_id = $1 AND phone = $2`,
        [companyId, callback_number]
      );
      if (cbCheck.rows.length === 0) {
        return res.status(400).json({ error: '등록되지 않은 발신번호입니다.' });
      }
    }

    // next_run_at 재계산 (스케줄 변경 시, active 상태인 경우만)
    let nextRunAt = ownership.campaign.next_run_at;
    if ((schedule_type || schedule_day !== undefined || schedule_time) && ownership.campaign.status === 'active') {
      nextRunAt = calcNextRunAt(finalScheduleType, finalScheduleDay, finalScheduleTime);
    }

    // ★ AI 모드 OFF 전환 시 generated 필드 초기화
    const clearGenerated = ai_generate_enabled === false;

    const updateResult = await query(
      `UPDATE auto_campaigns SET
        campaign_name = COALESCE($2, campaign_name),
        description = COALESCE($3, description),
        schedule_type = COALESCE($4, schedule_type),
        schedule_day = COALESCE($5, schedule_day),
        schedule_time = COALESCE($6, schedule_time),
        target_filter = COALESCE($7, target_filter),
        message_type = COALESCE($8, message_type),
        message_content = COALESCE($9, message_content),
        message_subject = COALESCE($10, message_subject),
        callback_number = COALESCE($11, callback_number),
        sender_number_id = COALESCE($12, sender_number_id),
        is_ad = COALESCE($13, is_ad),
        pre_notify = COALESCE($14, pre_notify),
        notify_phones = COALESCE($15, notify_phones),
        use_individual_callback = COALESCE($16, use_individual_callback),
        next_run_at = $17,
        ai_generate_enabled = COALESCE($19, ai_generate_enabled),
        ai_prompt = COALESCE($20, ai_prompt),
        ai_tone = COALESCE($21, ai_tone),
        fallback_message_content = COALESCE($22, fallback_message_content),
        generated_message_content = CASE WHEN $23::boolean THEN NULL ELSE generated_message_content END,
        generated_message_subject = CASE WHEN $23::boolean THEN NULL ELSE generated_message_subject END,
        generated_at = CASE WHEN $23::boolean THEN NULL ELSE generated_at END,
        personal_fields = COALESCE($24, personal_fields),
        updated_at = NOW()
      WHERE id = $1 AND company_id = $18
      RETURNING *`,
      [
        req.params.id,
        campaign_name?.trim() || null,
        description !== undefined ? description : null,
        schedule_type || null,
        schedule_day !== undefined ? schedule_day : null,
        schedule_time || null,
        target_filter ? JSON.stringify(target_filter) : null,
        message_type || null,
        message_content?.trim() || null,
        message_subject !== undefined ? message_subject : null,
        callback_number?.trim() || null,
        sender_number_id || null,
        is_ad !== undefined ? is_ad : null,
        pre_notify !== undefined ? pre_notify : null,
        notify_phones !== undefined ? notify_phones : null,
        use_individual_callback !== undefined ? use_individual_callback : null,
        nextRunAt,
        companyId,
        ai_generate_enabled !== undefined ? ai_generate_enabled : null,
        ai_prompt?.trim() || null,
        ai_tone || null,
        fallback_message_content?.trim() || null,
        clearGenerated,
        // ★ B+0407-4: personal_fields (개인화 변수)
        Array.isArray(personal_fields) ? personal_fields : null,
      ]
    );

    console.log(`[auto-campaigns] 수정 완료: ${req.params.id} by user=${userId}`);

    res.json({ autoCampaign: updateResult.rows[0] });
  } catch (err: any) {
    console.error('[auto-campaigns] 수정 실패:', err);
    res.status(500).json({ error: '자동발송 수정에 실패했습니다.' });
  }
});

// ============================================================
// 4-1. PUT /:id/generated-message — AI 생성 문안 수정 (D96: 슬4)
// ============================================================
router.put('/:id/generated-message', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    if (!companyId || !userId) {
      return res.status(400).json({ error: '회사 정보가 없습니다.' });
    }

    const ownership = await checkOwnership(req.params.id, companyId, userType!, userId);
    if (!ownership.ok) {
      return res.status(ownership.statusCode || 403).json({ error: ownership.errorMsg });
    }

    const { generated_message_content, generated_message_subject } = req.body;
    if (!generated_message_content?.trim()) {
      return res.status(400).json({ error: '문안 내용을 입력해주세요.' });
    }

    await query(
      `UPDATE auto_campaigns SET
        generated_message_content = $2,
        generated_message_subject = $3,
        updated_at = NOW()
      WHERE id = $1 AND company_id = $4`,
      [req.params.id, generated_message_content.trim(), generated_message_subject?.trim() || null, companyId]
    );

    console.log(`[auto-campaigns] AI 생성 문안 수정: ${req.params.id} by user=${userId}`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[auto-campaigns] AI 생성 문안 수정 실패:', err);
    res.status(500).json({ error: 'AI 생성 문안 수정에 실패했습니다.' });
  }
});

// ============================================================
// 5. POST /:id/pause — 일시정지
// ============================================================
router.post('/:id/pause', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    if (!companyId || !userId) {
      return res.status(400).json({ error: '회사 정보가 없습니다.' });
    }

    const ownership = await checkOwnership(req.params.id, companyId, userType!, userId);
    if (!ownership.ok) {
      return res.status(ownership.statusCode || 403).json({ error: ownership.errorMsg });
    }
    if (ownership.campaign.status !== 'active') {
      return res.status(400).json({ error: '활성 상태인 자동발송만 일시정지할 수 있습니다.' });
    }

    await query(
      `UPDATE auto_campaigns SET status = 'paused', next_run_at = NULL, updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );

    console.log(`[auto-campaigns] 일시정지: ${req.params.id} by user=${userId}`);

    res.json({ message: '자동발송이 일시정지되었습니다.' });
  } catch (err: any) {
    console.error('[auto-campaigns] 일시정지 실패:', err);
    res.status(500).json({ error: '자동발송 일시정지에 실패했습니다.' });
  }
});

// ============================================================
// 6. POST /:id/resume — 재개
// ============================================================
router.post('/:id/resume', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    if (!companyId || !userId) {
      return res.status(400).json({ error: '회사 정보가 없습니다.' });
    }

    // 요금제 게이팅 (재개 시에도 체크)
    const gating = await checkPlanGating(companyId);
    if (!gating.allowed) {
      return res.status(403).json({ error: gating.errorMsg, code: 'PLAN_FEATURE_LOCKED' });
    }

    // 활성 수 제한 체크 (재개 = 활성으로 전환이므로)
    const limitCheck = await checkActiveLimit(companyId, gating.maxAutoCampaigns);
    if (!limitCheck.ok) {
      return res.status(403).json({ error: limitCheck.errorMsg, code: 'AUTO_CAMPAIGN_LIMIT' });
    }

    const ownership = await checkOwnership(req.params.id, companyId, userType!, userId);
    if (!ownership.ok) {
      return res.status(ownership.statusCode || 403).json({ error: ownership.errorMsg });
    }
    if (ownership.campaign.status !== 'paused') {
      return res.status(400).json({ error: '일시정지 상태인 자동발송만 재개할 수 있습니다.' });
    }

    // next_run_at 재계산
    const nextRunAt = calcNextRunAt(
      ownership.campaign.schedule_type,
      ownership.campaign.schedule_day,
      ownership.campaign.schedule_time
    );

    await query(
      `UPDATE auto_campaigns SET status = 'active', next_run_at = $2, updated_at = NOW() WHERE id = $1`,
      [req.params.id, nextRunAt]
    );

    console.log(`[auto-campaigns] 재개: ${req.params.id} by user=${userId}`);

    res.json({ message: '자동발송이 재개되었습니다.', nextRunAt });
  } catch (err: any) {
    console.error('[auto-campaigns] 재개 실패:', err);
    res.status(500).json({ error: '자동발송 재개에 실패했습니다.' });
  }
});

// ============================================================
// 7. DELETE /:id — 삭제 (soft delete)
// ============================================================
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    if (!companyId || !userId) {
      return res.status(400).json({ error: '회사 정보가 없습니다.' });
    }

    const ownership = await checkOwnership(req.params.id, companyId, userType!, userId);
    if (!ownership.ok) {
      return res.status(ownership.statusCode || 403).json({ error: ownership.errorMsg });
    }

    await query(
      `UPDATE auto_campaigns SET status = 'deleted', next_run_at = NULL, updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );

    console.log(`[auto-campaigns] 삭제: ${req.params.id} by user=${userId}`);

    res.json({ message: '자동발송이 삭제되었습니다.' });
  } catch (err: any) {
    console.error('[auto-campaigns] 삭제 실패:', err);
    res.status(500).json({ error: '자동발송 삭제에 실패했습니다.' });
  }
});

// ============================================================
// 8. POST /:id/preview — 미리보기 (현재 필터 기준 타겟 수 + 샘플)
// ============================================================
router.post('/:id/preview', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    if (!companyId || !userId) {
      return res.status(400).json({ error: '회사 정보가 없습니다.' });
    }

    const ownership = await checkOwnership(req.params.id, companyId, userType!, userId);
    if (!ownership.ok) {
      return res.status(ownership.statusCode || 403).json({ error: ownership.errorMsg });
    }

    const campaign = ownership.campaign;

    // customer-filter로 타겟 수 카운트
    const filterResult = buildFilterQueryCompat(campaign.target_filter, companyId);

    // store_code 필터
    let storeFilter = '';
    const storeParams: any[] = [];
    if (campaign.store_code) {
      storeFilter = ` AND c.store_code = $${filterResult.nextIndex}`;
      storeParams.push(campaign.store_code);
    }

    // 수신거부 필터 (user_id 기준)
    const unsubFilter = buildUnsubscribeFilter(`'${userId}'`, 'c.phone');

    const countResult = await query(
      `SELECT COUNT(*)::int as cnt FROM customers c
       WHERE c.company_id = $1${filterResult.where}${storeFilter}${unsubFilter}
       AND c.sms_opt_in = true`,
      [companyId, ...filterResult.params, ...storeParams]
    );

    // 샘플 고객 5명
    const sampleResult = await query(
      `SELECT c.name, c.phone, c.gender, c.grade FROM customers c
       WHERE c.company_id = $1${filterResult.where}${storeFilter}${unsubFilter}
       AND c.sms_opt_in = true
       ORDER BY RANDOM() LIMIT 5`,
      [companyId, ...filterResult.params, ...storeParams]
    );

    res.json({
      targetCount: countResult.rows[0]?.cnt || 0,
      samples: sampleResult.rows,
    });
  } catch (err: any) {
    console.error('[auto-campaigns] 미리보기 실패:', err);
    res.status(500).json({ error: '미리보기에 실패했습니다.' });
  }
});

// ============================================================
// 9. POST /:id/cancel-next — 다음 실행 취소
// ============================================================
router.post('/:id/cancel-next', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    const userType = req.user?.userType;

    if (!companyId || !userId) {
      return res.status(400).json({ error: '회사 정보가 없습니다.' });
    }

    const ownership = await checkOwnership(req.params.id, companyId, userType!, userId);
    if (!ownership.ok) {
      return res.status(ownership.statusCode || 403).json({ error: ownership.errorMsg });
    }
    if (ownership.campaign.status !== 'active') {
      return res.status(400).json({ error: '활성 상태인 자동발송만 다음 실행을 취소할 수 있습니다.' });
    }

    const campaign = ownership.campaign;

    // 현재 next_run_at 기준으로 해당 회차 pending run이 있으면 cancelled 처리
    await query(
      `UPDATE auto_campaign_runs
       SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = $2
       WHERE auto_campaign_id = $1 AND status IN ('pending', 'notified')`,
      [req.params.id, req.body.reason || '사용자 취소']
    );

    // next_run_at을 그 다음 스케줄로 갱신
    const newNextRunAt = calcNextRunAt(
      campaign.schedule_type,
      campaign.schedule_day,
      campaign.schedule_time
    );

    await query(
      `UPDATE auto_campaigns SET next_run_at = $2, updated_at = NOW() WHERE id = $1`,
      [req.params.id, newNextRunAt]
    );

    console.log(`[auto-campaigns] 다음 실행 취소: ${req.params.id} by user=${userId}`);

    res.json({ message: '다음 자동발송이 취소되었습니다.', nextRunAt: newNextRunAt });
  } catch (err: any) {
    console.error('[auto-campaigns] 다음 실행 취소 실패:', err);
    res.status(500).json({ error: '다음 실행 취소에 실패했습니다.' });
  }
});

export default router;
