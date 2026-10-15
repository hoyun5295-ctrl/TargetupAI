/**
 * ★2026-10-15 박성용 접수(에스디몰 스마일패스): 휴머스온(IMC)에서 장기 미사용으로 삭제된 발신프로필이 한줄로에선 살아 있었다.
 *   - 1시간 동기화(syncSenderStatusJob)가 IMC 상태 D 를 status 에 적기만 하고 is_active 는 그대로 둬, 고객사 화면에 그대로 보였다
 *     (실측: 「스마일패스」 두 줄 · 옛 줄 status=D · is_active=t · 채널 ID `@스마일패스_미사용`).
 *   - 수정 = 상태 D 를 받은 자리에서 9월 12일 「사용 중지」 CT(disableSenderProfile)를 그대로 불러 활성을 내리고 감사 기록(행위자 없음).
 *     다음 주기부터는 SELECT 가 DELETED 를 빼므로 다시 보지 않는다. 재등록은 활성만 보는 중복 검사·유니크 인덱스가 막지 않는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const queryMock = vi.fn();
const getSenderMock = vi.fn();
const disableMock = vi.fn();

vi.mock('../../config/database', () => ({ query: (...a: any[]) => (queryMock as any)(...a) }));
vi.mock('../alimtalk-api', () => ({ getSender: (...a: any[]) => (getSenderMock as any)(...a) }));
vi.mock('../sms-queue', () => ({ getAuthSmsTable: async () => 'SMSQ_SEND_AUTH', bulkInsertSmsQueue: async () => undefined }));
vi.mock('../kakao-template-sync', () => ({ syncSingleTemplateCode: async () => undefined }));
vi.mock('../auto-notify-message', () => ({ buildTemplateInspectionNotifyMessage: () => '' }));
vi.mock('../kakao-sender-profile-admin', () => ({
  SENDER_PROFILE_DISABLED_STATUS: 'DELETED',
  disableSenderProfile: (...a: any[]) => (disableMock as any)(...a),
}));

import { syncSenderStatusJob } from '../alimtalk-jobs';

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const PROFILE = { id: '11111111-1111-4111-8111-111111111111', profile_key: 'key-smilepass-old', status: 'A', yellow_id: '@스마일패스' };
const isSelect = (s: string) => s.includes('FROM kakao_sender_profiles') && s.includes("NOT IN ('DELETED')");
const isUpdate = (s: string) => s.includes('UPDATE kakao_sender_profiles') && s.includes('block_yn');

describe('IMC 삭제(D) 발신프로필 = 동기화가 사용 중지까지 내린다', () => {
  beforeEach(() => {
    process.env.IMC_ENV = 'PRD';
    process.env.IMC_API_KEY = 'test-key';
    process.env.IMC_BASE_URL_PRD = 'https://imc.invalid';
    queryMock.mockReset(); getSenderMock.mockReset(); disableMock.mockReset();
    queryMock.mockImplementation(async (sql: string) => (isSelect(sql) ? { rows: [PROFILE] } : { rows: [] }));
    disableMock.mockResolvedValue({ ok: true, profile: { id: PROFILE.id, companyName: '에스디몰', profileName: '스마일패스', yellowId: '@스마일패스_미사용', templateCount: 0, brandTemplateCount: 0 } });
  });

  it('상태 D: 상태·채널 ID 갱신(UPDATE) 뒤 같은 프로필을 사용 중지 CT 로 내린다 · 행위자 없음(동기화)', async () => {
    getSenderMock.mockResolvedValue({ code: '0000', data: { status: 'D', uuid: '@스마일패스_미사용', block: false, dormant: false, brandMessage: false, createdAt: null } });
    await syncSenderStatusJob();
    const updates = queryMock.mock.calls.filter((c) => isUpdate(String(c[0])));
    expect(updates).toHaveLength(1);
    expect(updates[0][1][0]).toBe('D');            // status = IMC 값 그대로(그 뒤 CT 가 DELETED 로 내린다)
    expect(updates[0][1][6]).toBe(PROFILE.id);
    expect(disableMock).toHaveBeenCalledTimes(1);
    expect(disableMock).toHaveBeenCalledWith({ profileId: PROFILE.id, actorUserId: null });
    // UPDATE 가 먼저, 사용 중지가 나중(상태를 COALESCE 로 덮는 UPDATE 가 뒤에 오면 DELETED 가 D 로 되돌아간다)
    const updateOrder = queryMock.mock.invocationCallOrder[queryMock.mock.calls.findIndex((c) => isUpdate(String(c[0])))];
    expect(updateOrder).toBeLessThan(disableMock.mock.invocationCallOrder[0]);
  });

  it('상태 A(정상)·휴면·차단은 사용 중지하지 않는다(그 셋은 플래그로만 적는다)', async () => {
    getSenderMock.mockResolvedValue({ code: '0000', data: { status: 'A', uuid: '@스마일패스', block: true, dormant: true, brandMessage: false, createdAt: null } });
    await syncSenderStatusJob();
    expect(disableMock).not.toHaveBeenCalled();
    const upd = queryMock.mock.calls.find((c) => isUpdate(String(c[0])))!;
    expect(upd[1][2]).toBe('Y');   // block_yn
    expect(upd[1][3]).toBe('Y');   // dormant_yn
  });

  it('조회 자체가 안 되는 키(4011 등)는 종전대로 건너뛰고 세기만 한다 · 사용 중지하지 않는다', async () => {
    getSenderMock.mockResolvedValue({ code: '4011', data: null });
    await syncSenderStatusJob();
    expect(disableMock).not.toHaveBeenCalled();
    expect(queryMock.mock.calls.some((c) => isUpdate(String(c[0])))).toBe(false);
  });

  it('소스 고정: 다음 주기 SELECT 는 DELETED 를 빼고 · CT 의 중지 상태 = DELETED · 재등록 중복 검사는 활성만', () => {
    const jobs = read('backend/src/utils/alimtalk-jobs.ts');
    expect(jobs).toContain("AND COALESCE(status, 'PENDING') NOT IN ('DELETED')");
    expect(jobs).toContain("if (d.status === 'D') {");
    expect(jobs).toContain('const r = await disableSenderProfile({ profileId: row.id, actorUserId: null });');
    expect(read('backend/src/utils/kakao-sender-profile-admin.ts')).toContain("export const SENDER_PROFILE_DISABLED_STATUS = 'DELETED';");
    const routes = read('backend/src/routes/alimtalk.ts');
    expect(routes).toContain('WHERE company_id = $1 AND yellow_id = $2 AND COALESCE(is_active, true) = true');
  });
});
