/**
 * 발신번호 배정 · 수정 이력의 「변경 전」 = 쓰기와 같은 잠금 아래에서 읽은 값 (★ 2026-10-21 실사 준비 S1 · Codex 1R)
 *   두 사람이 동시에 저장해도 이력의 변경 전이 실제 직전 상태여야 한다(2.1 발신번호 이력).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const calls: Array<{ sql: string; params: any[] }> = [];
vi.mock('../../config/database', () => {
  const client = {
    query: vi.fn(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('FROM callback_numbers WHERE id = $1 AND company_id = $2')) return { rows: [{ id: 'cb-1' }] };
      if (sql.includes('DELETE FROM callback_number_assignments')) return { rows: [{ user_id: 'u1' }, { user_id: 'u2' }] };
      if (sql.includes('SELECT id FROM users WHERE id = ANY')) return { rows: (params[0] as string[]).map((id) => ({ id })) };
      if (sql.includes('INSERT INTO callback_number_assignments')) return { rows: [{ user_id: 'u3' }] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return {
    default: {
      connect: vi.fn(async () => client),
      query: vi.fn(async (sql: string, params: any[] = []) => {
        calls.push({ sql, params });
        if (sql.includes('UPDATE callback_numbers c')) return { rows: params[1] === 'missing' ? [] : [{ id: params[1], before_scope: 'all' }] };
        return { rows: [] };
      }),
    },
    query: vi.fn(),
  };
});

import { replaceAssignments, updateAssignmentScope } from '../sender-registration';

const idx = (needle: string) => calls.findIndex((c) => c.sql.includes(needle));
beforeEach(() => { calls.length = 0; });

describe('replaceAssignments — 잠금 → 삭제(지운 행 = 교체 전) → 넣기 · 한 트랜잭션', () => {
  it('교체 전 배정 = DELETE 가 돌려준 행 · 따로 읽는 조회 없음 · 삭제는 발신번호 행 잠금 뒤', async () => {
    const r = await replaceAssignments('cb-1', 'co-1', ['u3'], 'admin-1');
    expect(r.beforeUserIds).toEqual(['u1', 'u2']);
    expect(r.assignments).toEqual([{ user_id: 'u3' }]);
    const lock = calls.findIndex((c) => /FROM callback_numbers WHERE id = \$1 AND company_id = \$2 FOR UPDATE/.test(c.sql));
    expect(idx('BEGIN')).toBe(0);
    expect(lock).toBeGreaterThan(0);
    expect(idx('SELECT user_id FROM callback_number_assignments')).toBe(-1);
    expect(calls[idx('DELETE FROM callback_number_assignments')].sql).toContain('RETURNING user_id');
    expect(idx('DELETE FROM callback_number_assignments')).toBeGreaterThan(lock);
    expect(idx('COMMIT')).toBeGreaterThan(idx('INSERT INTO callback_number_assignments'));
  });

  it('전체 해제(빈 목록)도 교체 전 배정을 돌려준다', async () => {
    const r = await replaceAssignments('cb-1', 'co-1', [], 'admin-1');
    expect(r).toEqual({ assignments: [], beforeUserIds: ['u1', 'u2'] });
  });
});

describe('updateAssignmentScope — 변경 전 범위를 같은 문장의 행 잠금에서', () => {
  it('번호가 있으면 { before } · 없으면 null', async () => {
    expect(await updateAssignmentScope('cb-1', 'co-1', 'assigned')).toEqual({ before: 'all' });
    expect(await updateAssignmentScope('missing', 'co-1', 'assigned')).toBeNull();
    expect(calls[0].sql).toMatch(/WITH old AS \(\s*SELECT id, assignment_scope FROM callback_numbers WHERE id = \$2 AND company_id = \$3 FOR UPDATE/);
    expect(calls[0].sql).toContain('RETURNING c.id, old.assignment_scope AS before_scope');
  });
});

describe('발신번호 수정 두 자리 — 변경 전 값 = UPDATE 문장 안 잠금', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8').replace(/\r\n/g, '\n');
  it('고객사 · 운영자 공용(manage-callbacks) = 이름 변경 전 값을 같은 문장에서 · 응답에 before 칸 없음', () => {
    const s = read('routes/manage-callbacks.ts');
    expect(s).toContain('WITH old AS (SELECT id, label FROM callback_numbers WHERE id = $2 FOR UPDATE)');
    expect(s).toContain('const { before_label: beforeLabel, ...callbackNumber } = result.rows[0];');
    expect(s).toContain("res.json({ message: '수정되었습니다.', callbackNumber });");
    expect(s).not.toContain('SELECT user_id FROM callback_number_assignments');
    expect(s).toContain('before: updated.before, after: scope');
  });
  it('운영자(admin) = 번호 · 이름 변경 전 값을 같은 문장에서 · 따로 읽는 조회 없음', () => {
    const s = read('routes/admin.ts');
    expect(s).toContain('WITH old AS (SELECT id, company_id, phone, label FROM callback_numbers WHERE id = $3 FOR UPDATE)');
    expect(s).not.toContain("const beforeRes = await query('SELECT company_id, phone, label FROM callback_numbers WHERE id = $1', [id]);");
  });
});
