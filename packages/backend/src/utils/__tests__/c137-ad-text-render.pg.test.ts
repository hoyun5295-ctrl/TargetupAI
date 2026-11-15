// replaces: none
/**
 * C137 — 표기 칸 SELECT 를 실 PostgreSQL 에서 돌린다(★ 2026-11-16 · 재오픈 cmwd36hnr1corjnscq7xlnim1)
 *   운영 문장 조각(campaignAdTextSelect)을 글자 그대로 쓴다. send_config 값 범위 = 끔 표식 · 켬 표식 · 키 없음 · 문자열 · NULL.
 */
import { describe, it, expect } from 'vitest';
import { pool } from '../../config/database';
import { campaignAdTextSelect } from '../direct-send-spec';

describe('표기 칸 SELECT(실 PG)', () => {
  it('send_config.adText 가 false 일 때만 false · 그 밖은 NULL', async () => {
    const r = await pool.query(
      `SELECT x.k, ${campaignAdTextSelect('x')}
         FROM (VALUES
           ('off',    '{"adText": false, "sentTables": ["SMSQ_SEND_1"]}'::jsonb),
           ('on',     '{"adText": true}'::jsonb),
           ('none',   '{"sentTables": ["SMSQ_SEND_1"]}'::jsonb),
           ('string', '{"adText": "false"}'::jsonb),
           ('null',   NULL::jsonb)
         ) AS x(k, send_config)
        ORDER BY x.k`,
    );
    const got = Object.fromEntries(r.rows.map((row: any) => [row.k, row.ad_text]));
    // 문자열 "false" 도 ->> 로 읽으면 같은 글자다 = 끔으로 본다(쓰는 쪽은 불린 false 만 싣는다 · direct-send-spec)
    expect(got).toEqual({ off: false, on: null, none: null, string: false, null: null });
  });
});
