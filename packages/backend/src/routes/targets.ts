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
    //    ★ 2026-07-02(3) isAll = "전체 고객" — filter {} = 조건 없음 = 아래 SQL이 자연히 전체 카운트
    const { filter, explanation, isAll } = await convertNaturalLanguageToFilter({
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
    // ★ 2026-07-02(3) grade 동봉 — 발송 모달 미리보기가 하드코딩 샘플 대신 실제 추출 타겟으로 치환 (SCHEMA.md:418 실측)
    const sampleSql = `
      SELECT c.id, c.phone, c.name, c.gender, c.grade, c.region, c.last_purchase_date, c.total_purchase_amount
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
      grade: r.grade,
      region: r.region,
      last_purchase_date: r.last_purchase_date,
      total_purchase_amount: r.total_purchase_amount != null ? Number(r.total_purchase_amount) : null,
    }));

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
        error: 'DB 마이그레이션 필요 — 운영자에게 customers 컬럼 확인을 요청해주세요.',
      });
    }
    console.error('[targets/extract] 실패:', err);
    return res.status(500).json({ success: false, error: '타겟 추출 실패' });
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
        error: 'DB 마이그레이션 필요 — 운영자에게 customers 컬럼 확인을 요청해주세요.',
      });
    }
    console.error('[targets/recipients] 실패:', err);
    return res.status(500).json({ success: false, error: '타겟 리스트 조회 실패' });
  }
});

export default router;
