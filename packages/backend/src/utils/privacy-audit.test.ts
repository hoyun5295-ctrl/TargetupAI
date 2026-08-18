/**
 * 개인정보 처리 이력 — 전송자격인증 4.2 (★2026-08-18)
 *
 * 못 박는 것:
 *   1. 개인정보가 파일로 나가면 **누가·언제·무엇을·몇 건**이 남는다.
 *   2. ⛔ **원본 개인정보를 로그에 담지 않는다** — 담으면 지키려고 만든 로그가 개인정보 사본이 된다.
 *   3. uuid가 아닌 참조를 `target_id`(uuid 컬럼)에 넣지 않는다 — 타입 오류로 로그가 죽으면 이력이 비게 된다.
 *   4. 로그 실패가 본 기능(다운로드)을 막지 않는다.
 *   5. 개인정보 반출 경로 전부에 기록이 붙어 있다(소스 불변식).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));

import { query } from '../config/database';
import { logPrivacyExport, logPrivacyPurge } from './privacy-audit';

const q = query as unknown as ReturnType<typeof vi.fn>;

const REQ: any = {
  ip: '211.234.56.78',
  headers: { 'user-agent': 'vitest' },
  user: { userId: 'u-1', companyId: 'c-1', userType: 'company_admin' },
  query: { grade: 'VIP', region: '서울' },
};

describe('개인정보 반출 이력', () => {
  beforeEach(() => {
    q.mockReset();
    q.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  it('누가·무엇을·몇 건이 audit_logs에 남는다', async () => {
    await logPrivacyExport({ req: REQ, kind: 'customers', count: 1234 });

    const [sql, params] = q.mock.calls[0];
    expect(String(sql)).toMatch(/INSERT INTO audit_logs/i);
    expect(String(sql)).toMatch(/'privacy_export'/);
    expect(params[0]).toBe('u-1');
    expect(params[1]).toBe('customers');
    const details = JSON.parse(params[3]);
    expect(details.count).toBe(1234);
    expect(details.companyId).toBe('c-1');
    expect(params[4]).toBe('211.234.56.78');
  });

  it('★ 원본 개인정보를 담지 않는다 — 필터는 값이 아니라 축 이름만', async () => {
    await logPrivacyExport({
      req: REQ,
      kind: 'customers',
      count: 3,
      filterKeys: Object.keys(REQ.query),
    });

    const serialized = JSON.stringify(q.mock.calls[0][1]);
    expect(serialized).not.toContain('VIP');   // 필터 값
    expect(serialized).not.toContain('서울');
    const details = JSON.parse(q.mock.calls[0][1][3]);
    expect(details.filterKeys).toEqual(['grade', 'region']); // 축 이름만
  });

  it('uuid 참조는 target_id로, 그 밖의 참조는 details로 간다', async () => {
    const uuid = '11111111-1111-1111-1111-111111111111';
    await logPrivacyExport({ req: REQ, kind: 'send_detail', targetId: uuid });
    expect(q.mock.calls[0][1][2]).toBe(uuid);

    q.mockClear();
    await logPrivacyExport({ req: REQ, kind: 'address_book', targetId: '기본 주소록' });
    expect(q.mock.calls[0][1][2]).toBeNull();
    expect(JSON.parse(q.mock.calls[0][1][3]).targetRef).toBe('기본 주소록');
  });

  it('로그가 실패해도 다운로드를 막지 않는다', async () => {
    q.mockRejectedValue(new Error('DB down'));
    await expect(logPrivacyExport({ req: REQ, kind: 'customers', count: 1 })).resolves.toBeUndefined();
  });

  it('대량 삭제는 privacy_purge로 남는다', async () => {
    await logPrivacyPurge({ req: REQ, kind: 'customers', count: 500, reason: '계약 종료' });
    expect(String(q.mock.calls[0][0])).toMatch(/'privacy_purge'/);
    expect(JSON.parse(q.mock.calls[0][1][3]).count).toBe(500);
  });

  it('로그인하지 않은 요청도 기록은 남는다 — 사용자만 비어 있다', async () => {
    await logPrivacyExport({ req: { ip: '1.2.3.4', headers: {} } as any, kind: 'customers' });
    expect(q.mock.calls[0][1][0]).toBeNull();
  });
});

describe('반출 경로 전수 — 기록이 빠진 곳이 없다', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

  const EXPORT_ROUTES: Array<[string, string]> = [
    ['../routes/customers.ts', '고객 DB 엑셀'],
    ['../routes/results.ts', '발송결과·발송상세'],
    ['../routes/unsubscribes.ts', '수신거부 목록'],
    ['../routes/address-books.ts', '주소록'],
    ['../routes/admin.ts', '슈퍼 수신거부·발송상세'],
  ];

  it.each(EXPORT_ROUTES)('%s (%s)에 반출 기록이 있다', (path) => {
    expect(read(path)).toMatch(/logPrivacyExport\(/);
  });

  it('발송상세(수신번호)는 두 경로 모두 기록한다', () => {
    expect(read('../routes/results.ts')).toMatch(/kind: 'send_detail'/);
    expect(read('../routes/admin.ts')).toMatch(/kind: 'send_detail'/);
  });
});
