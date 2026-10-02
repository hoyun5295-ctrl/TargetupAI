/**
 * 계정 발급 축 계약 (★2026-10-02 전송자격인증 2.1 · 4.1 ②)
 *
 * 왜 있나
 *   계정은 계약 확인 뒤 당사가 발급한다. 그런데 발급 기록이 한 줄도 없었고(계정 생성 4자리 · 고객사 생성 1자리),
 *   고객사 관리자가 자사 사용자를 직접 만들 수 있어 "당사가 발급한다"는 말이 시스템과 달랐다.
 *
 * 못 박는 것
 *   1. 계정 · 고객사가 생기는 파일에는 발급 기록 호출이 함께 있다(경로가 늘어도 기록이 빠지지 않는다).
 *   2. 고객사 관리자의 계정 추가는 DB를 건드리기 전에 거절된다(허용 목록 — 슈퍼관리자만 통과).
 *   3. 기록 실패가 발급을 막지 않는다.
 *   4. 기록에 전화번호 · 이메일 · 비밀번호가 실리지 않는다(감사 기록은 열람 대상이다).
 *   5. 화면에 계정 추가 진입점이 없고, 서버와 화면이 같은 안내를 한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn() }));

import { query } from '../../config/database';
import { ACCOUNT_ISSUE_NOTICE, recordAccountIssued, recordCompanyRegistered } from '../account-issue';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const BACKEND_SRC = resolve(__dirname, '../..');
const FRONTEND_SRC = resolve(__dirname, '../../../../frontend/src');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'node_modules' && name !== '__tests__') sourceFiles(p, out);
      continue;
    }
    if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

describe('발급 경로마다 기록이 함께 있다', () => {
  const files = sourceFiles(BACKEND_SRC).map((p) => ({ p, src: readFileSync(p, 'utf8') }));

  it('계정을 만드는 파일은 계정 발급 기록을 부른다', () => {
    const creators = files.filter((f) => /INSERT INTO users\b(?!_)/.test(f.src));
    expect(creators.length, '추출이 0이면 이 게이트가 죽은 것이다').toBeGreaterThanOrEqual(4);
    const missing = creators.filter((f) => !f.src.includes('recordAccountIssued(')).map((f) => f.p);
    expect(missing, '계정 생성 자리에 recordAccountIssued 호출을 함께 넣어라').toEqual([]);
  });

  it('고객사를 만드는 파일은 고객사 등록 기록을 부른다', () => {
    const creators = files.filter((f) => /INSERT INTO companies\b(?!_)/.test(f.src));
    expect(creators.length, '추출이 0이면 이 게이트가 죽은 것이다').toBeGreaterThanOrEqual(1);
    const missing = creators.filter((f) => !f.src.includes('recordCompanyRegistered(')).map((f) => f.p);
    expect(missing, '고객사 생성 자리에 recordCompanyRegistered 호출을 함께 넣어라').toEqual([]);
  });
});

describe('고객사 관리자는 계정을 추가할 수 없다', () => {
  const route = readFileSync(join(BACKEND_SRC, 'routes/manage-users.ts'), 'utf8');
  const start = route.indexOf("router.post('/', ");
  const end = route.indexOf("router.put('/:id'");
  const handler = route.slice(start, end);

  it('계정 추가 처리기를 찾았다', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it('슈퍼관리자가 아니면 DB를 건드리기 전에 안내 문구로 거절한다', () => {
    const gate = handler.indexOf("callerType !== 'super_admin'");
    const firstDb = handler.indexOf('pool.query');
    expect(gate, '허용 목록 관문이 없다').toBeGreaterThan(-1);
    expect(firstDb).toBeGreaterThan(-1);
    expect(gate, '관문이 DB 조회보다 뒤에 있다').toBeLessThan(firstDb);
    const gateBlock = handler.slice(gate, firstDb);
    expect(gateBlock).toContain('status(403)');
    expect(gateBlock).toContain('ACCOUNT_ISSUE_NOTICE');
  });

  it('화면에 계정 추가 진입점이 없고 같은 안내를 보여준다', () => {
    const tab = readFileSync(join(FRONTEND_SRC, 'components/manage/UsersTab.tsx'), 'utf8');
    expect(tab).not.toContain('openAdd');
    expect(tab).not.toMatch(/>\s*사용자 추가\s*</);
    expect(tab).toContain('계정 추가는 계약 확인 후 인비토가 발급합니다.');
    expect(tab).toContain('1800-8125');
  });

  it('안내 문구에 줄표가 없고 요청 경로가 들어 있다', () => {
    expect(ACCOUNT_ISSUE_NOTICE).not.toContain('—');
    expect(ACCOUNT_ISSUE_NOTICE).toContain('1800-8125');
  });
});

describe('발급 기록', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('누가 · 어느 계정을 · 어느 고객사에 · 어떤 경로로 발급했는지 남긴다', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM companies')) return { rows: [{ company_name: '시험상사' }] };
      if (sql.includes('INSERT INTO audit_logs')) return { rows: [] };
      throw new Error(`예상하지 못한 SQL: ${sql}`);
    });
    await recordAccountIssued({
      actorUserId: 'actor-1', userId: 'user-1', loginId: 'sample01', userType: 'user',
      companyId: 'company-1', channel: 'super_admin',
      req: { ip: '203.0.113.9', headers: { 'user-agent': 'vitest' } },
    });
    const insert = mockQuery.mock.calls.find((c) => String(c[0]).includes('INSERT INTO audit_logs'))!;
    expect(insert, '감사 기록이 적재되지 않았다').toBeTruthy();
    const [actor, action, targetType, targetId, details, ip] = insert[1];
    expect(actor).toBe('actor-1');
    expect(action).toBe('user_account_created');
    expect(targetType).toBe('user');
    expect(targetId).toBe('user-1');
    expect(ip).toBe('203.0.113.9');
    expect(JSON.parse(details)).toEqual({
      loginId: 'sample01', userType: 'user', companyId: 'company-1', companyName: '시험상사', channel: 'super_admin',
    });
  });

  it('기록에 전화번호 · 이메일 · 비밀번호 키가 없다', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await recordAccountIssued({ userId: 'u', loginId: 'x', userType: 'admin', companyId: null, channel: 'bulk_gateway' });
    const insert = mockQuery.mock.calls.find((c) => String(c[0]).includes('INSERT INTO audit_logs'))!;
    const keys = Object.keys(JSON.parse(insert[1][4]));
    expect(keys.some((k) => /phone|email|password/i.test(k))).toBe(false);
  });

  it('고객사 이름 조회가 실패해도 던지지 않는다(발급을 막지 않는다)', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));
    await expect(recordAccountIssued({
      userId: 'u', loginId: 'x', userType: 'user', companyId: 'c', channel: 'super_admin',
    })).resolves.toBeUndefined();
  });

  it('고객사 등록 기록은 코드 · 이름 · 사용 구분을 남긴다', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await recordCompanyRegistered({
      actorUserId: 'actor-1', companyId: 'company-1', companyCode: 'TEST01', companyName: '시험상사', usageType: 'web',
    });
    const insert = mockQuery.mock.calls.find((c) => String(c[0]).includes('INSERT INTO audit_logs'))!;
    expect(insert[1][1]).toBe('company_created');
    expect(insert[1][2]).toBe('company');
    expect(JSON.parse(insert[1][4])).toEqual({ companyCode: 'TEST01', companyName: '시험상사', usageType: 'web' });
  });
});
