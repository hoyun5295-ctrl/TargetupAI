// replaces: none
/**
 * C103 · 1104 오류접수 처방 — 실 PostgreSQL 판(★ 2026-11-05 설계서 docs/2026-11-05-intake-1104-fix-design.md §5)
 *
 * 표 = 운영 schema-only 덤프 사본 · 대기 DDL(C98-DDL-2 customers.joined_at · C103-DDL-1 뷰)을 사본에 얹는다.
 *   F6 R57  FIELD_MAP 직접 칸 전부가 customers_unified 칸에 있다(칸을 더하고 뷰 DDL 을 원장에 안 올리면 빨간불)
 *           · 엑셀 다운로드 SELECT(buildDynamicSelectExpr · 가입일 포함)가 뷰에서 실제로 돈다
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pool, query } from '../../config/database';
import { ledgerBlockSql } from './pg/global-setup';
import { insertMinimalRow } from './pg/fixtures';
import { FIELD_MAP } from '../standard-field-map';
import { buildDynamicSelectExpr, type EnabledField } from '../enabled-fields';
import { randomUUID } from 'crypto';
import { updateJourneyStep } from '../journey-builder';

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C98-DDL-2'));
  await pool.query(ledgerBlockSql('C103-DDL-1'));
});

describe('F6 R57 · FIELD_MAP 직접 칸 = customers_unified 칸(실 PG)', () => {
  it('FIELD_MAP storageType column 칸 전부가 뷰에 있다', async () => {
    const r = await query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'customers_unified'`);
    const viewCols = new Set(r.rows.map((x: any) => String(x.column_name)));
    const missing = FIELD_MAP.filter((f) => f.storageType === 'column' && f.columnName && !viewCols.has(f.columnName)).map((f) => f.columnName);
    expect(missing).toEqual([]);
  });

  it('엑셀 다운로드 SELECT(가입일 칸 포함)가 뷰에서 돈다 · 가입일 = YYYY-MM-DD 글자', async () => {
    const co = '00000000-0000-0000-0000-0000000c1036';
    await insertMinimalRow(pool, 'companies', { id: co });
    await insertMinimalRow(pool, 'customers', {
      company_id: co, phone: '01000000103', name: '가입일 시험', is_active: true, sms_opt_in: true, joined_at: '2026-11-01T09:00:00+09:00',
    });
    const fields: EnabledField[] = FIELD_MAP.filter((f) => f.storageType === 'column' && f.columnName).map((f) => ({
      field_key: f.fieldKey, display_name: f.displayName, field_label: f.displayName, data_type: f.dataType,
      category: f.category, sort_order: f.sortOrder, is_custom: false, column_name: f.columnName, normalize_function: f.normalizeFunction,
    }));
    const { selectExpr } = buildDynamicSelectExpr(fields, { tableAlias: 'customers_unified' });
    const out = await query(`SELECT ${selectExpr} FROM customers_unified WHERE company_id = $1 AND is_active = true`, [co]);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].joined_at).toBe('2026-11-01');
  });
});

describe('F10 F11 · 알림톡 칸 고치기(실 PG)', () => {
  const CO = randomUUID();
  const OTHER = randomUUID();
  const OWNER = randomUUID();
  const JD = randomUUID();   // 초안
  const JA = randomUUID();   // 켜짐
  const SD = randomUUID();
  const SA = randomUUID();
  const stepRow = async (id: string) => (await query(`SELECT message_template, alimtalk_template_code, alimtalk_variable_map FROM journey_steps WHERE id = $1`, [id])).rows[0];

  beforeAll(async () => {
    for (const c of [CO, OTHER]) await insertMinimalRow(pool, 'companies', { id: c });
    await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'user', is_active: true, phone: '010-0000-1105', login_id: 't-1105-kakao' });
    const prof = randomUUID();
    const profOther = randomUUID();
    await insertMinimalRow(pool, 'kakao_sender_profiles', { id: prof, company_id: CO });
    await insertMinimalRow(pool, 'kakao_sender_profiles', { id: profOther, company_id: OTHER });
    await insertMinimalRow(pool, 'kakao_templates', { company_id: CO, profile_id: prof, template_code: 'C103A', template_name: 'A', content: 'A 안내 #{이름}', status: 'APPROVED' });
    await insertMinimalRow(pool, 'kakao_templates', { company_id: CO, profile_id: prof, template_code: 'C103B', template_name: 'B', content: 'B 안내 #{이름}', status: 'APPROVED' });
    await insertMinimalRow(pool, 'kakao_templates', { company_id: OTHER, profile_id: profOther, template_code: 'C103X', template_name: 'X', content: '남의 회사 글', status: 'APPROVED' });
    for (const [j, st] of [[JD, 'draft'], [JA, 'active']] as const) {
      await insertMinimalRow(pool, 'journeys', { id: j, company_id: CO, created_by: OWNER, name: `알림톡 ${st}`, status: st, start_kind: 'event', trigger_event: 'customer.created', callback_number: '0212345678' });
    }
    for (const [id, j] of [[SD, JD], [SA, JA]] as const) {
      await insertMinimalRow(pool, 'journey_steps', { id, journey_id: j, step_order: 1, step_type: 'message', channel: 'kakao', message_template: '옛 칸 글', alimtalk_template_code: 'C103A', alimtalk_variable_map: JSON.stringify({ '#{이름}': '@@name@@' }), delay_mode: 'relative', delay_hours: 0 });
    }
  });

  it('템플릿을 바꾸면 칸 글 = 그 회사의 그 템플릿 본문 · 같은 글 직접 보냄 = 통과 · 다른 글 = 400', async () => {
    expect(await updateJourneyStep(CO, JD, SD, { alimtalkTemplateCode: 'C103B' })).toBe(true);
    expect(await stepRow(SD)).toMatchObject({ alimtalk_template_code: 'C103B', message_template: 'B 안내 #{이름}' });
    expect(await updateJourneyStep(CO, JD, SD, { messageTemplate: 'B 안내 #{이름}' })).toBe(true);
    await expect(updateJourneyStep(CO, JD, SD, { messageTemplate: '직접 고친 글' })).rejects.toMatchObject({ name: 'JourneyInputError' });
    expect((await stepRow(SD)).message_template).toBe('B 안내 #{이름}');
  });

  it('남의 회사 템플릿 코드 = 본문 맞춤 0(회사 격리)', async () => {
    expect(await updateJourneyStep(CO, JD, SD, { alimtalkTemplateCode: 'C103X' })).toBe(true);
    expect((await stepRow(SD)).message_template).toBe('B 안내 #{이름}');
    await updateJourneyStep(CO, JD, SD, { alimtalkTemplateCode: 'C103B' });
  });

  it('켜진 여정 = 허가 표식 없으면 409 · 있으면 그 자리 저장 · 변수만 바꿔도 확정본 0', async () => {
    await expect(updateJourneyStep(CO, JA, SA, { alimtalkVariableMap: { '#{이름}': '@@store_name@@' } })).rejects.toMatchObject({ code: 'STEP_EDIT_LOCKED' });
    const before = Number((await query(`SELECT count(*)::int AS n FROM journey_step_snapshots WHERE step_id = $1`, [SA])).rows[0].n);
    expect(await updateJourneyStep(CO, JA, SA, { alimtalkVariableMap: { '#{이름}': '@@store_name@@' }, allowActiveMessageEdit: true })).toBe(true);
    expect(await updateJourneyStep(CO, JA, SA, { alimtalkTemplateCode: 'C103B', allowActiveMessageEdit: true })).toBe(true);
    expect(await stepRow(SA)).toMatchObject({ alimtalk_template_code: 'C103B', message_template: 'B 안내 #{이름}', alimtalk_variable_map: { '#{이름}': '@@store_name@@' } });
    expect(Number((await query(`SELECT count(*)::int AS n FROM journey_step_snapshots WHERE step_id = $1`, [SA])).rows[0].n)).toBe(before);
  });
});
