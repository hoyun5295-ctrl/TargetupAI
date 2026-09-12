/**
 * target-count.ts — 비-문자 채널 타겟 카운트·샘플 조회 (CT)
 *
 * 🎯 목적
 *   "이 조건으로 몇 명인가 / 이 채널로 몇 명에게 보낼 수 있는가 / 어떤 고객인가"를 한 곳에서 답한다.
 *   조건을 만든 방법(AI 자연어 변환 · 화면에서 직접 선택)과 무관하게 **숫자를 내는 SQL은 한 벌**이어야
 *   미리보기 인원수와 실제 발송 인원수가 갈라지지 않는다(LESSONS D230+ · 검증 경로 = 발송 경로).
 *
 * 소비처
 *   - POST /api/targets/extract  (자연어 → filter → 여기)
 *   - POST /api/targets/count    (화면에서 직접 고른 filter → 여기)   ★ 2026-09-12 신설
 *
 * ⛔ 원칙
 *   - 필터 SQL은 CT-01 buildCustomerFilter(structured), 채널 자격은 CT buildChannelEligibilityWhere만 쓴다.
 *   - storeCodeMode는 'skip' — 종전 /extract·/recipients와 같은 값이다. 여기만 바꾸면 카운트가 서로 어긋난다.
 *   - 0건은 여기서 판정하지 않는다(자동 완화 금지 규율의 안내·차단은 호출부 몫).
 */

import { query } from '../config/database';
import { buildCustomerFilter } from './customer-filter';
import { buildChannelEligibilityWhere, type ChannelKey } from './channel-eligibility';

export interface TargetSampleRow {
  id: string;
  phone: string | null;
  name: string | null;
  gender: string | null;
  grade: string | null;
  region: string | null;
  last_purchase_date: string | null;
  total_purchase_amount: number | null;
}

export interface TargetCountResult {
  /** 조건에 맞는 전체 고객 (회사 격리 + filter) */
  matchCount: number;
  /** 그 채널로 실제 보낼 수 있는 인원 (채널 자격 WHERE 추가) */
  channelEligibleCount: number;
  /** 채널 자격자 기준 샘플 5건 — 발송 화면 미리보기 개인화 치환용 */
  samples: TargetSampleRow[];
}

/**
 * 조건(structured filter)으로 인원수 2종 + 샘플 5건을 한 번에 조회한다.
 * @param companyId 회사 uuid (회사 격리 · $1)
 * @param channel   발송 채널 (자격 WHERE 결정)
 * @param filter    CT-01 structured filter. 빈 객체 = 조건 없음 = 전체.
 */
export async function countTargetByFilter(
  companyId: string,
  channel: ChannelKey,
  filter: Record<string, unknown>,
): Promise<TargetCountResult> {
  const { sql: filterSql, params } = buildCustomerFilter(filter, {
    tableAlias: 'c',
    startParamIndex: 2,
    storeCodeMode: 'skip',
    inputFormat: 'structured',
  });
  const channelWhere = buildChannelEligibilityWhere(channel, 'c');
  const fullParams = [companyId, ...params];

  const matchSql = `SELECT COUNT(*)::int AS cnt FROM customers c WHERE c.company_id = $1::uuid${filterSql}`;
  const eligSql = `SELECT COUNT(*)::int AS cnt FROM customers c WHERE c.company_id = $1::uuid AND (${channelWhere})${filterSql}`;
  // grade 동봉 — 발송 모달 미리보기가 하드코딩 샘플 대신 실제 추출 타겟으로 치환 (SCHEMA.md:418 실측)
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

  return {
    matchCount: Number(matchRes.rows[0]?.cnt ?? 0),
    channelEligibleCount: Number(eligRes.rows[0]?.cnt ?? 0),
    samples: sampleRes.rows.map((r: any) => ({
      id: r.id,
      phone: r.phone,
      name: r.name,
      gender: r.gender,
      grade: r.grade,
      region: r.region,
      last_purchase_date: r.last_purchase_date,
      total_purchase_amount: r.total_purchase_amount != null ? Number(r.total_purchase_amount) : null,
    })),
  };
}
