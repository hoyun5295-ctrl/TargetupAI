/**
 * 타겟 추출 — 비-문자 채널 공용 엔드포인트 (sub-project A · P1)
 *
 *   POST /api/targets/extract  { naturalLanguage, channel, customFieldKeys? }
 *     → { filter, explanation, matchCount, channelEligibleCount, samples }
 *
 *   - 자연어 → CT-97 convertNaturalLanguageToFilter (AI 변환 + CT-01 호환 검증, 0건 판정 X)
 *   - matchCount          = 조건에 맞는 전체 고객 (회사 격리 + filter)
 *   - channelEligibleCount = 그 채널로 실제 보낼 수 있는 인원 (channel-eligibility WHERE)
 *   - 0건 자동완화 X (D171): matchCount=0 → 400. channelEligibleCount=0 → 차단은 프론트(발송 비활성).
 *
 *   게이팅 = ai_messaging (BASIC+) — DirectTargetFilterModal AI 자연어 모드와 동일 기능군.
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth';
import { requirePlanFeature } from '../utils/plan-guard';
import { convertNaturalLanguageToFilter, SegmentGenerationError } from '../utils/ai-segment-generator';
import { buildCustomerFilter } from '../utils/customer-filter';
import { buildChannelEligibilityWhere, type ChannelKey } from '../utils/channel-eligibility';
import { countTargetByFilter } from '../utils/target-count';
import { query } from '../config/database';

const router = Router();

router.use(authenticate);

const VALID_CHANNELS: ChannelKey[] = ['email', 'dm', 'inapp', 'kakao'];

/**
 * POST /api/targets/extract
 */
router.post('/extract', requirePlanFeature('ai_messaging'), async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }

    const { naturalLanguage, channel, customFieldKeys } = req.body as {
      naturalLanguage?: string;
      channel?: string;
      customFieldKeys?: string[];
    };

    if (!naturalLanguage?.trim()) {
      return res.status(400).json({ success: false, error: '자연어 입력이 필요합니다.' });
    }
    if (!channel || !VALID_CHANNELS.includes(channel as ChannelKey)) {
      return res.status(400).json({ success: false, error: '지원하지 않는 채널입니다. (email / dm / inapp / kakao)' });
    }
    const ch = channel as ChannelKey;

    // 1. 자연어 → CT-01 호환 filter (AI 변환 + 검증, 0건 판정은 아래에서)
    //    ★ 2026-07-02(3) isAll = "전체 고객" — filter {} = 조건 없음 = 아래 SQL이 자연히 전체 카운트
    const { filter, explanation, isAll } = await convertNaturalLanguageToFilter({
      companyId,
      naturalLanguage,
      customFieldKeys: Array.isArray(customFieldKeys) ? customFieldKeys : undefined,
    });

    // 2~3. 조건 → 인원수 2종 + 샘플. ★ 2026-09-12 SQL은 CT 한 벌(`countTargetByFilter`)로 옮겼다 —
    //      직접 선택(/count)과 자연어(/extract)가 같은 숫자를 내야 발송 인원과 어긋나지 않는다.
    const { matchCount, channelEligibleCount, samples } = await countTargetByFilter(companyId, ch, filter);

    // 4. 0건 자동완화 X (D171) — 조건 자체가 0이면 조건 정정 안내
    if (matchCount === 0) {
      return res.status(400).json({
        success: false,
        code: 'ZERO_MATCH',
        error: '조건에 맞는 고객이 0명입니다. 조건을 더 넓혀주세요. (자동 완화는 마케팅 의도 보호를 위해 차단됩니다)',
      });
    }

    return res.json({
      success: true,
      channel: ch,
      filter,
      isAll: !!isAll,
      explanation,
      matchCount,
      channelEligibleCount,
      samples,
    });
  } catch (err: any) {
    if (err instanceof SegmentGenerationError) {
      return res.status(400).json({ success: false, code: err.code, error: err.message });
    }
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        code: 'DB_MIGRATION_PENDING',
        error: 'DB 마이그레이션 필요: 운영자에게 customers 컬럼 확인을 요청해주세요.',
      });
    }
    console.error('[targets/extract] 실패:', err);
    return res.status(500).json({ success: false, error: '타겟 추출 실패' });
  }
});

/**
 * POST /api/targets/count — 화면에서 직접 고른 조건의 인원수·샘플 (★ 2026-09-12 · 접수 `cmtwb4drj009rjnluzpgntxkt`)
 *   { channel, filter } → { matchCount, channelEligibleCount, samples, isAll }
 *
 *   - /extract에서 **자연어 변환 단계만 뺀 것**이다. 숫자를 내는 SQL은 같은 CT 한 벌(countTargetByFilter)을 쓴다.
 *   - 0건이어도 400이 아니라 0을 그대로 돌려준다 — 조건을 고쳐 가며 인원을 확인하는 화면이라 여기서 막으면
 *     "왜 0인지"를 볼 수 없다. 0건 발송 차단(D171)은 진행 버튼(프론트)과 send-to-target(서버)이 종전대로 한다.
 *   - 게이트는 /extract와 같다 — 같은 모달의 두 탭이 서로 다른 요금제 조건을 갖지 않는다.
 */
router.post('/count', requirePlanFeature('ai_messaging'), async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }

    const { channel, filter } = req.body as { channel?: string; filter?: Record<string, unknown> };
    if (!channel || !VALID_CHANNELS.includes(channel as ChannelKey)) {
      return res.status(400).json({ success: false, error: '지원하지 않는 채널입니다. (email / dm / inapp / kakao)' });
    }
    const ch = channel as ChannelKey;
    const safeFilter = filter && typeof filter === 'object' && !Array.isArray(filter) ? filter : {};

    const { matchCount, channelEligibleCount, samples } = await countTargetByFilter(companyId, ch, safeFilter);

    return res.json({
      success: true,
      channel: ch,
      filter: safeFilter,
      // 조건을 하나도 안 고르면 "전체 고객"이다 — 발송 경로는 빈 filter를 allCustomers로만 받는다.
      isAll: Object.keys(safeFilter).length === 0,
      matchCount,
      channelEligibleCount,
      samples,
    });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        code: 'DB_MIGRATION_PENDING',
        error: 'DB 마이그레이션 필요: 운영자에게 customers 컬럼 확인을 요청해주세요.',
      });
    }
    console.error('[targets/count] 실패:', err);
    return res.status(500).json({ success: false, error: '타겟 인원 조회 실패' });
  }
});

/**
 * POST /api/targets/recipients — 추출 타겟 리스트 페이징 조회 (TargetExtractModal 발송툴 공용 · 2026-07-09)
 *   { channel, filter, page, pageSize } → { recipients, total, page, pageSize }
 *   - /extract와 동일 필터(buildCustomerFilter, storeCodeMode:'skip') + 채널 자격(buildChannelEligibilityWhere).
 *   - 컬럼은 /extract 샘플 SQL과 동일(운영 중 검증됨). SELECT 전용. 게이트 ai_messaging.
 *   - "추출된 타겟 N명"을 눌러 실제 대상 리스트를 15명씩 확인하는 공용 모달(TargetRecipientsModal)이 소비.
 */
router.post('/recipients', requirePlanFeature('ai_messaging'), async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }

    const { channel, filter, page, pageSize } = req.body as {
      channel?: string;
      filter?: Record<string, unknown>;
      page?: number;
      pageSize?: number;
    };
    if (!channel || !VALID_CHANNELS.includes(channel as ChannelKey)) {
      return res.status(400).json({ success: false, error: '지원하지 않는 채널입니다. (email / dm / inapp / kakao)' });
    }
    const ch = channel as ChannelKey;
    const safeFilter = filter && typeof filter === 'object' ? filter : {};
    const p = Math.max(1, Math.floor(Number(page) || 1));
    const size = Math.min(100, Math.max(1, Math.floor(Number(pageSize) || 15)));
    const offset = (p - 1) * size;

    // /extract와 동일 필터·채널 자격 (storeCodeMode:'skip' — extract 카운트와 일치)
    const { sql: filterSql, params } = buildCustomerFilter(safeFilter, {
      tableAlias: 'c',
      startParamIndex: 2,
      storeCodeMode: 'skip',
      inputFormat: 'structured',
    });
    const channelWhere = buildChannelEligibilityWhere(ch, 'c');
    const baseParams = [companyId, ...params];

    const countSql = `SELECT COUNT(*)::int AS cnt FROM customers c WHERE c.company_id = $1::uuid AND (${channelWhere})${filterSql}`;
    const listSql = `
      SELECT c.id, c.phone, c.name, c.gender, c.grade, c.region, c.last_purchase_date, c.total_purchase_amount
        FROM customers c
       WHERE c.company_id = $1::uuid AND (${channelWhere})${filterSql}
       ORDER BY c.id ASC
       LIMIT $${baseParams.length + 1} OFFSET $${baseParams.length + 2}`;

    const [countRes, listRes] = await Promise.all([
      query(countSql, baseParams),
      query(listSql, [...baseParams, size, offset]),
    ]);

    const total = Number(countRes.rows[0]?.cnt ?? 0);
    const recipients = listRes.rows.map((r: any) => ({
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
    if (err instanceof SegmentGenerationError) {
      return res.status(400).json({ success: false, code: err.code, error: err.message });
    }
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        code: 'DB_MIGRATION_PENDING',
        error: 'DB 마이그레이션 필요: 운영자에게 customers 컬럼 확인을 요청해주세요.',
      });
    }
    console.error('[targets/recipients] 실패:', err);
    return res.status(500).json({ success: false, error: '타겟 리스트 조회 실패' });
  }
});

export default router;
