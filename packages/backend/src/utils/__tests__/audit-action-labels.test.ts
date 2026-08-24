/**
 * 감사 로그 액션 한글 라벨 커버리지 계약 (★ 2026-08-24 · Harold "영문으로 모르는 것들 전수 한글화")
 *
 * 화면 라벨은 `frontend/src/constants/audit-action-labels.ts` CT 하나가 소유한다. 이 테스트는
 * 백엔드가 적는 액션이 그 CT에 등록되어 있는지를 소스로 대조한다 — 새 액션을 적기 시작하고
 * 라벨을 잊으면 여기서 빌드가 잡는다(화면은 죽지 않고 원문 코드를 보여주지만, 그게 이 접수의 증상이었다).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const BACKEND_SRC = resolve(__dirname, '../..');
const LABEL_SRC = readFileSync(
  resolve(__dirname, '../../../../frontend/src/constants/audit-action-labels.ts'), 'utf8',
);
const LABELS = new Set([...LABEL_SRC.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]));

/** recordAuditLog는 액션이 리터럴이라 소스에서 전수 추출이 된다 */
function collectRecordAuditLogActions(): Set<string> {
  const actions = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== 'node_modules' && name !== '__tests__') walk(p); continue; }
      if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
      const src = readFileSync(p, 'utf8');
      for (const m of src.matchAll(/recordAuditLog\(\{[\s\S]{0,200}?action: '([a-z_]+)'/g)) actions.add(m[1]);
    }
  };
  walk(BACKEND_SRC);
  return actions;
}

/**
 * 직접 INSERT 자리는 액션이 삼항·변수라 정적 전수 추출이 안 된다 — 2026-08-24 수기 전수(grep) 고정 목록.
 * 이 목록은 "이 액션들에는 화면 라벨이 있어야 한다"는 계약이다. 새 직접 INSERT 액션은 여기와 라벨 CT에 함께 등록한다.
 */
const DIRECT_INSERT_ACTIONS = [
  'login_success', 'login_fail', 'login_blocked', 'logout', 'login_session_conflict', 'login_takeover',
  'mfa_challenge', 'mfa_success', 'mfa_fail', 'mfa_locked', 'mfa_phone_changed', 'totp_enroll_start', 'totp_enrolled',
  'machine_origin_detected', 'machine_origin_blocked', 'foreign_access_detected', 'foreign_access_blocked', 'pre_auth_effect',
  'customer_delete', 'customer_bulk_delete', 'customer_delete_all', 'customer_delete_by_user',
  'privacy_export', 'privacy_purge', 'account_restricted', 'company_terminated',
];

describe('감사 로그 액션 한글 라벨 커버리지', () => {
  it('recordAuditLog에 적는 모든 액션이 화면 라벨 CT에 있다', () => {
    const actions = collectRecordAuditLogActions();
    expect(actions.size, 'recordAuditLog 추출이 0이면 이 게이트가 죽은 것이다').toBeGreaterThanOrEqual(10);
    const missing = [...actions].filter((a) => !LABELS.has(a)).sort();
    expect(missing, '새 액션의 한글 라벨을 audit-action-labels.ts에 등록하라').toEqual([]);
  });

  it('직접 INSERT 액션(수기 전수 목록)이 전부 화면 라벨 CT에 있다', () => {
    const missing = DIRECT_INSERT_ACTIONS.filter((a) => !LABELS.has(a)).sort();
    expect(missing).toEqual([]);
  });
});
