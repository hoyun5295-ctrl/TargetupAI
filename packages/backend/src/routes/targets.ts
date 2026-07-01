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
    const { filter, explanation } = await convertNaturalLanguageToFilter({
      companyId,
      naturalLanguage,
      customFieldKeys: Array.isArray(customFieldKeys) ? customFieldKeys : undefined,
    });

    // 2. filter → 안전 SQL ($1 = companyId, $2~ = filter 값)
    const { sql: filterSql, params } = buildCustomerFilter(filter, {
      tableAlias: 'c',
      startParamIndex: 2,
      storeCodeMode: 'skip',
      inputFormat: 'structured',
    });
    const channelWhere = buildChannelEligibilityWhere(ch, 'c');
    const fullParams = [companyId, ...params];

    // 3. 전체 매칭 + 채널 자격 + 샘플 (채널 자격자 기준 5건)
    const matchSql = `SELECT COUNT(*)::int AS cnt FROM customers c WHERE c.company_id = $1::uuid${filterSql}`;
    const eligSql = `SELECT COUNT(*)::int AS cnt FROM customers c WHERE c.company_id = $1::uuid AND (${channelWhere})${filterSql}`;
    const sampleSql = `
      SELECT c.id, c.phone, c.name, c.gender, c.region, c.last_purchase_date, c.total_purchase_amount
        FROM customers c
       WHERE c.company_id = $1::uuid AND (${channelWhere})${filterSql}
       ORDER BY c.id ASC
       LIMIT 5`;

    const [matchRes, eligRes, sampleRes] = await Promise.all([
      query(matchSql, fullParams),
      query(eligSql, fullParams),
      query(sampleSql, fullParams),
    ]);

    const matchCount = Number(matchRes.rows[0]?.cnt ?? 0);
    const channelEligibleCount = Number(eligRes.rows[0]?.cnt ?? 0);

    // 4. 0건 자동완화 X (D171) — 조건 자체가 0이면 조건 정정 안내
    if (matchCount === 0) {
      return res.status(400).json({
        success: false,
        code: 'ZERO_MATCH',
        error: '조건에 맞는 고객이 0명입니다. 조건을 더 넓혀주세요. (자동 완화는 마케팅 의도 보호를 위해 차단됩니다)',
      });
    }

    const samples = sampleRes.rows.map((r: any) => ({
      id: r.id,
      phone: r.phone,
      name: r.name,
      gender: r.gender,
      region: r.region,
      last_purchase_date: r.last_purchase_date,
      total_purchase_amount: r.total_purchase_amount != null ? Number(r.total_purchase_amount) : null,
    }));

    return res.json({
      success: true,
      channel: ch,
      filter,
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
        error: 'DB 마이그레이션 필요 — 운영자에게 customers 컬럼 확인을 요청해주세요.',
      });
    }
    console.error('[targets/extract] 실패:', err);
    return res.status(500).json({ success: false, error: '타겟 추출 실패' });
  }
});

export default router;
