/**
 * ★ CT-70: 성과리포트 데이터 부족 진단 컨트롤타워 — D213+ (2026-05-24)
 *
 * 🎯 목적
 *   회사 데이터 영역 부족 진단 + 안내 메시지 매트릭스.
 *   - 4번 메뉴 성과리포트 "데이터 부족 안내 카드" 영역 진정 데이터 source
 *   - Harold 명시 D213+ "실시간 연동된 업체 없는 현실 감안"
 *   - 빈 카드 절대 X = 안내 의무
 *
 * ⛔ 영구 원칙
 *   - CDP 미연동 회사 = 안내 카드 의무 (빈 funnel/매출/ROAS 영역 X)
 *   - 발송 부족 회사 = 안내 카드 의무 (빈 추세/비교 영역 X)
 *   - 안내 메시지 = 회사 admin 실행 가능 영역만 (구체 진입 경로 명시)
 */

import { query } from '../config/database';

export type DataAvailabilityLevel = 'critical' | 'warning' | 'info' | 'good';

export interface DataAvailabilityCard {
  level: DataAvailabilityLevel;
  icon: 'cdp' | 'campaign' | 'customer' | 'event';
  title: string;
  message: string;
  actionLabel?: string;
  actionPath?: string;        // 회사 admin 진입 경로 (예: '/cdp-settings')
}

export interface DataAvailabilityResult {
  customerCount: number;
  campaignCount: number;
  cdpEventCount: number;
  hasCdpIntegration: boolean;
  cards: DataAvailabilityCard[];
  overallLevel: DataAvailabilityLevel;
  computedAt: string;
}

/**
 * 회사 데이터 영역 진단 + 안내 카드 매트릭스.
 *
 * @param companyId - 회사 ID
 */
export async function buildDataAvailability(companyId: string): Promise<DataAvailabilityResult> {
  // 1) 통계 영역 조회 (병렬)
  const [customerRes, campaignRes, cdpEventRes, cdpIntegrationRes] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS cnt FROM customers WHERE company_id = $1::uuid AND is_active = true`,
      [companyId]
    ),
    query(
      `SELECT COUNT(*)::int AS cnt FROM campaigns
         WHERE company_id = $1::uuid
           AND status = 'completed'
           AND sent_at > NOW() - INTERVAL '30 days'`,
      [companyId]
    ),
    query(
      `SELECT COUNT(*)::int AS cnt FROM cdp_events
         WHERE company_id = $1::uuid
           AND occurred_at > NOW() - INTERVAL '30 days'`,
      [companyId]
    ),
    query(
      `SELECT COUNT(*)::int AS cnt FROM company_integrations
         WHERE company_id = $1::uuid
           AND access_token IS NOT NULL`,
      [companyId]
    ),
  ]);

  const customerCount = Number(customerRes.rows[0]?.cnt) || 0;
  const campaignCount = Number(campaignRes.rows[0]?.cnt) || 0;
  const cdpEventCount = Number(cdpEventRes.rows[0]?.cnt) || 0;
  const hasCdpIntegration = Number(cdpIntegrationRes.rows[0]?.cnt) > 0;

  // 2) 카드 매트릭스 생성
  const cards: DataAvailabilityCard[] = [];

  // 2-1. 고객 등록 영역
  if (customerCount === 0) {
    cards.push({
      level: 'critical',
      icon: 'customer',
      title: '고객 등록 X',
      message: '활성 고객 0명. 고객을 등록하시면 성과리포트 영역 활성됩니다.',
      actionLabel: '고객 관리 진입',
      actionPath: '/customers',
    });
  }

  // 2-2. 발송 부족 영역
  if (campaignCount === 0) {
    cards.push({
      level: 'warning',
      icon: 'campaign',
      title: '발송 캠페인 X',
      message: '최근 30일 안 완료 캠페인 0건. 첫 캠페인 발송 후 성과 분석 영역 활성됩니다.',
      actionLabel: 'AI Operator 진입',
      actionPath: '/ai-operator',
    });
  } else if (campaignCount < 3) {
    cards.push({
      level: 'info',
      icon: 'campaign',
      title: '발송 누적 부족',
      message: `최근 30일 ${campaignCount}건 발송. 3건+ 누적 시 추세 / 기간 비교 / AI 추천 정확도 향상.`,
      actionLabel: 'AI Operator 진입',
      actionPath: '/ai-operator',
    });
  }

  // 2-3. CDP 연동 영역
  if (!hasCdpIntegration) {
    cards.push({
      level: 'info',
      icon: 'cdp',
      title: '자사몰 미연동',
      message: '자사몰 연동 시 funnel 시각화 / 매출 / ROAS / 캠페인 반응 매트릭스 자동 활성.',
      actionLabel: '자사몰 연동 진입',
      actionPath: '/cdp-settings',
    });
  } else if (cdpEventCount === 0) {
    cards.push({
      level: 'warning',
      icon: 'event',
      title: '자사몰 이벤트 X',
      message: '자사몰 연동되었으나 최근 30일 이벤트 0건. SDK 설치 또는 webhook 동작 확인 필요.',
      actionLabel: '자사몰 진단 진입',
      actionPath: '/cdp-settings',
    });
  } else if (cdpEventCount < 100) {
    cards.push({
      level: 'info',
      icon: 'event',
      title: 'CDP 이벤트 누적 부족',
      message: `최근 30일 ${cdpEventCount}건 이벤트. 100건+ 누적 시 funnel 정확도 + attribution 정확도 향상.`,
    });
  }

  // 2-4. 모든 영역 충분 시 = good 카드
  if (cards.length === 0) {
    cards.push({
      level: 'good',
      icon: 'event',
      title: '모든 분석 영역 활성',
      message: `고객 ${customerCount.toLocaleString()}명 + 30일 캠페인 ${campaignCount}건 + CDP 이벤트 ${cdpEventCount.toLocaleString()}건 누적. 모든 매트릭스 정확도 정합.`,
    });
  }

  // 3) 전체 level 결정 (가장 심각한 영역 정합)
  const levelPriority: Record<DataAvailabilityLevel, number> = {
    critical: 4,
    warning: 3,
    info: 2,
    good: 1,
  };
  const overallLevel = cards.reduce<DataAvailabilityLevel>(
    (worst, c) => (levelPriority[c.level] > levelPriority[worst] ? c.level : worst),
    'good'
  );

  return {
    customerCount,
    campaignCount,
    cdpEventCount,
    hasCdpIntegration,
    cards,
    overallLevel,
    computedAt: new Date().toISOString(),
  };
}
