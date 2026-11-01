// replaces: none
/**
 * 여정 사람 값 원장(journeys.copy_facts) · 채우기 주소 몸통 — 실 PostgreSQL 판(★ 2026-11-01 여정 재발 방지 B1-2 · B1-3)
 * 새 칸(원장 C89-DDL-1)은 이 파일의 사본에 원장 블록을 그대로 실행해 만든다(원장 SQL 도 함께 검증).
 *   못 박는 것: 원장 쓰기 = 키마다 jsonb_set(다른 키 보존 · NULL 에서도) · 채우기 = 원장 + 모든 문자 칸 자리표시를 한 트랜잭션으로 ·
 *   켜진 여정은 칸 갱신 몸통 그대로(새 미검사 판 · 그날 검사 기록 지움) · 정상 안내문은 그대로.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import { writeJourneyCopyFacts, readJourneyCopyFacts, buildCopyFactsPatch } from '../journey-copy-facts';
import { fillJourneyCopyFacts } from '../journey-builder';
import { BENEFIT_PLACEHOLDER } from '../copy-benefit-detector';

const CO = '00000000-0000-0000-0000-0000000c2101';
const US = '00000000-0000-0000-0000-0000000a2101';
const J = '00000000-0000-0000-0000-0000000b2101';
const S1 = '00000000-0000-0000-0000-0000000d2101';
const S2 = '00000000-0000-0000-0000-0000000d2102';

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C89-DDL-1'));
  await insertMinimalRow(pool, 'companies', { id: CO });
  await insertMinimalRow(pool, 'users', { id: US, company_id: CO, user_type: 'user', is_active: true, login_id: 't-1101-facts' });
  await insertMinimalRow(pool, 'journeys', { id: J, company_id: CO, created_by: US, name: '원장 여정', status: 'active', start_kind: 'event', trigger_event: 'customer.created', callback_number: '0212345678' });
  await insertMinimalRow(pool, 'journey_steps', { id: S1, journey_id: J, step_order: 1, step_type: 'message', channel: 'lms', subject: '안내', message_template: `지금 ${BENEFIT_PLACEHOLDER} 드려요\n자세히 → [URL 입력]` });
  await insertMinimalRow(pool, 'journey_steps', { id: S2, journey_id: J, step_order: 2, step_type: 'message', channel: 'sms', message_template: '[혜택은 앱에서 직접 확인하세요] 감사합니다' });
});

const facts = async () => (await pool.query(`SELECT copy_facts FROM journeys WHERE id = $1`, [J])).rows[0].copy_facts;
const step = async (id: string) => (await pool.query(`SELECT message_template, subject FROM journey_steps WHERE id = $1`, [id])).rows[0];

describe('원장 쓰기(키마다 jsonb_set)', () => {
  it('NULL 에서 혜택만 · 그 뒤 링크만 쓰면 혜택이 남는다', async () => {
    const run = (t: string, p?: any[]) => query(t, p);
    const p1 = buildCopyFactsPatch({ benefits: ['첫 구매 10% 할인쿠폰'] }, 'question', 'T1');
    await writeJourneyCopyFacts(run, J, { benefits: p1.benefits });
    const p2 = buildCopyFactsPatch({ link: 'https://hanjul.ai/e' }, 'fill', 'T2');
    await writeJourneyCopyFacts(run, J, { link: p2.link });
    const f = await facts();
    expect(f.benefits).toEqual([{ text: '첫 구매 10% 할인쿠폰', by: 'question', at: 'T1' }]);
    expect(f.link).toEqual({ url: 'https://hanjul.ai/e', by: 'fill', at: 'T2' });
    expect((await readJourneyCopyFacts(CO, J)).benefits?.[0]?.text).toBe('첫 구매 10% 할인쿠폰');
    await pool.query(`UPDATE journeys SET copy_facts = NULL WHERE id = $1`, [J]);
  });
});

describe('채우기 주소 몸통(fillJourneyCopyFacts)', () => {
  it('혜택 = 원장 + 모든 문자 칸의 자리표시 · 정상 안내문 그대로 · 켜진 여정 = 새 미검사 판', async () => {
    const out = await fillJourneyCopyFacts(CO, J, { benefit: '첫 구매 10% 할인쿠폰' });
    expect(out?.steps.map((s) => s.id)).toEqual([S1, S2]);
    expect((await step(S1)).message_template).toBe('지금 첫 구매 10% 할인쿠폰 드려요\n자세히 → [URL 입력]');
    expect((await step(S2)).message_template).toBe('[혜택은 앱에서 직접 확인하세요] 감사합니다');
    expect((await facts()).benefits[0].text).toBe('첫 구매 10% 할인쿠폰');
    const snap = (await pool.query(`SELECT message_body, confidence_score FROM journey_step_snapshots WHERE step_id = $1 ORDER BY created_at DESC LIMIT 1`, [S1])).rows[0];
    expect(snap?.message_body).toContain('첫 구매 10% 할인쿠폰');
    expect(Number(snap?.confidence_score)).toBeLessThan(100);
  });
  it('링크 = 자리표시만 바꾸고 붙이지 않는다 · 혜택 원장은 그대로', async () => {
    await fillJourneyCopyFacts(CO, J, { url: 'https://hanjul.ai/e' });
    expect((await step(S1)).message_template).toBe('지금 첫 구매 10% 할인쿠폰 드려요\n자세히 → https://hanjul.ai/e');
    expect((await step(S2)).message_template).toBe('[혜택은 앱에서 직접 확인하세요] 감사합니다');
    const f = await facts();
    expect(f.benefits[0].text).toBe('첫 구매 10% 할인쿠폰');
    expect(f.link.url).toBe('https://hanjul.ai/e');
  });
  it('못 쓰는 링크 · 빈 입력 = 거절(원장 · 칸 안 바뀜)', async () => {
    await expect(fillJourneyCopyFacts(CO, J, { url: 'ftp://x' })).rejects.toThrow();
    await expect(fillJourneyCopyFacts(CO, J, { benefit: '  ' })).rejects.toThrow();
    expect((await facts()).link.url).toBe('https://hanjul.ai/e');
  });
});
