/**
 * pending-badges.test.ts — 슈퍼관리자 상단 메뉴 대기 뱃지 축 계약 (2026-09-14 발신프로필 축 신설)
 *
 * 0914 Harold: 발신프로필 등록 승인 요청이 와 있는데 "발송 관리" 메뉴에 불이 안 켜졌다.
 * 원인 = 그 대기를 세는 축이 아예 없었다(요금/정산 4축뿐). 여기서 고정하는 것 셋 —
 * ①`senderProfiles` 축이 있고 ②산식이 화면 승인대기 탭과 같다(approval_status 비었거나 PENDING_APPROVAL)
 * ③한 축의 실패는 null 로 격리되고 다른 축은 그대로다(0 으로 내리면 대기가 화면에서 사라진다).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryMock, rechargeMock } = vi.hoisted(() => ({ queryMock: vi.fn(), rechargeMock: vi.fn() }));

vi.mock('../../config/database', () => ({
  query: queryMock,
  mysqlQuery: vi.fn(async () => []),
  pool: { connect: vi.fn() },
  default: { connect: vi.fn(), query: vi.fn() },
}));
vi.mock('../ai-credit-recharge', () => ({ countRechargeRequests: rechargeMock }));

import { getPendingBadgeCounts } from '../pending-badges';

const SENDER_SQL = "COALESCE(approval_status, 'PENDING_APPROVAL') = 'PENDING_APPROVAL'";

describe('getPendingBadgeCounts — 발신프로필 승인대기 축', () => {
  beforeEach(() => {
    queryMock.mockReset();
    rechargeMock.mockReset();
    rechargeMock.mockResolvedValue(2);
  });

  it('senderProfiles 를 화면 승인대기 탭과 같은 산식으로 센다', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('kakao_sender_profiles')) {
        expect(sql).toContain(SENDER_SQL);
        return { rows: [{ n: 3 }] };
      }
      return { rows: [{ n: 1 }] };
    });
    const r = await getPendingBadgeCounts();
    expect(r.senderProfiles).toBe(3);
    expect(r.planRequests).toBe(1);
    expect(r.credits).toBe(2);
  });

  it('발신프로필 축이 깨져도 null 로 격리되고 나머지 축은 그대로다', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('kakao_sender_profiles')) throw new Error('relation missing');
      return { rows: [{ n: 4 }] };
    });
    const r = await getPendingBadgeCounts();
    expect(r.senderProfiles).toBeNull();
    expect(r.planRequests).toBe(4);
    expect(r.deposits).toBe(4);
  });
});
