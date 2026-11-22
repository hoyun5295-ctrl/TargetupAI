// replaces: none
/**
 * C157 한 줄로 묻기 — 서버 적재 · 문자 종류 · 번호 꼴(★ 2026-11-22 · 실 PostgreSQL 판 · 설계서 docs/2026-11-22-c157-ask-send-options-design.md §5)
 *   운영 문장을 글자 그대로 돌린다(새 표 · 새 칸 0). 기대값 = 손으로 센 사람 · 순서 · 금액.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, query } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import {
  countAskCells, countAskPlan, listAskAudience, readAskPrice, readAskPrices, readAskPlan, stageAskAudience, dropAskStaging, askAmount,
  askAudienceWhere, askCellsOf, type AskPlanInput,
} from '../ask-segments';
import { sealServerStaging } from '../operator-recipients';
import { stagingSendSignature } from '../direct-send-core';
import { sendableCustomerSql } from '../product-signal';
import { audienceDetail } from '../../services/ai-line';

const CO = randomUUID();
const ADMIN = randomUUID();
/** KST 오늘에서 n일 전 날짜 */
const kstDay = (n: number) => new Date(Date.now() + 9 * 3600 * 1000 - n * 86400000).toISOString().slice(0, 10);
const ids: Record<string, string> = {};
/** 떠나는 단골 칸(400일대 · 5번)의 고객 — 이름 · 저장 번호 · 며칠 전 구매 */
const mk = async (name: string, phone: string, days: number, extra: Record<string, unknown> = {}) => {
  ids[name] = randomUUID();
  await insertMinimalRow(pool, 'customers', {
    id: ids[name], company_id: CO, phone, name, is_active: true, sms_opt_in: true,
    recent_purchase_date: kstDay(days), purchase_count: 5, ...extra,
  });
};
const LEAVE = (o: Partial<AskPlanInput> = {}): AskPlanInput => ({ groups: ['leave'], mode: 'all', budget: null, order: 'recent', ...o });
const staged = async (stagingId: string) => (await query(
  `SELECT phone, name, callback FROM campaign_send_staging WHERE staging_id = $1::uuid AND company_id = $2::uuid ORDER BY id`, [stagingId, CO])).rows;

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C98-DDL-2'));   // customers.joined_at(AI 한줄로 대상 상세가 읽는 칸 · 덤프 뒤 DDL)
  await insertMinimalRow(pool, 'companies', { id: CO, cost_per_sms: 10, cost_per_lms: 30, cost_per_mms: 100, unit_price_basis: 'vat_included' });
  await insertMinimalRow(pool, 'users', { id: ADMIN, company_id: CO, login_id: `c157${CO.slice(0, 6)}`, name: '관리자', user_type: 'admin' });
  // 최근 순 = 가(400일) → 나(410) → 다(420) → 라(430) → 마(440)
  await mk('가', '01000015701', 400, { store_phone: '0212345678' });
  await mk('나', '01000015702', 410);
  await mk('다', '01000015703', 420, { store_phone: '0298765432' });
  // 같은 번호가 숫자 꼴 행 + 하이픈 꼴 행으로 둘 — 하이픈 행이 더 최근이어도 대표는 숫자 꼴 행(일꾼이 그 행의 칼럼 값을 찾는다)
  await mk('라', '01000015704', 430);
  await mk('라하이픈', '010-0001-5704', 405);
  // 하이픈 꼴 행만 있는 고객(번호는 정상 · 일꾼은 이 고객의 칼럼 값을 찾지 못한다)
  await mk('마', '010-0001-5705', 440);
  // 숫자가 하나도 없는 번호 = 대상 아님
  await mk('바', '---', 400);
});

describe('C157 대상 한 문장 — 번호는 숫자만 · 대표는 숫자 꼴 행(설계서 S2-a · D11)', () => {
  it('꼴만 다른 같은 번호 = 한 명 · 숫자가 없는 번호는 빠진다 · 세기와 칸 세기와 옛 명단이 같은 수', async () => {
    const price = await readAskPrice(CO);
    const c = await countAskPlan(CO, ADMIN, LEAVE(), price);
    expect([c!.sendable, c!.planned]).toEqual([5, 5]);
    const cells = await countAskCells(CO, ADMIN);
    expect(cells.cells.filter((x) => x.group === 'leave').reduce((a, x) => a + x.sendable, 0)).toBe(5);
    const list = await listAskAudience(CO, ADMIN, LEAVE(), price);
    expect(list!.recipients).toEqual([
      { phone: '01000015701', name: '가' }, { phone: '01000015702', name: '나' }, { phone: '01000015703', name: '다' },
      { phone: '01000015704', name: '라' }, { phone: '01000015705', name: '마' },
    ]);
  });
});

describe('C157 서버 적재 — 세기와 같은 사람 · 순서 · 상한(설계서 S2)', () => {
  it('모두에게 = 다섯 줄 · 번호는 숫자만 · 순서 = 최근 구매 순 · 대표 = 숫자 꼴 행의 이름', async () => {
    const stagingId = randomUUID();
    const out = await stageAskAudience(CO, ADMIN, LEAVE(), await readAskPrice(CO), { stagingId, individualCallback: false, plainOnly: false });
    expect(out).toEqual({ staged: 5, unfillable: 0 });
    expect(await staged(stagingId)).toEqual([
      { phone: '01000015701', name: '가', callback: null }, { phone: '01000015702', name: '나', callback: null }, { phone: '01000015703', name: '다', callback: null },
      { phone: '01000015704', name: '라', callback: null }, { phone: '01000015705', name: '마', callback: null },
    ]);
    await dropAskStaging(CO, stagingId);
    expect(await staged(stagingId)).toEqual([]);
    // 번호 순과 최근 구매 순이 다른 자료로도 적재 차례 = 최근 구매 순(위 자료는 두 순서가 같아 차례를 가르지 못한다 · 변이 「적재 순서를 번호 순으로」가 지나갔다)
    //   가 = 번호는 가장 앞 · 구매는 가장 오래됨 → 맨 뒤
    await query(`UPDATE customers SET recent_purchase_date = $2 WHERE id = $1::uuid`, [ids['가'], kstDay(445)]);
    try {
      const second = randomUUID();
      await stageAskAudience(CO, ADMIN, LEAVE(), await readAskPrice(CO), { stagingId: second, individualCallback: false, plainOnly: false });
      expect((await staged(second)).map((r: any) => r.name)).toEqual(['나', '다', '라', '마', '가']);
      // 예산으로 자르면 앞에서부터 = 가장 오래된 가 가 빠진다(30원 × 4명)
      const cut = randomUUID();
      await stageAskAudience(CO, ADMIN, LEAVE({ mode: 'budget', budget: 120 }), await readAskPrice(CO), { stagingId: cut, individualCallback: false, plainOnly: false });
      expect((await staged(cut)).map((r: any) => r.name)).toEqual(['나', '다', '라', '마']);
      await dropAskStaging(CO, second);
      await dropAskStaging(CO, cut);
    } finally {
      await query(`UPDATE customers SET recent_purchase_date = $2 WHERE id = $1::uuid`, [ids['가'], kstDay(400)]);
    }
  });

  it('예산 = 그 종류의 1통 값으로 자른다(SMS 10원 · LMS 30원 · MMS 100원) · 적재 수 = 세기의 보낼 인원', async () => {
    const prices = await readAskPrices(CO);
    expect([prices.SMS.lms, prices.LMS.lms, prices.MMS.lms]).toEqual([10, 30, 100]);
    for (const [channel, want] of [['SMS', 5], ['LMS', 3], ['MMS', 1]] as const) {
      const plan = LEAVE({ mode: 'budget', budget: 100, ...(channel === 'LMS' ? {} : { channel }) });
      const price = await readAskPrice(CO, channel);
      const counted = await countAskPlan(CO, ADMIN, plan, price);
      expect([channel, counted!.planned, counted!.amount]).toEqual([channel, want, want * price.lms]);
      const stagingId = randomUUID();
      const out = await stageAskAudience(CO, ADMIN, plan, price, { stagingId, individualCallback: false, plainOnly: false });
      expect(out!.staged).toBe(want);
      expect((await staged(stagingId)).map((r: any) => r.name)).toEqual(['가', '나', '다', '라', '마'].slice(0, want));
      expect(askAmount(out!.staged, price)).toBe(counted!.amount);
      await dropAskStaging(CO, stagingId);
    }
  });

  it('고객 원장을 찾아야 채워지는 변수가 든 문안 = 숫자 꼴이 아닌 번호의 고객을 빼고 남은 사람으로 채운다 · 뺀 수를 낸다', async () => {
    const price = await readAskPrice(CO);
    const a = randomUUID();
    expect(await stageAskAudience(CO, ADMIN, LEAVE(), price, { stagingId: a, individualCallback: false, plainOnly: true })).toEqual({ staged: 4, unfillable: 1 });
    expect((await staged(a)).map((r: any) => r.name)).toEqual(['가', '나', '다', '라']);
    await dropAskStaging(CO, a);
    // 예산 2명: 뺄 사람(마)은 어차피 상한 밖 = 뺀 수 0
    const b = randomUUID();
    expect(await stageAskAudience(CO, ADMIN, LEAVE({ mode: 'budget', budget: 60 }), price, { stagingId: b, individualCallback: false, plainOnly: true })).toEqual({ staged: 2, unfillable: 0 });
    await dropAskStaging(CO, b);
  });

  it('개별 회신 = 그 고객의 매장 번호를 싣는다(없는 고객은 빈 칸 = 마감이 뺀다)', async () => {
    const stagingId = randomUUID();
    await stageAskAudience(CO, ADMIN, LEAVE(), await readAskPrice(CO), { stagingId, individualCallback: true, plainOnly: false });
    expect((await staged(stagingId)).map((r: any) => [r.name, r.callback])).toEqual([['가', '0212345678'], ['나', null], ['다', '0298765432'], ['라', null], ['마', null]]);
    await dropAskStaging(CO, stagingId);
  });

  it('예산인데 단가 미설정 = null(적재하지 않는다)', async () => {
    const other = randomUUID();
    await insertMinimalRow(pool, 'companies', { id: other });
    await query('UPDATE companies SET cost_per_sms = NULL, cost_per_lms = NULL, cost_per_mms = NULL WHERE id = $1', [other]);
    const stagingId = randomUUID();
    expect(await stageAskAudience(other, null, LEAVE({ mode: 'budget', budget: 1000 }), await readAskPrice(other), { stagingId, individualCallback: false, plainOnly: false })).toBeNull();
  });
});

describe('C157 마감 CT — 중복 제거 · 서명 · 표본(설계서 S1)', () => {
  it('적재한 명단을 고정한다: 서명 = 실제 발송 집합 · 수 = 서명이 센 수 · 줄이 바뀌면 서명이 달라진다', async () => {
    const stagingId = randomUUID();
    await stageAskAudience(CO, ADMIN, LEAVE(), await readAskPrice(CO), { stagingId, individualCallback: false, plainOnly: false });
    // 같은 번호 한 줄을 더 넣어 둔다(마감이 번호당 첫 줄만 남긴다)
    await query(`INSERT INTO campaign_send_staging (staging_id, company_id, phone, name) VALUES ($1::uuid, $2::uuid, '01000015701', '겹침')`, [stagingId, CO]);
    const sealed = await sealServerStaging({
      stagingId, companyId: CO, userId: ADMIN, userType: 'admin', adEnabled: false, individualCallback: false,
      sendPlan: { scheduled: false, scheduledAt: null }, branch: 'ai',
    });
    expect([sealed.total, sealed.excluded]).toEqual([5, { duplicates: 1, callback: 0 }]);
    expect(sealed.sample.map((r) => r.name)).toEqual(['가', '나', '다', '라', '마']);
    expect(sealed.signature).toBe(await stagingSendSignature(stagingId, CO, ADMIN, true, true));
    expect(sealed.signature.startsWith('5:')).toBe(true);
    await query(`DELETE FROM campaign_send_staging WHERE staging_id = $1::uuid AND phone = '01000015705'`, [stagingId]);
    expect(await stagingSendSignature(stagingId, CO, ADMIN, true, true)).not.toBe(sealed.signature);
    await dropAskStaging(CO, stagingId);
  });

  it('개별 회신 = 매장 번호가 없거나 등록되지 않은 고객을 뺀 수를 낸다(판정 = 직접발송과 같은 CT)', async () => {
    const stagingId = randomUUID();
    await stageAskAudience(CO, ADMIN, LEAVE(), await readAskPrice(CO), { stagingId, individualCallback: true, plainOnly: false });
    const sealed = await sealServerStaging({
      stagingId, companyId: CO, userId: ADMIN, userType: 'admin', adEnabled: false, individualCallback: true,
      sendPlan: { scheduled: false, scheduledAt: null }, branch: 'ai',
    });
    // 등록된 회신번호가 하나도 없는 회사 = 다섯 모두 빠진다(매장 번호 없음 셋 + 미등록 둘)
    expect([sealed.total, sealed.excluded.callback]).toEqual([0, 5]);
    await dropAskStaging(CO, stagingId);
  });
});

describe('C157 입력 · 표본(설계서 S3 · S5)', () => {
  it('문자 종류 = 셋 가운데 하나 · 없으면 칸을 두지 않는다(옛 요청과 같은 값) · LMS 를 적어도 칸을 두지 않는다 · 그 밖 = 틀린 입력', () => {
    const base = { groups: ['leave'], mode: 'all' };
    expect(readAskPlan(base)).toEqual({ groups: ['leave'], mode: 'all', budget: null, order: 'recent' });
    expect(readAskPlan({ ...base, channel: 'LMS' })).toEqual({ groups: ['leave'], mode: 'all', budget: null, order: 'recent' });
    expect(readAskPlan({ ...base, channel: 'SMS' })).toEqual({ groups: ['leave'], mode: 'all', budget: null, order: 'recent', channel: 'SMS' });
    expect(readAskPlan({ ...base, mode: 'budget', budget: 5000, channel: 'MMS' })).toEqual({ groups: ['leave'], mode: 'budget', budget: 5000, order: 'recent', channel: 'MMS' });
    expect(readAskPlan({ ...base, channel: 'KAKAO' })).toBeNull();
    expect(readAskPlan({ ...base, channel: null })).toBeNull();
  });

  it('표본 · 칼럼 목록 = AI 한줄로의 대상 상세와 같은 함수 · 대상 = 고른 묶음의 보낼 수 있는 고객', async () => {
    const detail = await audienceDetail(CO, {
      blocked: false, unresolved: false, empty: false,
      where: askAudienceWhere(await sendableCustomerSql(CO, ADMIN)), params: [CO, askCellsOf(['leave'])],
    }, 5, []);
    expect(detail.top).not.toBeNull();
    expect(Object.values(ids)).toContain(detail.top!.id);
    expect(detail.top!.id).not.toBe(ids['바']);   // 숫자가 없는 번호의 고객은 대상이 아니다
    expect(Array.isArray(detail.columns)).toBe(true);
  });
});
