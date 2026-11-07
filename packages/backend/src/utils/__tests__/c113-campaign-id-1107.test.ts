/**
 * C113 8R · §2-H ② — 관문 길은 캠페인 id 를 INSERT 전에 만들어 잠금을 먼저 잡고 그 id 로 넣는다.
 *   withCampaignId = 그 자리의 옛 INSERT 문장에 id 칸만 덧붙임(옛 길 = 옛 문장 그대로).
 */
import { describe, it, expect } from 'vitest';
import { CAMPAIGN_INSERT_SQL, withCampaignId } from '../direct-send-spec';

const ID = '11111111-2222-4333-8444-555555555555';

describe('withCampaignId', () => {
  it('공용 입구 문장: id 칸이 맨 앞 칸 · 값 = 맨 뒤 번호 하나 더($20) · 나머지 칸 · 번호 그대로', () => {
    const params = Array.from({ length: 19 }, (_, i) => `p${i + 1}`);
    const out = withCampaignId(CAMPAIGN_INSERT_SQL, params, ID);
    expect(out.sql.startsWith('INSERT INTO campaigns (id, company_id, campaign_name,')).toBe(true);
    expect(out.sql).toContain("VALUES ($20::uuid, $1, $2, $3, $4, $5, $6, $7, $19, $8,");
    expect(out.sql).toContain('RETURNING id');
    expect(out.params).toHaveLength(20);
    expect(out.params[19]).toBe(ID);
    expect(out.params.slice(0, 19)).toEqual(params);
    expect(CAMPAIGN_INSERT_SQL.startsWith('INSERT INTO campaigns (company_id,')).toBe(true);   // 옛 문장은 그대로
  });
  it('직접 동기 꼴(뒤에 덧붙인 $22): 값 = $23', () => {
    const sql = 'INSERT INTO campaigns (company_id, campaign_name, created_at)\n       VALUES ($1, $22, NOW())\n       RETURNING id';
    const out = withCampaignId(sql, Array.from({ length: 22 }, () => 'x'), ID);
    expect(out.sql).toBe('INSERT INTO campaigns (id, company_id, campaign_name, created_at)\n       VALUES ($23::uuid, $1, $22, NOW())\n       RETURNING id');
  });
  it('INSERT · VALUES 가 하나가 아니면 던진다', () => {
    expect(() => withCampaignId('INSERT INTO campaigns (a) VALUES (1); INSERT INTO campaigns (b) VALUES (2)', [], ID)).toThrow();
    expect(() => withCampaignId('UPDATE campaigns SET a = 1', [], ID)).toThrow();
  });
});
