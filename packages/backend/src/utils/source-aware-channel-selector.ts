/**
 * ★ CT-75: Source-Aware Channel Selector 컨트롤타워 — D214+ (2026-05-24)
 *
 * 🎯 목적
 *   customer 영역 + 회사 영역 매트릭스 → 최적 채널 자동 선택.
 *   - unified-customer-profile 영역 안 preferred_channel 정합 본질
 *   - 캠페인 영역 발송 시 일괄 채널 분류 매트릭스 (channel별 customer 분리)
 *   - AI Operator / 자동 마케팅 영역 활용 본질
 *
 * ⛔ 영구 원칙
 *   - 채널 우선순위: KAKAO > LMS > SMS > EMAIL > WEB_PUSH > IN_APP > NONE
 *   - 회사 영역 채널 활성 검증 (kakao_sender_profiles + email + cdp_push_subscriptions)
 *   - customer.preferred_channel = unified-profile 옛 계산 정합
 *   - NONE = 발송 X (0건 자동완화 X 영구 룰 정합)
 */

import { query } from '../config/database';
import type { PreferredChannel } from './unified-customer-profile';

export interface ChannelGroupResult {
  channel: PreferredChannel;
  customerIds: string[];
  count: number;
}

export interface ChannelDistribution {
  total: number;
  groups: ChannelGroupResult[];
  unreachable: number;        // NONE 영역 (발송 X)
  computedAt: string;
}

/**
 * customer 영역 매트릭스 → channel별 그룹 분류.
 * AI Operator / 자동 마케팅 영역 안 캠페인 발송 시 활용.
 *
 * @param companyId - 회사 ID
 * @param customerIds - 한줄로 customers.id 매트릭스 (옵션 — 없을 시 회사 전체 active customer 영역)
 */
export async function groupCustomersByChannel(
  companyId: string,
  customerIds?: string[]
): Promise<ChannelDistribution> {
  const whereClause = customerIds && customerIds.length > 0
    ? `c.company_id = $1::uuid AND c.is_active = true AND c.id = ANY($2::uuid[])`
    : `c.company_id = $1::uuid AND c.is_active = true`;
  const params = customerIds && customerIds.length > 0 ? [companyId, customerIds] : [companyId];

  const result = await query(
    `SELECT
        COALESCE(c.preferred_channel, 'NONE') AS channel,
        c.id,
        c.phone, c.email, c.sms_opt_in
       FROM customers c
      WHERE ${whereClause}`,
    params
  );

  const groupMap = new Map<PreferredChannel, string[]>();
  let unreachable = 0;
  for (const r of result.rows) {
    const channel = String(r.channel || 'NONE') as PreferredChannel;
    if (channel === 'NONE') {
      unreachable++;
      continue;
    }
    if (!groupMap.has(channel)) groupMap.set(channel, []);
    groupMap.get(channel)!.push(String(r.id));
  }

  // 채널 우선순위 정렬
  const priority: Record<PreferredChannel, number> = {
    KAKAO: 1, LMS: 2, SMS: 3, EMAIL: 4, WEB_PUSH: 5, IN_APP: 6, NONE: 99,
  };
  const groups: ChannelGroupResult[] = Array.from(groupMap.entries())
    .map(([channel, ids]) => ({ channel, customerIds: ids, count: ids.length }))
    .sort((a, b) => (priority[a.channel] || 99) - (priority[b.channel] || 99));

  return {
    total: result.rows.length,
    groups,
    unreachable,
    computedAt: new Date().toISOString(),
  };
}

/**
 * 회사 영역 안 채널 활성 매트릭스 진단.
 * - KAKAO 활성 = kakao_sender_profiles 영역 안 active + NORMAL
 * - EMAIL 활성 = 옛 D180 영역 SendGrid 영역 정합 (회사 영역 SendGrid 영역 설정 시)
 * - WEB_PUSH 활성 = cdp_push_subscriptions 영역 안 active 영역 존재
 *
 * @param companyId - 회사 ID
 */
export interface CompanyChannelCapabilities {
  smsLms: boolean;            // SMS / LMS 영역 = 회사 영역 항상 활성 (옛 정합)
  kakao: boolean;
  email: boolean;
  webPush: boolean;
  inApp: boolean;
  computedAt: string;
}

export async function getCompanyChannelCapabilities(companyId: string): Promise<CompanyChannelCapabilities> {
  // KAKAO 영역
  const kakaoResult = await query(
    `SELECT 1 FROM kakao_sender_profiles
      WHERE company_id = $1::uuid AND is_active = true AND status = 'NORMAL'
      LIMIT 1`,
    [companyId]
  );
  const kakao = kakaoResult.rows.length > 0;

  // EMAIL 영역 (D180 — SendGrid + 회사 email_from 설정)
  let email = false;
  try {
    const emailResult = await query(
      `SELECT 1 FROM company_settings
        WHERE company_id = $1::uuid AND setting_key = 'email_from' AND setting_value IS NOT NULL
        LIMIT 1`,
      [companyId]
    );
    email = emailResult.rows.length > 0;
  } catch {
    email = false;
  }

  // WEB_PUSH 영역
  let webPush = false;
  try {
    const pushResult = await query(
      `SELECT 1 FROM cdp_push_subscriptions
        WHERE company_id = $1::uuid AND is_active = true
        LIMIT 1`,
      [companyId]
    );
    webPush = pushResult.rows.length > 0;
  } catch {
    webPush = false;
  }

  // IN_APP 영역 (D175-A)
  let inApp = false;
  try {
    const inappResult = await query(
      `SELECT 1 FROM cdp_inapp_messages
        WHERE company_id = $1::uuid AND is_active = true
        LIMIT 1`,
      [companyId]
    );
    inApp = inappResult.rows.length > 0;
  } catch {
    inApp = false;
  }

  return {
    smsLms: true,             // 옛 정합 본질 — 항상 활성
    kakao,
    email,
    webPush,
    inApp,
    computedAt: new Date().toISOString(),
  };
}
