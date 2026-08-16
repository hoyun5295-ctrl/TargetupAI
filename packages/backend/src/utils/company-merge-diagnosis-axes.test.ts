/**
 * company-merge — 마케팅 진단 축 등재 계약 (2026-08-16, 설계서 §4-7)
 *
 * 왜 있나
 *   병합 CT는 미등재 회사 축에 행이 있으면 병합을 통째로 차단한다(fail-closed).
 *   진단 3테이블이 표에서 빠지면 진단 완료 회사의 병합이 전부 막힌다 — 등재 자체를 계약으로 고정.
 *   (0729 교훈: 손으로 고른 축은 빠뜨린다 — 그래서 빠뜨리면 여기가 빨간불이 되게 한다)
 */
import { describe, it, expect } from 'vitest';
import { newDb } from 'pg-mem';
import { COMPANY_MERGE_AXES, COMPANY_MERGE_INDIRECT_AXES, moveTables, DIAGNOSIS_GRANT_SPLIT_SQL } from './company-merge';

const axisOf = (table: string) => COMPANY_MERGE_AXES.find((a) => a.table === table);

describe('마케팅 진단 병합 축(§4-7)', () => {
  it('marketing_diagnoses = move(진단·리드 원장 승계)', () => {
    expect(axisOf('marketing_diagnoses')?.action).toBe('move');
    expect(moveTables()).toContain('marketing_diagnoses');
  });

  it('diagnosis_trial_grants·diagnosis_invites = keep(선행 행 유지 — 병합 대상의 1회 한정·초대 상태 보존)', () => {
    expect(axisOf('diagnosis_trial_grants')?.action).toBe('keep');
    expect(axisOf('diagnosis_invites')?.action).toBe('keep');
    expect(moveTables()).not.toContain('diagnosis_trial_grants');
    expect(moveTables()).not.toContain('diagnosis_invites');
  });

  it('간접 축 — 지급 이력(keep)이 진단 행(move)을 가리키는 FK가 block으로 등재돼 있다', () => {
    const indirect = COMPANY_MERGE_INDIRECT_AXES.find(
      (a) => a.childTable === 'diagnosis_trial_grants' && a.parentTable === 'marketing_diagnoses',
    );
    expect(indirect).toBeDefined();
    expect(indirect?.childColumns).toEqual(['diagnosis_id']);
    expect(indirect?.action).toBe('block');
  });
});

describe('지급 결합 차단 SQL — 실 의미(pg-mem · Codex 적대 수용)', () => {
  const S = '00000000-0000-0000-0000-00000000005a';   // source(옛 회사)
  const O = '00000000-0000-0000-0000-00000000000b';   // 무관 회사
  const D_B = '00000000-0000-0000-0000-0000000000d1'; // 퍼널 B 진단(company NULL·linked=S)
  const D_A = '00000000-0000-0000-0000-0000000000d2'; // 퍼널 A 진단(company=S)
  const D_X = '00000000-0000-0000-0000-0000000000d3'; // 무관 진단

  function setup() {
    const db = newDb();
    db.public.none(`
      CREATE TABLE marketing_diagnoses (
        id uuid PRIMARY KEY,
        company_id uuid,
        linked_company_id uuid
      );
      CREATE TABLE diagnosis_trial_grants (
        id uuid PRIMARY KEY,
        company_id uuid NOT NULL,
        diagnosis_id uuid NOT NULL
      );
      INSERT INTO marketing_diagnoses (id, company_id, linked_company_id) VALUES
        ('${D_B}', NULL,   '${S}'),
        ('${D_A}', '${S}', NULL),
        ('${D_X}', NULL,   '${O}');
      INSERT INTO diagnosis_trial_grants (id, company_id, diagnosis_id) VALUES
        ('00000000-0000-0000-0000-000000000091', '${S}', '${D_B}'),
        ('00000000-0000-0000-0000-000000000092', '${S}', '${D_A}'),
        ('00000000-0000-0000-0000-000000000093', '${O}', '${D_X}');
    `);
    const adapter = db.adapters.createPg();
    return new adapter.Pool();
  }

  it('옛 회사 기준 — 퍼널 B(linked 축) 지급 결합까지 잡는다(공용 간접 카운트의 사각)', async () => {
    const pool = setup();
    const r = await pool.query(DIAGNOSIS_GRANT_SPLIT_SQL, [S]);
    expect(Number(r.rows[0].cnt)).toBe(2);   // D_B(linked=S) + D_A(company=S). 무관 회사 결합은 제외
  });

  it('결합이 없는 회사는 0 — 병합이 진행된다', async () => {
    const pool = setup();
    const r = await pool.query(DIAGNOSIS_GRANT_SPLIT_SQL, ['00000000-0000-0000-0000-00000000000c']);
    expect(Number(r.rows[0].cnt)).toBe(0);
  });
});
