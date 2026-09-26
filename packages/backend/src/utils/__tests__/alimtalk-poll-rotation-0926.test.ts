/**
 * 카카오 검수 중 폴링 — 오래된 순으로 돌고, IMC가 거절한 행도 다음 주기로 넘긴다 (★2026-09-26 한줄로 V2 S1-H10)
 *
 * 검수 중 템플릿 폴링이 순서 없이 100건만 집고, IMC가 오류 코드를 준 행(발신프로필 삭제 4011 등)은 시각을 찍지 않고 넘겼다.
 * 그런 행은 매 주기 다시 집혀, 100건을 넘으면 다른 회사의 검수 중 템플릿이 영영 조회되지 않았다(승인돼도 화면·알림이 안 바뀜).
 *
 * 못 박는 것
 *   1. 후보 = 마지막 조회가 오래된 순(NULLS FIRST) 100건.
 *   2. IMC 오류·빈 응답·상태 없음 행도 last_synced_at을 찍어 5분 뒤로 돌린다(이 칸은 폴링 커서 · 화면 표시 없음 = 0926 확인).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const imcGet = vi.fn();
const queryMock = vi.fn();

vi.mock('../../config/database', () => ({ query: (...a: any[]) => (queryMock as any)(...a) }));
vi.mock('../alimtalk-api', () => ({ getAlimtalkTemplate: (...a: any[]) => (imcGet as any)(...a) }));
vi.mock('../sms-queue', () => ({
  getAuthSmsTable: async () => 'SMSQ_SEND_AUTH',
  bulkInsertSmsQueue: async () => undefined,
}));
vi.mock('../kakao-template-sync', () => ({ syncSingleTemplateCode: async () => undefined }));

import { syncPendingTemplatesJob } from '../alimtalk-jobs';

const reviewing = (id: string) => ({
  id, company_id: 'c-1', profile_key: 'pk-gone', profile_name: '인비토', template_code: `B_${id}`, template_key: `k_${id}`,
  template_name: '가을 할인', status: 'KREQ', alarm_notified_status: null,
});
const isInProgressSelect = (s: string) => s.includes('FROM kakao_templates t') && s.includes("'KREQ'");

describe('검수 중 폴링 순환', () => {
  beforeEach(() => {
    process.env.IMC_ENV = 'PRD';
    process.env.IMC_API_KEY = 'test-key';
    process.env.IMC_BASE_URL_PRD = 'https://imc.invalid';
    imcGet.mockReset();
    queryMock.mockReset();
  });

  it('후보는 마지막 조회가 오래된 순(NULLS FIRST) 100건', async () => {
    queryMock.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    await syncPendingTemplatesJob();
    const sel = queryMock.mock.calls.map((c) => String(c[0])).find(isInProgressSelect)!;
    expect(sel).toMatch(/ORDER BY t\.last_synced_at ASC NULLS FIRST\s+LIMIT 100/);
  });

  it('IMC가 오류 코드를 준 행도 시각을 찍어 다음 주기로 넘긴다', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (isInProgressSelect(String(sql))) return { rows: [reviewing('a'), reviewing('b')], rowCount: 2 };
      return { rows: [], rowCount: 1 };
    });
    imcGet.mockResolvedValue({ code: '4011', message: '발신프로필 없음' });
    await syncPendingTemplatesJob();
    const stamps = queryMock.mock.calls.filter((c) => String(c[0]).includes('UPDATE kakao_templates SET last_synced_at = now() WHERE id = ANY($1::uuid[])'));
    expect(stamps).toHaveLength(1);
    expect(stamps[0][1]).toEqual([['a', 'b']]);
  });
});
