// replaces: none
/**
 * C156 유입 경로 — 문자 링크 표식으로 시작한 방문(★ 2026-11-22 · 실 PostgreSQL 판 · 설계서 docs/2026-11-22-c156-message-link-inflow-design.md §5)
 *   기대값 = 손으로 센 방문 · 구매(코드가 세는 방식으로 다시 세지 않는다).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { listInflowChannels, inflowOwnSql } from '../inflow-channel';
import { inflowTaggedUrl } from '../short-url';

const CO = randomUUID();
const OTHER = randomUUID();
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const ev = (company: string, name: string, properties: Record<string, unknown>, at: string, session: string) =>
  insertMinimalRow(pool, 'cdp_events', { id: randomUUID(), company_id: company, event_name: name, source: 'test', properties: JSON.stringify(properties), occurred_at: at, session_id: session });
const pv = (session: string, url: string, referrer: string, at: string, company = CO) => ev(company, 'page_view', { url, referrer, title: 't' }, at, session);
const buy = (session: string, amount: number, at: string) => ev(CO, 'purchase', { revenue_applied: true, total_amount: amount }, at, session);

const TAGGED = 'https://shop.test/p?product_no=1&hanjul_link=1';

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO });
  await insertMinimalRow(pool, 'companies', { id: OTHER });
  // ① 표식 줄과 표식 없는 줄이 **같은 시각**(한 묶음으로 올라온 페이지뷰 · 화면이 주소를 바로 고쳐 쓴 경우) → 순서와 무관하게 새 줄 · 구매도 그 줄
  const t1 = hoursAgo(50);
  await pv('s-own', 'https://shop.test/p', TAGGED, t1);
  await pv('s-own', TAGGED, '', t1);
  await buy('s-own', 30000, hoursAgo(49));
  // ② 고객이 스스로 단 hanjul 꼬리표 → 지금 줄 그대로
  await pv('s-utm', 'https://shop.test/?utm_source=hanjul&utm_medium=email', '', hoursAgo(40));
  // ④ 표식 없는 방문들
  await pv('s-direct', 'https://shop.test/', '', hoursAgo(30));
  await pv('s-search', 'https://shop.test/', 'https://search.naver.com/q', hoursAgo(29));
  // ⑤ (설계 2R 반례) 고객 꼬리표로 시작 → 5분 뒤 구매 → 10분 뒤 표식 페이지뷰 = 방문 · 구매 모두 처음 갈래 그대로
  await pv('s-late', 'https://shop.test/?utm_source=newsletter', '', hoursAgo(20));
  await buy('s-late', 20000, new Date(Date.now() - 20 * 3600 * 1000 + 5 * 60 * 1000).toISOString());
  await pv('s-late', TAGGED, '', new Date(Date.now() - 20 * 3600 * 1000 + 10 * 60 * 1000).toISOString());
  // 다른 회사의 표식 방문은 섞이지 않는다
  await pv('s-own', TAGGED, '', hoursAgo(10), OTHER);
});

describe('C156 유입 경로 — 표식으로 시작한 세션만 「한줄로 메시지 링크」', () => {
  it('경로별 방문 · 구매 · 매출', async () => {
    const rows = Object.fromEntries((await listInflowChannels(CO)).map((r) => [r.channel, [r.visits, r.purchases, r.revenue]]));
    expect(rows).toEqual({
      '한줄로 메시지 링크': [1, 1, 30000],
      '링크 꼬리표 · newsletter': [1, 1, 20000],
      '링크 꼬리표 · hanjul': [1, 0, 0],
      '직접 방문': [1, 0, 0],
      '검색': [1, 0, 0],
    });
  });

  it('표식 식: 붙이는 꼴 셋은 잡고 · 조각 · 경로 · 다른 칸의 값 안의 같은 글자는 잡지 않는다', async () => {
    const own = async (url: string) => (await pool.query(`SELECT ${inflowOwnSql('$1::text')} AS own`, [url])).rows[0].own;
    const shop = ['https://shop.test'];
    // 추적 링크가 실제로 붙이는 세 꼴(쿼리 없음 · 있던 쿼리 뒤 · 물음표로 끝난 주소)
    for (const src of ['https://shop.test/event', 'https://shop.test/p?product_no=1', 'https://shop.test/p?']) {
      const tagged = inflowTaggedUrl(src, shop);
      expect(tagged).not.toBe(src);
      expect(await own(tagged), tagged).toBe(true);
    }
    expect(await own('https://shop.test/p?hanjul_link=1&x=2')).toBe(true);
    expect(await own('https://shop.test/p?a=1&hanjul_link=1#top')).toBe(true);
    for (const no of [
      'https://shop.test/#/a?hanjul_link=1',
      'https://shop.test/items/&hanjul_link=1',
      'https://shop.test/a?returnUrl=https://o.example/?hanjul_link=1',
      'https://shop.test/a?xhanjul_link=1',
      'https://shop.test/a?hanjul_link=10',
      'https://shop.test/a',
      '',
    ]) {
      expect(await own(no), no).toBe(false);
    }
    expect((await pool.query(`SELECT ${inflowOwnSql('NULL::text')} AS own`)).rows[0].own).toBe(false);
  });
});
