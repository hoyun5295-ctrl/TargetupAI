/**
 * 회사 상태 접근 차단 — 계약 종료·정지 고객사의 로그인 차단 (★2026-08-18)
 *
 * 못 박는 것:
 *   1. 해지(terminated)·정지(suspended) 회사는 **계정 상태와 무관하게** 막힌다.
 *      (0818 실측 — 해지 14곳 중 1곳은 계정이 active, 정지 4곳은 전파 코드 자체가 없어 전부 active였다)
 *   2. **NULL·미설정은 통과한다.** companies.status의 NULL은 활성이다(SCHEMA.md).
 *      `!== 'active'` 같은 부정 비교로 바꾸면 여기서 잡힌다 — NULL 회사 전체가 로그인 불가가 되는 사고다.
 *   3. 감사 로그 사유 코드가 상태별로 구분된다(3.3 증빙에서 "왜 막았나"가 남아야 한다).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { resolveCompanyAccessDenial } from './company-access';

describe('회사 상태로 로그인을 막는다', () => {
  it('해지(terminated)는 막는다', () => {
    const denial = resolveCompanyAccessDenial('terminated');
    expect(denial).not.toBeNull();
    expect(denial!.reason).toBe('company_terminated');
    expect(denial!.message).toContain('종료된 계약');
  });

  it('정지(suspended)는 막는다', () => {
    const denial = resolveCompanyAccessDenial('suspended');
    expect(denial).not.toBeNull();
    expect(denial!.reason).toBe('company_suspended');
    expect(denial!.message).toContain('일시 중지');
  });

  it('활성(active)은 통과한다', () => {
    expect(resolveCompanyAccessDenial('active')).toBeNull();
  });

  it('★ NULL·미설정·공백은 통과한다 — 부정 비교 회귀 방지', () => {
    // companies.status의 NULL은 활성이다(SCHEMA.md). 이 셋 중 하나라도 막히면
    // 상태를 설정하지 않은 고객사가 통째로 로그인 불가가 된다.
    expect(resolveCompanyAccessDenial(null)).toBeNull();
    expect(resolveCompanyAccessDenial(undefined)).toBeNull();
    expect(resolveCompanyAccessDenial('   ')).toBeNull();
  });

  it('모르는 상태값은 통과한다 — 차단은 열거된 값만', () => {
    expect(resolveCompanyAccessDenial('whatever')).toBeNull();
  });

  it('사용자 문구에 내부 상태값을 노출하지 않는다', () => {
    for (const status of ['terminated', 'suspended']) {
      const denial = resolveCompanyAccessDenial(status)!;
      expect(denial.message).not.toContain(status);
    }
  });
});

describe('로그인 쿼리 SQL 불변식', () => {
  const authSrc = readFileSync(resolve(__dirname, '../routes/auth.ts'), 'utf8');

  it('★ c.status는 반드시 company_status 별칭으로 가져온다', () => {
    // `SELECT u.*` 가 이미 status(계정 상태)를 싣고 있다. 별칭 없이 c.status를 넣으면
    // 같은 이름이 둘이 되어 뒤엣것이 이기고, **계정 상태 게이트가 회사 상태로 판정된다.**
    expect(authSrc).toMatch(/c\.status\s+AS\s+company_status/i);
    expect(authSrc, '별칭 없는 c.status가 SELECT에 들어갔다').not.toMatch(/,\s*c\.status\s*(,|\n|\s+FROM)/i);
  });

  it('회사 상태 판정은 CT를 부른다 — 라우트 인라인 금지', () => {
    expect(authSrc).toMatch(/resolveCompanyAccessDenial\(/);
    expect(authSrc, '차단 문구가 라우트에 인라인으로 다시 적혔다').not.toMatch(/종료된 계약입니다/);
  });
});
