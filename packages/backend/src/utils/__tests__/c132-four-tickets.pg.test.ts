// replaces: none
/**
 * C132 접수 넷 — 실 PostgreSQL 판(★ 2026-11-13 · 설계서 docs/2026-11-13-c132-four-tickets-design.md §6 T2-1 · T3-2 · ④ 칸)
 *   운영 문장을 글자 그대로 돌린다(표 = 운영 schema-only 덤프 사본 · 대기 DDL C132-DDL-1 · -2 를 시험 안에서 얹는다).
 *   1. 슈퍼관리자 「사용 범위」 칸(describeCallbackUsage) = 발송 판정(getRegisteredCallbackSet)과 같은 답 — 사용자마다 대조(전체 · 원장 · 지정 · 지정 0명 · 규격 위반 원장 · 규격 위반 번호)
 *   2. 발송ID 단가 SELECT(청구 원장 칸 = BILLING_TYPES 파생)가 새 칸까지 읽는다
 *   3. 접수 표기 정책 = 칸이 생기면 이메일 = false · 화면 = true(agencyAdTextValue · 캐시는 지운다)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pool, query } from '../../config/database';
import { ledgerBlockSql } from './pg/global-setup';
import { insertMinimalRow } from './pg/fixtures';
import { CALLBACK_ASSIGNEES_SQL, describeCallbackUsage, getRegisteredCallbackSet } from '../callback-filter';
import { BILLING_TYPES } from '../billing-types';
import { agencyAdTextValue, forgetAgencyColumn } from '../agency-send-intake';

const CO = '00000000-0000-0000-0000-0000000c1320';
const ADMIN = '00000000-0000-0000-0000-0000000a1320';
const USER = '00000000-0000-0000-0000-0000000b1320';
const CN_ALL = '00000000-0000-0000-0000-0000000d1321';
const CN_ASSIGNED = '00000000-0000-0000-0000-0000000d1322';
const CN_EMPTY = '00000000-0000-0000-0000-0000000d1323';
const CN_LEDGER = '00000000-0000-0000-0000-0000000d1324';
const CN_BADLEDGER = '00000000-0000-0000-0000-0000000d1325';   // 지정 번호 · 원장에 같은 숫자의 규격 위반 행(Codex 구현 1R)
const CN_INVALID = '00000000-0000-0000-0000-0000000d1326';      // 번호 원문 자체가 규격 위반 · 전체 범위
const NOBODY = '00000000-0000-0000-0000-0000000e1320';          // 배정 0 인 사용자

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C132-DDL-1'));
  await pool.query(ledgerBlockSql('C132-DDL-2'));
  await insertMinimalRow(pool, 'companies', { id: CO });
  await insertMinimalRow(pool, 'users', { id: ADMIN, company_id: CO, login_id: 'c132admin', name: '관리자', user_type: 'admin' });
  await insertMinimalRow(pool, 'users', { id: USER, company_id: CO, login_id: 'c132user', name: '담당자', user_type: 'user' });
  await insertMinimalRow(pool, 'callback_numbers', { id: CN_ALL, company_id: CO, phone: '02-1111-0001', assignment_scope: 'all' });
  await insertMinimalRow(pool, 'callback_numbers', { id: CN_ASSIGNED, company_id: CO, phone: '02-1111-0002', assignment_scope: 'assigned' });
  await insertMinimalRow(pool, 'callback_numbers', { id: CN_EMPTY, company_id: CO, phone: '02-1111-0003', assignment_scope: 'assigned' });
  await insertMinimalRow(pool, 'callback_numbers', { id: CN_LEDGER, company_id: CO, phone: '(02)1111-0004', assignment_scope: 'assigned' });
  await insertMinimalRow(pool, 'callback_number_assignments', { callback_number_id: CN_ASSIGNED, user_id: USER });
  await insertMinimalRow(pool, 'sender_numbers', { company_id: CO, phone_number: '0211110004', is_active: true });
  await insertMinimalRow(pool, 'callback_numbers', { id: CN_BADLEDGER, company_id: CO, phone: '02-1111-0005', assignment_scope: 'assigned' });
  await insertMinimalRow(pool, 'callback_number_assignments', { callback_number_id: CN_BADLEDGER, user_id: USER });
  await insertMinimalRow(pool, 'sender_numbers', { company_id: CO, phone_number: '02-1111-0005 대표', is_active: true });
  await insertMinimalRow(pool, 'callback_numbers', { id: CN_INVALID, company_id: CO, phone: '02-1111-0006 내선', assignment_scope: 'all' });
});

describe('T2-1 사용 범위 칸 = 발송 판정과 같은 답(실 PG)', () => {
  const load = async () => {
    const r = await query(`SELECT cn.id, cn.company_id, cn.phone, cn.assignment_scope, ${CALLBACK_ASSIGNEES_SQL} FROM callback_numbers cn WHERE cn.company_id = $1`, [CO]);
    return { rows: r.rows, usage: await describeCallbackUsage(r.rows) };
  };

  it('칸 값: 전체 · 지정(배정 1) · 지정(배정 0) · 원장 · 규격 위반 원장은 근거가 아님 · 규격 위반 번호', async () => {
    const { usage } = await load();
    expect(usage.get(CN_ALL)!.usage_scope).toBe('all');
    expect(usage.get(CN_ASSIGNED)!.usage_scope).toBe('assigned');
    expect(usage.get(CN_ASSIGNED)!.assignees.map((u: any) => u.loginId)).toEqual(['c132user']);
    expect(usage.get(CN_EMPTY)!.usage_scope).toBe('assigned');
    expect(usage.get(CN_EMPTY)!.assignees).toEqual([]);
    expect(usage.get(CN_LEDGER)!.usage_scope).toBe('ledger');   // 표기가 달라도(괄호) 규격 통과 숫자가 같으면 원장 번호
    expect(usage.get(CN_BADLEDGER)!.usage_scope).toBe('assigned');   // 같은 숫자의 원장 행이 규격 위반 = 근거 아님(Codex 구현 1R)
    expect(usage.get(CN_INVALID)!.usage_scope).toBe('invalid');
  });

  it('대조: 사용자마다 「칸이 쓸 수 있다고 한 번호」 = 발송 판정 집합 · 관리자(사용자 축 없음)도', async () => {
    const { rows, usage } = await load();
    const digits = (phone: string) => String(phone).replace(/\D/g, '');
    for (const who of [USER, NOBODY, ADMIN]) {
      const set = await getRegisteredCallbackSet(CO, who);
      for (const r of rows as any[]) {
        const u = usage.get(r.id)!;
        const usable = u.usage_scope === 'ledger' || u.usage_scope === 'all'
          || (u.usage_scope === 'assigned' && u.assignees.some((a: any) => a.id === who));
        expect(set.has(digits(r.phone)), `${who} · ${r.phone} · ${u.usage_scope}`).toBe(usable);
      }
    }
    const anyone = await getRegisteredCallbackSet(CO);   // 관리자 역할 = 배정 제한 없음(callbackAssignmentUserId)
    for (const r of rows as any[]) {
      expect(anyone.has(digits(r.phone)), r.phone).toBe(usage.get(r.id)!.usage_scope !== 'invalid');
    }
  });
});

describe('T3-2 발송ID 단가 SELECT 가 새 칸까지(청구 원장 칸 = 표 파생 · 실 PG)', () => {
  it('BILLING_TYPES 의 발송ID 칸 전부를 읽는다 · 비친구 칸 = numeric NULL', async () => {
    const cols = [...new Set(BILLING_TYPES.map((t) => t.agentPriceColumn).filter(Boolean))] as string[];
    expect(cols).toContain('cost_per_brand_nonfriend');
    await insertMinimalRow(pool, 'company_agent_ids', { company_id: CO, agent_send_id: 'VC132', cost_per_brand: 20 });
    const r = await query(`SELECT agent_send_id, ${cols.join(', ')} FROM company_agent_ids WHERE agent_send_id = 'VC132'`);
    expect(r.rows[0].cost_per_brand_nonfriend).toBeNull();
    expect(Number(r.rows[0].cost_per_brand)).toBe(20);
  });
});

describe('④ 접수 표기 정책 칸(실 PG)', () => {
  it('칸이 있으면 이메일 = false · 화면 · 원스텝 = true', async () => {
    forgetAgencyColumn('ad_text');
    expect(await agencyAdTextValue(pool, 'email')).toBe(false);
    expect(await agencyAdTextValue(pool, 'screen')).toBe(true);
    expect(await agencyAdTextValue(pool, 'one_step')).toBe(true);
    await insertMinimalRow(pool, 'agency_send_requests', { company_id: CO, ad_text: false, current_content: 'x', original_content: 'x' });
    const r = await query(`SELECT ad_text FROM agency_send_requests WHERE company_id = $1`, [CO]);
    expect(r.rows.map((x: any) => x.ad_text)).toEqual([false]);
  });
});
