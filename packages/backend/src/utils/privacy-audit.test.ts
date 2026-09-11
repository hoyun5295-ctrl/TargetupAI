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
import { logPrivacyExport, logPrivacyPurge, logPrivacyView, logPrivacyEdit } from './privacy-audit';

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

/**
 * ★ 2026-09-11 전송자격인증 4.2 — 개인정보 **조회·수정** 이력.
 * 그전에는 반출(다운로드)·삭제만 남기고 조회·수정은 남기지 않았다(심사 반려: "조회·수정·삭제 이력을 보관하는가").
 * 남기는 것은 그대로 **누가·언제·어느 화면·몇 건**이고, 원문 값은 넣지 않는다.
 */
describe('개인정보 조회·수정 이력', () => {
  beforeEach(() => {
    q.mockReset();
    q.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  it('조회는 privacy_view로 누가·어느 화면·몇 건이 남는다', async () => {
    await logPrivacyView({ req: REQ, kind: 'customers', count: 50, filterKeys: Object.keys(REQ.query) });

    const [sql, params] = q.mock.calls[0];
    expect(String(sql)).toMatch(/INSERT INTO audit_logs/i);
    expect(params[0]).toBe('u-1');
    expect(params[1]).toBe('privacy_view');
    expect(params[2]).toBe('customers');
    const details = JSON.parse(params[4]);
    expect(details.kind).toBe('customers');
    expect(details.count).toBe(50);
    expect(details.companyId).toBe('c-1');
    expect(details.filterKeys).toEqual(['grade', 'region']);
    expect(params[5]).toBe('211.234.56.78');
  });

  it('★ 조회 기록에 원문 값을 담지 않는다 — 필터는 축 이름만', async () => {
    await logPrivacyView({ req: REQ, kind: 'customer_extract', count: 3, filterKeys: Object.keys(REQ.query) });
    const serialized = JSON.stringify(q.mock.calls[0][1]);
    expect(serialized).not.toContain('VIP');
    expect(serialized).not.toContain('서울');
  });

  it('슈퍼관리자가 다른 회사를 볼 때는 그 회사가 대상으로 남는다', async () => {
    const superReq: any = { ...REQ, user: { userId: 'sa-1', userType: 'super_admin' } };
    await logPrivacyView({ req: superReq, kind: 'customers', count: 10, companyId: 'target-co' });
    const details = JSON.parse(q.mock.calls[0][1][4]);
    expect(details.companyId).toBe('target-co');
    expect(details.userType).toBe('super_admin');
  });

  it('고객 한 명 조회는 target_id에 그 고객 id가 간다 · uuid가 아니면 비운다', async () => {
    const uuid = '22222222-2222-2222-2222-222222222222';
    await logPrivacyView({ req: REQ, kind: 'customer_detail', count: 1, targetId: uuid });
    expect(q.mock.calls[0][1][3]).toBe(uuid);
    q.mockClear();
    await logPrivacyView({ req: REQ, kind: 'customer_detail', count: 1, targetId: 'not-a-uuid' });
    expect(q.mock.calls[0][1][3]).toBeNull();
  });

  it('수정은 privacy_edit로 남는다', async () => {
    await logPrivacyEdit({ req: REQ, kind: 'customer_upload', count: 1200 });
    const params = q.mock.calls[0][1];
    expect(params[1]).toBe('privacy_edit');
    expect(params[2]).toBe('customer_upload');
    expect(JSON.parse(params[4]).count).toBe(1200);
  });

  it('기록이 실패해도 조회·수정을 막지 않는다', async () => {
    q.mockRejectedValue(new Error('DB down'));
    await expect(logPrivacyView({ req: REQ, kind: 'customers', count: 1 })).resolves.toBeUndefined();
    await expect(logPrivacyEdit({ req: REQ, kind: 'customer_single', count: 1 })).resolves.toBeUndefined();
  });
});

describe('조회·수정 경로 전수 — 기록이 빠진 곳이 없다', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
  const customers = read('../routes/customers.ts');

  // 건수만 돌려주는 조건 미리보기(POST /filter)는 개인정보가 나가지 않아 대상이 아니다.
  const VIEW_KINDS = [
    'customers', 'customer_extract', 'customer_detail',
    'customer_purchases', 'customer_timeline', 'purchases_overview',
  ];
  it.each(VIEW_KINDS)('고객DB 조회 경로 %s에 조회 기록이 있다', (kind) => {
    expect(customers).toMatch(new RegExp(`logPrivacyView\\(\\{ req, kind: '${kind}'`));
  });

  it.each(['customer_single', 'customer_bulk'])('고객DB 수정 경로 %s에 수정 기록이 있다', (kind) => {
    expect(customers).toMatch(new RegExp(`logPrivacyEdit\\(\\{ req, kind: '${kind}'`));
  });

  it('고객 파일 업로드(등록·수정)에 수정 기록이 있다', () => {
    expect(read('../routes/upload.ts')).toMatch(/logPrivacyEdit\(\{ req, kind: 'customer_upload'/);
  });
});

/**
 * ★ 2026-09-11 전송자격인증 4.2 — 고객 삭제 감사 기록에 전화번호·이름 원문이 들어가 있었다
 * (개별 삭제 = 이름·번호 · 선택 삭제 = 표본 번호 5개). 감사 기록은 열람 대상이라 원문은 개인정보 사본이 된다.
 */
describe('고객 삭제 감사 기록 — 원문 대신 가린 번호만', () => {
  const src = readFileSync(resolve(__dirname, '../routes/customers.ts'), 'utf8');
  // 검사 범위 = 그 액션의 감사 기록 구간(액션 문자열 ~ 다음 req.ip). 파일 전체를 보면 무관한 응답 코드에 걸린다.
  const auditSegment = (action: string): string => {
    const start = src.indexOf(`'${action}',`);
    expect(start, `${action} 감사 기록을 찾지 못했다`).toBeGreaterThan(-1);
    const end = src.indexOf('req.ip', start);
    expect(end, `${action} 감사 기록 끝(req.ip)을 찾지 못했다`).toBeGreaterThan(start);
    return src.slice(start, end);
  };

  it('개별 삭제 기록에 이름·번호 원문이 없다', () => {
    const seg = auditSegment('customer_delete');
    expect(seg).not.toMatch(/customer\.name/);
    expect(seg).not.toMatch(/phone:\s*customer\.phone/);
    expect(seg).toMatch(/phone_masked:\s*maskPhone\(customer\.phone\)/);
  });

  it('선택 삭제 기록의 표본 번호도 가린다', () => {
    const seg = auditSegment('customer_bulk_delete');
    expect(seg).not.toMatch(/sample_phones:/);
    expect(seg).toMatch(/sample_phones_masked:[^\n]*maskPhone\(r\.phone\)/);
  });
});
