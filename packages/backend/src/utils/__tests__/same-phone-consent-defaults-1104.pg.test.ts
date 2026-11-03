// replaces: none
/**
 * 공용 수신동의 기본값 = 그 업서트가 새로 넣은 행에만(설계서 docs/2026-11-03-sync-duplicate-phone-consent-design.md §3-2 ⑤ · Codex 2R #3 · 3R #3)
 * 이미 있는 NULL(대기) 행은 다른 문(업로드 · 화면)이 동의 칸 없이 건드려도 동의로 채우지 않는다.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, withTransaction } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import { createCustomerUpsertBuilder, applySmsOptInDefaults } from '../customer-upsert';

const CO = randomUUID();
let seq = 0;
const phone = () => `0100006${String(1100 + seq++).padStart(4, '0')}`;
const consentOf = async (p: string) => {
  const row = (await pool.query(`SELECT sms_opt_in FROM customers WHERE company_id = $1 AND phone = $2`, [CO, p])).rows[0];
  return row ? row.sms_opt_in : 'NO_ROW';
};

/** 업로드 · 화면 길 그대로 — 빌더 한 문장 + 같은 트랜잭션 기본값 */
async function upsert(rows: Array<{ phone: string; sms_opt_in: boolean | null }>, unknown: Set<string> = new Set()) {
  const b = createCustomerUpsertBuilder({ source: 'upload', includeUploadedBy: false });
  const { sql, values } = b.buildBatch(CO, rows.map((r) => ({ phone: r.phone, name: '시험', sms_opt_in: r.sms_opt_in })));
  await withTransaction(async (run) => {
    const r = await run(sql, values);
    await applySmsOptInDefaults(run, CO, (r as any).rows, unknown);
  });
}

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C98-DDL-2'));   // 업서트 빌더가 쓰는 가입 근거 칸(운영 반영 DDL)
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: '같은 번호 기본값 시험' });
}, 120_000);

describe('공용 기본값 = 새로 넣은 행만(실 PG)', () => {
  it('새 번호 · 동의 칸 없음 = 기본 동의 · 모름 표시 = 미동의', async () => {
    const [a, b] = [phone(), phone()];
    await upsert([{ phone: a, sms_opt_in: null }, { phone: b, sms_opt_in: null }], new Set([b]));
    expect(await consentOf(a)).toBe(true);
    expect(await consentOf(b)).toBe(false);
  });

  it('이미 있는 NULL(대기) 행 = 동의 칸 없는 업로드가 건드려도 NULL 그대로', async () => {
    const p = phone();
    await pool.query(`INSERT INTO customers (id, company_id, phone, name, sms_opt_in, is_active, created_at, updated_at)
                      VALUES (gen_random_uuid(), $1, $2, '대기', NULL, true, NOW(), NOW())`, [CO, p]);
    await upsert([{ phone: p, sms_opt_in: null }]);
    expect(await consentOf(p)).toBeNull();
  });

  it('이미 있는 값 = 그대로(거부는 거부 · 동의는 동의) · 명시 값은 그 값', async () => {
    const [n, y] = [phone(), phone()];
    await upsert([{ phone: n, sms_opt_in: false }, { phone: y, sms_opt_in: true }]);
    await upsert([{ phone: n, sms_opt_in: null }, { phone: y, sms_opt_in: null }]);
    expect(await consentOf(n)).toBe(false);
    expect(await consentOf(y)).toBe(true);
  });
});
