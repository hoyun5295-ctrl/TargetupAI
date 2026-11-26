// replaces: none
/**
 * 스팸 확인 판 재작성(C164 · ★ 2026-11-26 · 설계서 docs/2026-11-25-spam-diag-rewrite-design.md) — 실 PostgreSQL 판
 *   주소 바꾸기 = 판 등록 트랜잭션 안에서 링크를 만든다(되돌리면 링크도 사라진다 · 같은 원래 주소는 한 번 · 회사 하루 상한).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { swapUrlsInPlate, SPAM_SWAP_LINK_TITLE } from '../spam-link-swap';

const CO = randomUUID();
const US = randomUUID();
const TEXT = '(광고) 하늘몰\n보러 가기 https://tinyurl.example/zz9.\n또 보기 https://tinyurl.example/zz9 http://shop.example/sale?x=1\n무료 수신거부 080-000-0000';
const EDITABLE = [{ sentLine: 1, tplLine: 0 }, { sentLine: 2, tplLine: 1 }];
const linkCount = async () => (await pool.query(`SELECT COUNT(*)::int AS n FROM dm_custom_short_links WHERE company_id = $1`, [CO])).rows[0].n;

/** 트랜잭션 하나를 열어 fn 을 돌리고 반드시 되돌린다(판 등록이 실패해 되돌리는 경우와 같은 꼴) */
async function inRolledBackTx<T>(fn: (run: (sql: string, params?: any[]) => Promise<any>) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    return await fn((sql, params) => c.query(sql, params));
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    c.release();
  }
}

beforeAll(async () => {
  process.env.DM_SHORT_LINK_BASE = 'https://hlj.kr';
  await insertMinimalRow(pool, 'companies', { id: CO });
  await insertMinimalRow(pool, 'users', { id: US, company_id: CO, user_type: 'user', is_active: true, login_id: `t-1126-rw-${US.slice(0, 8)}` });
});

describe('주소 바꾸기(swapUrlsInPlate · 설계서 §7)', () => {
  it('고칠 줄의 주소가 전부 짧은 주소로 · 링크는 원래 주소를 그대로 가리킨다 · 같은 주소는 링크 하나 · 되돌리면 링크 0', async () => {
    await inRolledBackTx(async (run) => {
      const r = await swapUrlsInPlate({ companyId: CO, userId: US, text: TEXT, editable: EDITABLE, known: [], create: true, run });
      expect(r!.urls.map((u) => u.from)).toEqual(['https://tinyurl.example/zz9', 'http://shop.example/sale?x=1']);
      const [a, b] = r!.urls;
      expect(a.to.startsWith('https://hlj.kr/')).toBe(true);
      expect(a.to).not.toBe(b.to);
      expect(r!.text).toBe(`(광고) 하늘몰\n보러 가기 ${a.to}.\n또 보기 ${a.to} ${b.to}\n무료 수신거부 080-000-0000`);
      const rows = (await run(`SELECT id, code, target_url, title, created_by FROM dm_custom_short_links WHERE company_id = $1`, [CO])).rows;
      expect(rows.length).toBe(2);
      const byTarget = Object.fromEntries(rows.map((x: any) => [x.target_url, x]));
      expect(`https://hlj.kr/${byTarget['https://tinyurl.example/zz9'].code}`).toBe(a.to);
      expect(`https://hlj.kr/${byTarget['http://shop.example/sale?x=1'].code}`).toBe(b.to);
      expect(byTarget['https://tinyurl.example/zz9'].id).toBe(a.linkId);
      expect(rows.every((x: any) => x.title === SPAM_SWAP_LINK_TITLE && x.created_by === US)).toBe(true);
    });
    expect(await linkCount()).toBe(0);
  });

  it('앞 판이 만든 주소는 그 짧은 주소를 다시 쓰고 새로 만들지 않는다', async () => {
    const known = [{ from: 'https://tinyurl.example/zz9', to: 'https://hlj.kr/Known001', linkId: randomUUID() }];
    await inRolledBackTx(async (run) => {
      const r = await swapUrlsInPlate({ companyId: CO, userId: US, text: TEXT, editable: EDITABLE, known, create: true, run });
      expect(r!.urls[0]).toEqual(known[0]);
      expect(r!.text).toContain('보러 가기 https://hlj.kr/Known001.');
      const rows = (await run(`SELECT target_url FROM dm_custom_short_links WHERE company_id = $1`, [CO])).rows;
      expect(rows.map((x: any) => x.target_url)).toEqual(['http://shop.example/sale?x=1']);
    });
  });

  it('★ Codex 구현 1R — 새 링크를 만들 수 없는 길(create 거짓 = 주소 판이 아닌 판)은 앞 판의 주소만 쓴다 · 모르는 주소가 하나라도 있으면 null · 링크 0', async () => {
    const known = [{ from: 'https://tinyurl.example/zz9', to: 'https://hlj.kr/Known001', linkId: randomUUID() }, { from: 'http://shop.example/sale?x=1', to: 'https://hlj.kr/Known002', linkId: randomUUID() }];
    await inRolledBackTx(async (run) => {
      const all = await swapUrlsInPlate({ companyId: CO, userId: US, text: TEXT, editable: EDITABLE, known, create: false, run });
      expect(all!.text).toBe('(광고) 하늘몰\n보러 가기 https://hlj.kr/Known001.\n또 보기 https://hlj.kr/Known001 https://hlj.kr/Known002\n무료 수신거부 080-000-0000');
      expect(await swapUrlsInPlate({ companyId: CO, userId: US, text: TEXT, editable: EDITABLE, known: [known[0]], create: false, run })).toBeNull();
      expect((await run(`SELECT COUNT(*)::int AS n FROM dm_custom_short_links WHERE company_id = $1`, [CO])).rows[0].n).toBe(0);
    });
  });

  it('회사 하루 상한(50)에 닿으면 null · 링크는 늘지 않는다', async () => {
    const tag = randomUUID().slice(0, 6);
    // 만든 시각 = 내일(상한 식이 오늘의 시작을 어디로 잡든 「오늘 만든 것」으로 세어진다 · 지금 식은 UTC 세션에서 KST 18시를 시작으로 잡는다 = BUGS B-1126-1 · 이 시험은 그 식에 기대지 않는다)
    await pool.query(
      `INSERT INTO dm_custom_short_links (company_id, code, target_url, created_at) SELECT $1::uuid, $2 || g::text, 'https://cap.example/' || g::text, NOW() + INTERVAL '1 day' FROM generate_series(1, 50) g`,
      [CO, `c${tag}`],
    );
    try {
      const r = await inRolledBackTx((run) => swapUrlsInPlate({ companyId: CO, userId: US, text: TEXT, editable: EDITABLE, known: [], create: true, run }));
      expect(r).toBeNull();
      expect(await linkCount()).toBe(50);
    } finally {
      await pool.query(`DELETE FROM dm_custom_short_links WHERE company_id = $1`, [CO]);
    }
  });

  it('바꿀 주소가 없거나 단축 도메인 설정이 없으면 null · 링크 0', async () => {
    const none = await inRolledBackTx((run) => swapUrlsInPlate({ companyId: CO, userId: US, text: '(광고) 하늘몰\n주소 없는 줄\n무료 수신거부 080-000-0000', editable: [{ sentLine: 1, tplLine: 0 }], known: [], create: true, run }));
    expect(none).toBeNull();
    process.env.DM_SHORT_LINK_BASE = '';
    try {
      const noBase = await inRolledBackTx((run) => swapUrlsInPlate({ companyId: CO, userId: US, text: TEXT, editable: EDITABLE, known: [], create: true, run }));
      expect(noBase).toBeNull();
    } finally {
      process.env.DM_SHORT_LINK_BASE = 'https://hlj.kr';
    }
    expect(await linkCount()).toBe(0);
  });
});
