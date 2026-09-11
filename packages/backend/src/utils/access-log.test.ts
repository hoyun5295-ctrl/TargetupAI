/**
 * 서비스 페이지 접속 기록 — 전송자격인증 4.1 (★2026-09-11)
 *
 * 못 박는 것:
 *   1. 로그인한 이용자가 화면에 들어오면 **누가·언제·어느 화면·어디서(IP·브라우저)** 가 audit_logs에 남는다.
 *   2. ⛔ 경로만 남긴다 — 쿼리·해시는 버린다(검색어·토큰이 실릴 수 있다). 허용 문자 밖이면 기록하지 않는다.
 *   3. 같은 사람이 같은 화면을 짧은 시간 안에 다시 열면 1건으로 묶는다(재렌더·새로고침 소음).
 *   4. 기록 실패가 화면 이용을 막지 않는다(recordAuditLog가 흡수).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../config/database', () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));

import { query } from '../config/database';
import {
  normalizePagePath, shouldRecordPageView, recordPageView,
  PAGE_VIEW_DEDUP_WINDOW_MS, __resetPageViewDedupForTest,
} from './access-log';

const q = query as unknown as ReturnType<typeof vi.fn>;

const REQ: any = {
  ip: '211.234.56.78',
  headers: { 'user-agent': 'vitest-agent' },
  user: { userId: '11111111-1111-1111-1111-111111111111', companyId: 'c-1', userType: 'company_admin' },
};

describe('경로 정규화 — 경로만 남기고 나머지는 버린다', () => {
  it('쿼리·해시를 버린다', () => {
    expect(normalizePagePath('/manage?tab=customers&q=홍길동')).toBe('/manage');
    expect(normalizePagePath('/dm/edit/abc#section-2')).toBe('/dm/edit/abc');
  });

  it('앞 슬래시가 없거나 다른 사이트로 가는 형태는 기록하지 않는다', () => {
    expect(normalizePagePath('manage')).toBeNull();
    expect(normalizePagePath('//evil.example.com/x')).toBeNull();
    expect(normalizePagePath('https://evil.example.com')).toBeNull();
  });

  it('문자열이 아니거나 비어 있거나 너무 길면 기록하지 않는다', () => {
    expect(normalizePagePath(undefined)).toBeNull();
    expect(normalizePagePath(123 as any)).toBeNull();
    expect(normalizePagePath('')).toBeNull();
    expect(normalizePagePath('/' + 'a'.repeat(300))).toBeNull();
  });

  it('허용 문자(영숫자 / _ - . ~ %) 밖의 글자가 있으면 기록하지 않는다', () => {
    expect(normalizePagePath('/manage<script>')).toBeNull();
    expect(normalizePagePath('/고객')).toBeNull();
    expect(normalizePagePath('/%EA%B3%A0%EA%B0%9D')).toBe('/%EA%B3%A0%EA%B0%9D');
  });
});

describe('짧은 시간 안 같은 화면 재진입은 1건', () => {
  beforeEach(() => __resetPageViewDedupForTest());

  it('같은 사람·같은 화면은 창 안에서 한 번만', () => {
    const t0 = 1_000_000;
    expect(shouldRecordPageView('u1', '/manage', t0)).toBe(true);
    expect(shouldRecordPageView('u1', '/manage', t0 + 5_000)).toBe(false);
    expect(shouldRecordPageView('u1', '/manage', t0 + PAGE_VIEW_DEDUP_WINDOW_MS + 1)).toBe(true);
  });

  it('다른 화면·다른 사람은 따로 센다', () => {
    const t0 = 2_000_000;
    expect(shouldRecordPageView('u1', '/manage', t0)).toBe(true);
    expect(shouldRecordPageView('u1', '/dashboard', t0 + 1)).toBe(true);
    expect(shouldRecordPageView('u2', '/manage', t0 + 2)).toBe(true);
  });
});

describe('기록', () => {
  beforeEach(() => {
    __resetPageViewDedupForTest();
    q.mockReset();
    q.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  it('누가·어느 화면·IP·브라우저가 page_view로 남는다', async () => {
    await recordPageView({ req: REQ, path: '/manage' });

    expect(q).toHaveBeenCalledTimes(1);
    const [sql, params] = q.mock.calls[0];
    expect(String(sql)).toMatch(/INSERT INTO audit_logs/i);
    expect(params[0]).toBe(REQ.user.userId);
    expect(params[1]).toBe('page_view');
    expect(params[2]).toBe('page');
    const details = JSON.parse(params[4]);
    expect(details.path).toBe('/manage');
    expect(details.companyId).toBe('c-1');
    expect(details.userType).toBe('company_admin');
    expect(params[5]).toBe('211.234.56.78');
    expect(params[6]).toBe('vitest-agent');
  });

  it('로그인 사용자가 없으면 남기지 않는다', async () => {
    await recordPageView({ req: { ip: '1.2.3.4', headers: {} } as any, path: '/manage' });
    expect(q).not.toHaveBeenCalled();
  });

  it('같은 화면 연속 진입은 한 번만 남는다', async () => {
    await recordPageView({ req: REQ, path: '/manage' });
    await recordPageView({ req: REQ, path: '/manage' });
    expect(q).toHaveBeenCalledTimes(1);
  });

  it('기록 실패가 호출자를 막지 않는다', async () => {
    q.mockRejectedValue(new Error('DB down'));
    await expect(recordPageView({ req: REQ, path: '/manage' })).resolves.toBeUndefined();
  });
});

describe('[소스 스캔] 배선', () => {
  it('접속 기록 엔드포인트는 로그인 확인(authenticate)을 거치고 CT를 부른다', () => {
    const src = readFileSync(resolve(__dirname, '../routes/auth.ts'), 'utf8');
    expect(src).toMatch(/router\.post\('\/page-view', authenticate,/);
    expect(src).toMatch(/recordPageView\(\{ req, path \}\)/);
  });
});
