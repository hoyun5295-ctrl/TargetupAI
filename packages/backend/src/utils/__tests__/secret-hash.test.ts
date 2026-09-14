/**
 * 시크릿 해시·비교 계약 (★2026-09-12 신설)
 *
 *   싱크에이전트 인증이 원문 SQL 일치에서 해시 비교로 옮겨 갔다. 이미 설치된 에이전트가 멈추면 안 되므로
 *   **세 갈래가 모두 살아 있어야 한다**: 해시 있음 / 해시 없음(원문 폴백 + 승급 신호) / 불일치.
 *   ⛔ 승급 신호(`needsUpgrade`)가 죽으면 해시가 영영 안 채워져 평문이 남는다 — 그것도 여기서 고정한다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  hashSecret, timingSafeEqualHex, timingSafeEqualUtf8, verifySecret, omitCompanySecrets, COMPANY_SECRET_COLUMNS,
} from '../secret-hash';

const SECRET = 'a'.repeat(64);          // randomBytes(32).toString('hex') 와 같은 모양
const OTHER = 'b'.repeat(64);

describe('hashSecret', () => {
  it('sha256 hex 64자를 돌려주고 같은 입력은 같은 값이다', () => {
    const h = hashSecret(SECRET);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSecret(SECRET)).toBe(h);
  });

  it('다른 입력은 다른 해시다', () => {
    expect(hashSecret(SECRET)).not.toBe(hashSecret(OTHER));
  });
});

describe('고정 시간 비교', () => {
  it('같은 값은 true, 다른 값·길이 다름·빈 값은 false', () => {
    expect(timingSafeEqualHex(hashSecret(SECRET), hashSecret(SECRET))).toBe(true);
    expect(timingSafeEqualHex(hashSecret(SECRET), hashSecret(OTHER))).toBe(false);
    expect(timingSafeEqualHex('abcd', 'abcdef')).toBe(false);
    expect(timingSafeEqualHex('', '')).toBe(false);
    expect(timingSafeEqualUtf8(SECRET, SECRET)).toBe(true);
    expect(timingSafeEqualUtf8(SECRET, OTHER)).toBe(false);
    expect(timingSafeEqualUtf8('짧다', '더 길다')).toBe(false);
  });
});

describe('verifySecret — 전환기 세 갈래', () => {
  it('해시가 있으면 해시로 맞추고 승급은 요구하지 않는다', () => {
    const r = verifySecret(SECRET, { hash: hashSecret(SECRET), plain: null });
    expect(r).toEqual({ ok: true, needsUpgrade: false });
  });

  it('해시가 없으면 원문으로 맞추고 승급을 요구한다(그 자리에서 해시를 채우라는 신호)', () => {
    const r = verifySecret(SECRET, { hash: null, plain: SECRET });
    expect(r).toEqual({ ok: true, needsUpgrade: true });
  });

  it('해시가 있으면 원문이 맞아도 해시 불일치면 거절한다(해시가 진실)', () => {
    const r = verifySecret(SECRET, { hash: hashSecret(OTHER), plain: SECRET });
    expect(r.ok).toBe(false);
  });

  it('둘 다 없으면 거절한다(빈 계정으로 통과하지 않는다)', () => {
    expect(verifySecret(SECRET, { hash: null, plain: null })).toEqual({ ok: false, needsUpgrade: false });
    expect(verifySecret('', { hash: null, plain: '' })).toEqual({ ok: false, needsUpgrade: false });
  });

  it('틀린 시크릿은 어느 갈래에서도 통과하지 못한다', () => {
    expect(verifySecret(OTHER, { hash: hashSecret(SECRET), plain: null }).ok).toBe(false);
    expect(verifySecret(OTHER, { hash: null, plain: SECRET }).ok).toBe(false);
  });
});

/**
 * ★2026-09-13 적대검토 등재분 ①: 슈퍼관리자 고객사 목록·상세·생성 응답이 `SELECT c.*`·`RETURNING *` 행을 그대로 내려
 *   원문 시크릿과 해시가 브라우저까지 갔다. 화면은 이 값을 읽지 않는다(재발급 응답의 `syncKeys`만 읽는다 · grep 실측).
 */
describe('omitCompanySecrets: 고객사 행 응답에서 비밀값 컬럼을 뺀다', () => {
  it('원문·해시·자사몰 해시·SMTP 비밀번호를 빼고 나머지는 그대로 두며, 넘긴 객체는 바꾸지 않는다', () => {
    const row = {
      id: 'c1', company_name: 'A', api_key: 'tk_x', plan_name: 'FREE',
      api_secret: 's', api_secret_hash: 'h', cdp_api_secret_hash: 'b', smtp_password_encrypted: 'e',
    };
    const out = omitCompanySecrets(row);
    for (const c of COMPANY_SECRET_COLUMNS) expect(out).not.toHaveProperty(c);
    expect(out).toEqual({ id: 'c1', company_name: 'A', api_key: 'tk_x', plan_name: 'FREE' });
    expect(row).toHaveProperty('api_secret', 's');
  });

  it('행이 없으면 그대로 돌려준다', () => {
    expect(omitCompanySecrets(undefined as any)).toBeUndefined();
  });

  it('슈퍼관리자 고객사 응답 6곳(목록·상세 2·생성·수정 2)이 이 함수를 지난다', () => {
    const companies = fs.readFileSync(path.join(__dirname, '../../routes/companies.ts'), 'utf8');
    const admin = fs.readFileSync(path.join(__dirname, '../../routes/admin.ts'), 'utf8');

    // 자르기 표지(주석·에러 문구)가 바뀌면 slice가 빈 문자열이 되어 toContain이 엉뚱하게 실패한다 — 길이부터 본다
    const list = companies.slice(companies.indexOf('COALESCE(cust.cnt, 0) as total_customers'), companies.indexOf('고객사 목록 조회 에러'));
    expect(list.length).toBeGreaterThan(0);
    expect(list).toContain('companies: result.rows.map(omitCompanySecrets)');

    const detail = companies.slice(companies.indexOf('// GET /api/companies/:id - 고객사 상세'), companies.indexOf('// POST /api/companies - 고객사 생성'));
    expect(detail.length).toBeGreaterThan(0);
    expect(detail).toContain('company: omitCompanySecrets(result.rows[0])');

    const create = companies.slice(companies.indexOf('await createCompanyCore({'), companies.indexOf('고객사 생성 에러'));
    expect(create.length).toBeGreaterThan(0);
    expect(create).toContain('company: omitCompanySecrets(company)');

    const adminDetail = admin.slice(admin.indexOf("router.get('/companies/:id',"), admin.indexOf('단가 설정 — 쓰기 경로 단일화'));
    expect(adminDetail.length).toBeGreaterThan(0);
    expect(adminDetail).toContain('company: omitCompanySecrets(result.rows[0])');

    // ★워크플로 1R: 수정(PUT) 응답도 `UPDATE ... RETURNING *` 행을 그대로 내려주고 있었다(같은 결함 · 저장할 때마다 호출)
    const update = companies.slice(companies.indexOf("router.put('/:id', requireUuidId, requireSuperAdmin"), companies.indexOf('고객사 수정 에러'));
    expect(update.length).toBeGreaterThan(0);
    expect(update).toContain('company: omitCompanySecrets(result.rows[0])');

    const adminUpdate = admin.slice(admin.indexOf("router.put('/companies/:id', authenticate, requireSuperAdmin"), admin.indexOf("console.error('회사 수정 실패:'"));
    expect(adminUpdate.length).toBeGreaterThan(0);
    expect(adminUpdate).toContain('company: omitCompanySecrets(result.rows[0])');
  });
});
