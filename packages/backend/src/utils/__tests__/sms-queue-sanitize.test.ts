/**
 * sms-queue-sanitize.test.ts — 적재 길목에서 통신사 규격 외 문자가 실제로 정리되는가 (2026-09-10)
 *
 * ⛔ 0910 시세이도 MMS 864건: 본문 en dash(U+2013)로 게이트웨이가 "EUC-KR 인코딩 불가" 전량 반려.
 * 반려분은 Agent 저널에 claimed 로 갇혀 재시도만 돌았고, 담당자에게는 "대기에서 안 빠짐"으로만 보였다.
 * 치환표(CT-46)는 있었는데 저니·AI 경로에서만 불려, 일반 캠페인 발송은 한 번도 안 거쳤다.
 *
 * 이 테스트는 소스에 함수 이름이 있는지가 아니라 **INSERT 파라미터에 들어간 값**을 본다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mysqlQueryMock } = vi.hoisted(() => {
  process.env.SMS_TABLES = 'SMSQ_SEND_1';
  return { mysqlQueryMock: vi.fn() };
});

vi.mock('../../config/database', () => ({
  mysqlQuery: mysqlQueryMock,
  query: vi.fn(async () => ({ rows: [] })),
  pool: { connect: vi.fn() },
  default: { connect: vi.fn(), query: vi.fn() },
}));

import { bulkInsertSmsQueue } from '../sms-queue';

/** row = [dest_no, call_back, msg_contents, msg_type, title_str, sendTime, app_etc1, app_etc2, f1, f2, f3] */
function makeRow(body: string, title: string): any[] {
  return ['01000000000', '0212345678', body, 'L', title, '', 'camp-1', '', '', '', ''];
}

describe('bulkInsertSmsQueue — 적재 직전 통신사 규격 외 문자 정리', () => {
  beforeEach(() => {
    mysqlQueryMock.mockReset();
    mysqlQueryMock.mockResolvedValue({ affectedRows: 1 });
  });

  it('en dash 가 하이픈으로 바뀐 채 INSERT 된다', async () => {
    const rows = [makeRow('가을 – 겨울 기획전', '9/10 – 9/25')];
    await bulkInsertSmsQueue(['SMSQ_SEND_1'], rows, true);

    const inserts = mysqlQueryMock.mock.calls.filter(c => /INSERT/i.test(String(c[0])));
    expect(inserts.length).toBeGreaterThan(0);
    const params = inserts.flatMap(c => (c[1] as any[]) || []);

    // 이 두 줄이 0910 회귀다. 원본이 그대로 실리면 게이트웨이가 전량 반려한다.
    expect(params).toContain('가을 - 겨울 기획전');
    expect(params).toContain('9/10 - 9/25');
    expect(params.some(p => typeof p === 'string' && p.includes('–'))).toBe(false);
  });

  it('rows 자체도 정리된 값으로 남는다 — 적재된 문안과 기록이 갈리지 않게', async () => {
    const rows = [makeRow('봄 – 여름', '제목 – 부제')];
    await bulkInsertSmsQueue(['SMSQ_SEND_1'], rows, true);

    expect(rows[0][2]).toBe('봄 - 여름');
    expect(rows[0][4]).toBe('제목 - 부제');
  });

  it('규격에 맞는 문안은 한 글자도 건드리지 않는다', async () => {
    const body = '가을 - 겨울 기획전 안내입니다. 9/10 ~ 9/25';
    const rows = [makeRow(body, '한가위 기획전')];
    await bulkInsertSmsQueue(['SMSQ_SEND_1'], rows, true);

    expect(rows[0][2]).toBe(body);
    expect(rows[0][4]).toBe('한가위 기획전');
  });
});
