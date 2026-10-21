/**
 * 등록 · 변경 · 삭제 이력 (★ 2026-10-21 전송자격인증 현장 실사 준비 S1 · S2)
 *   S1 — 발신번호 · 배정 · 계정 · 수신거부 · 주소록 쓰기 자리가 감사 기록을 남긴다(2.1 · 4.2).
 *   S2 — 서버 관리 스크립트로 만든 · 지운 계정 · 회사는 「스크립트 · 서버 계정」을 남긴다(행위자 칸이 비는 대신).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const recorded: any[] = [];
vi.mock('../audit-log', () => ({ recordAuditLog: vi.fn(async (input: any) => { recorded.push(input); }) }));
vi.mock('../../config/database', () => ({ default: { query: vi.fn(), connect: vi.fn() }, query: vi.fn(async () => ({ rows: [{ company_name: '시험사' }] })) }));

import {
  recordCallbackNumberCreated, recordCallbackNumberDeleted, recordCallbackAssignmentChanged,
  recordUserAccountDeleted, recordUnsubscribeDeleted, recordAddressBookDeleted,
} from '../change-audit';
import { recordAccountIssued, recordCompanyRegistered } from '../account-issue';

const UUID = '11111111-2222-3333-4444-555555555555';
beforeEach(() => { recorded.length = 0; });

describe('change-audit — 기록 내용', () => {
  it('발신번호 등록 · 삭제 = 번호 그대로 · 경로 · uuid 대상', async () => {
    await recordCallbackNumberCreated({ companyId: 'co-1', callbackId: UUID, phone: '0212345678', label: '본사', isDefault: true, via: 'registration', registrationId: 'r-1' });
    await recordCallbackNumberDeleted({ companyId: 'co-1', callbackId: 'not-a-uuid', phone: '0212345678', via: 'company' });
    expect(recorded[0]).toMatchObject({ action: 'callback_number_created', targetId: UUID, details: { phone: '0212345678', isDefault: true, via: 'registration', registrationId: 'r-1' } });
    expect(recorded[1]).toMatchObject({ action: 'callback_number_deleted', targetId: null, details: { via: 'company' } });
  });

  it('배정 변경 = 종류 · 전후', async () => {
    await recordCallbackAssignmentChanged({ companyId: 'co-1', callbackId: UUID, phone: null, via: 'admin', kind: 'replace', before: ['u1'], after: ['u1', 'u2'] });
    expect(recorded[0]).toMatchObject({ action: 'callback_assignment_changed', details: { kind: 'replace', before: ['u1'], after: ['u1', 'u2'] } });
  });

  it('수신거부 삭제 = 번호는 가려서 최대 5개 · 0건이면 남기지 않는다', async () => {
    await recordUnsubscribeDeleted({ companyId: 'co-1', count: 0, phones: ['01012345678'], via: 'sync' });
    expect(recorded).toHaveLength(0);
    const phones = ['01011112222', '01022223333', '01033334444', '01044445555', '01055556666', '01066667777'];
    await recordUnsubscribeDeleted({ companyId: 'co-1', count: 6, phones, via: 'admin' });
    expect(recorded[0].action).toBe('unsubscribe_deleted');
    expect(recorded[0].details.phonesMasked).toEqual(['010-****-2222', '010-****-3333', '010-****-4444', '010-****-5555', '010-****-6666']);
    expect(JSON.stringify(recorded[0].details)).not.toContain('01011112222');
  });

  it('계정 삭제 · 주소록 삭제', async () => {
    await recordUserAccountDeleted({ userId: UUID, loginId: 'tester', companyId: 'co-1', via: 'company' });
    await recordAddressBookDeleted({ companyId: 'co-1', ownerUserId: UUID, groupName: '가'.repeat(150), count: 3 });
    expect(recorded[0]).toMatchObject({ action: 'user_account_deleted', targetType: 'user', targetId: UUID, details: { loginId: 'tester' } });
    expect(recorded[1]).toMatchObject({ action: 'address_book_deleted', targetId: null, details: { count: 3, ownerUserId: UUID } });
    expect(recorded[1].details.groupName).toHaveLength(100);
  });
});

describe('S2 — 서버 관리 스크립트 발급 · 등록', () => {
  it('channel = script 면 스크립트 이름과 서버 계정을 남긴다 · 화면 발급은 그대로', async () => {
    await recordAccountIssued({ actorUserId: null, userId: UUID, loginId: 'demo', userType: 'admin', companyId: 'co-1', channel: 'script', script: 'setup-demo-company' } as any);
    await recordAccountIssued({ actorUserId: 'a1', userId: UUID, loginId: 'u2', userType: 'user', companyId: 'co-1', channel: 'super_admin' } as any);
    await recordCompanyRegistered({ actorUserId: null, companyId: UUID, companyCode: 'DEMO', companyName: '시연', script: 'create-noplan-account' } as any);
    expect(recorded[0].details).toMatchObject({ channel: 'script', script: 'setup-demo-company' });
    expect(typeof recorded[0].details.osUser === 'string' || recorded[0].details.osUser === null).toBe(true);
    expect(recorded[1].details).not.toHaveProperty('script');
    expect(recorded[2].details).toMatchObject({ channel: 'script', script: 'create-noplan-account' });
  });
});

describe('쓰기 자리 배선 — 표를 바꾸는 자리가 기록을 부른다', () => {
  const src = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8').replace(/\r\n/g, '\n');
  const wiring: Array<[string, string[]]> = [
    ['src/routes/admin.ts', ['recordCallbackNumberCreated({', 'recordCallbackNumberUpdated({', 'recordCallbackNumberDefaultChanged({', 'recordCallbackNumberDeleted({', 'recordUserAccountDeleted({', 'recordUnsubscribeDeleted({']],
    ['src/routes/manage-callbacks.ts', ['recordCallbackNumberCreated({', 'recordCallbackNumberUpdated({', 'recordCallbackNumberDefaultChanged({', 'recordCallbackNumberDeleted({', "kind: 'scope'", "kind: 'replace'", "kind: 'unassign'"]],
    ['src/routes/sender-registration.ts', ["via: 'registration'"]],
    ['src/routes/manage-users.ts', ['recordUserAccountDeleted({']],
    ['src/routes/unsubscribes.ts', ['recordUnsubscribeDeleted({']],
    ['src/routes/sync.ts', ["recordUnsubscribeDeleted({ actorUserId: null, companyId, count: reEnable.rowCount, via: 'sync' })"]],
    ['src/routes/address-books.ts', ['const ownerUserId = resolveTargetOwner(req, req.query.owner);', 'ownerClause(ownerUserId, params)', 'companyId, ownerUserId, groupName']],
    ['scripts/setup-demo-company.ts', ["channel: 'script', script: 'setup-demo-company'", "auditScript: 'setup-demo-company'"]],
    ['scripts/create-noplan-account.ts', ["channel: 'script', script: 'create-noplan-account'", "auditScript: 'create-noplan-account'"]],
  ];
  for (const [file, needles] of wiring) {
    it(file, () => {
      const s = src(file);
      for (const n of needles) expect(s, n).toContain(n);
    });
  }

  it('수신거부 격리 갈래 · 회사 갈래 둘 다 기록', () => {
    expect(src('src/routes/unsubscribes.ts').split('recordUnsubscribeDeleted({').length - 1).toBe(2);
  });

  it('시험 회사 영구 삭제 = 삭제와 같은 트랜잭션에서 COMMIT 직전에 기록', () => {
    const s = src('scripts/purge-retired-demo-company.ts');
    const ins = s.indexOf("'company_purged'");
    expect(ins).toBeGreaterThan(s.indexOf("throw new Error('회사 행이 남아 전부 되돌렸습니다.');"));
    expect(ins).toBeLessThan(s.indexOf("await client.query('COMMIT');"));
    expect(s.slice(ins - 200, ins)).toContain('await client.query(');
  });
});
