/**
 * 카카오 검수 폴링 — 결과가 이미 난 템플릿은 IMC를 다시 부르지 않는다 (★2026-09-26 한줄로 전수점검 P-04)
 *
 * 5분 폴링 대상에 "승인·반려됐지만 검수 알림 미발송" 템플릿이 들어 있었다. 알림 받을 번호가 없는 회사는 알림이 영원히 안 나가
 * 5분마다 IMC 단건 GET + 무조건 UPDATE + 에러 로그를 영구 반복했다(0926 운영 실측 = 156건 · 70일 UPDATE 119만 회).
 * 처방: 검수 중 템플릿만 IMC를 조회한다. 종결 템플릿은 DB에 있는 결과(status·reject_reason)로 알림만 재시도하고,
 * 알림을 못 보냈으면 6시간 뒤에 다시 본다(D188 "번호를 늦게 등록한 회사도 결국 알림을 받는다" 보존).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const imcGet = vi.fn();
const queryMock = vi.fn();
const bulkInsert = vi.fn(async () => undefined);

vi.mock('../../config/database', () => ({ query: (...a: any[]) => (queryMock as any)(...a) }));
vi.mock('../alimtalk-api', () => ({ getAlimtalkTemplate: (...a: any[]) => (imcGet as any)(...a) }));
vi.mock('../sms-queue', () => ({
  getAuthSmsTable: async () => 'SMSQ_SEND_AUTH',
  bulkInsertSmsQueue: (...a: any[]) => (bulkInsert as any)(...a),
}));
vi.mock('../kakao-template-sync', () => ({ syncSingleTemplateCode: async () => undefined }));

import { syncPendingTemplatesJob } from '../alimtalk-jobs';

const terminalRow = {
  id: 't-1', company_id: 'c-1', profile_key: 'pk-1', profile_name: '인비토', template_code: 'B_1', template_key: 'k1',
  template_name: '가을 할인', status: 'APPROVED', alarm_notified_status: null, reject_reason: null,
};

type Route = { match: (sql: string) => boolean; rows: any[] };
function routeQueries(routes: Route[]) {
  queryMock.mockImplementation(async (sql: string) => {
    const r = routes.find((x) => x.match(sql));
    return { rows: r ? r.rows : [], rowCount: r ? r.rows.length : 1 };
  });
}
const isInProgressSelect = (s: string) => s.includes('FROM kakao_templates t') && s.includes("'KREQ'");
const isTerminalSelect = (s: string) => s.includes('FROM kakao_templates t') && s.includes("t.status IN ('APPROVED','REJECTED','KREJ')") && !s.includes("'KREQ'");

describe('syncPendingTemplatesJob', () => {
  beforeEach(() => {
    process.env.IMC_ENV = 'PRD';
    process.env.IMC_API_KEY = 'test-key';
    process.env.IMC_BASE_URL_PRD = 'https://imc.invalid';
    imcGet.mockReset();
    queryMock.mockReset();
    bulkInsert.mockClear();
  });

  it('검수 중 조회는 진행 중 상태만 고른다(종결·미알림을 섞지 않는다)', async () => {
    routeQueries([]);
    await syncPendingTemplatesJob();
    const inProgress = queryMock.mock.calls.map((c) => String(c[0])).find(isInProgressSelect);
    expect(inProgress).toBeDefined();
    expect(inProgress).not.toContain('alarm_notified_status IS NULL');
    expect(inProgress).toContain("INTERVAL '5 minutes'");
  });

  it('종결·미알림 재시도는 6시간 간격으로 고른다', async () => {
    routeQueries([]);
    await syncPendingTemplatesJob();
    const terminal = queryMock.mock.calls.map((c) => String(c[0])).find(isTerminalSelect);
    expect(terminal).toBeDefined();
    expect(terminal).toContain('t.alarm_notified_status IS NULL');
    expect(terminal).toContain("INTERVAL '6 hours'");
  });

  it('종결 템플릿은 IMC를 부르지 않고, 받을 사람이 없으면 6시간 표식만 남긴다', async () => {
    routeQueries([
      { match: isTerminalSelect, rows: [terminalRow] },
      { match: (s) => s.includes('FROM kakao_alarm_users'), rows: [] },
    ]);
    await syncPendingTemplatesJob();
    expect(imcGet).not.toHaveBeenCalled();
    const updates = queryMock.mock.calls.filter((c) => String(c[0]).includes('UPDATE kakao_templates'));
    expect(updates).toHaveLength(1);
    expect(String(updates[0][0])).toContain('last_synced_at = now()');
    expect(String(updates[0][0])).not.toContain('alarm_notified_status =');
    expect(updates[0][1]).toEqual(['t-1']);
  });

  it('종결 템플릿에 받을 사람이 있으면 DB 결과로 알림을 보내고 알림 완료를 표시한다(IMC 호출 0)', async () => {
    routeQueries([
      { match: isTerminalSelect, rows: [{ ...terminalRow, status: 'KREJ', reject_reason: '광고 문구 포함' }] },
      { match: (s) => s.includes('SELECT name, phone_number') && s.includes('FROM kakao_alarm_users'), rows: [{ name: '담당', phone_number: '01000000000' }] },
      { match: (s) => s.includes('SELECT admin_phone_number FROM kakao_sender_profiles'), rows: [{ admin_phone_number: '0212345678' }] },
    ]);
    await syncPendingTemplatesJob();
    expect(imcGet).not.toHaveBeenCalled();
    expect(bulkInsert).toHaveBeenCalledTimes(1);
    const marked = queryMock.mock.calls.find((c) => String(c[0]).includes('SET alarm_notified_status = $1'));
    expect(marked).toBeDefined();
    expect(marked![1]).toEqual(['REJECTED', 't-1']);
  });

  it('검수 중 템플릿은 지금처럼 IMC를 조회한다', async () => {
    routeQueries([
      { match: isInProgressSelect, rows: [{ ...terminalRow, status: 'KREQ' }] },
    ]);
    imcGet.mockResolvedValue({ code: '0000', data: { inspectionStatus: 'KREQ' } });
    await syncPendingTemplatesJob();
    expect(imcGet).toHaveBeenCalledTimes(1);
  });
});
