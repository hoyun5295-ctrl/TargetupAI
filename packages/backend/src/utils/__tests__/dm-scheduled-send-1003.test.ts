/**
 * 모바일 DM 예약 발송이 목록·상세에서 「보냄」으로 보이고 보낸 기록 시각이 예약 시각과 다르다 (★2026-10-03 남지현 접수 `cmuqkleh90bsyjnn4g4bkrusa`)
 *
 * 옛: DM 쪽 「보냄」의 근거는 실제 발송이 아니라 발행·수신자 링크 토큰 발급이었다. 예약이어도 그 자리에서 발행·발급하고
 *   토큰과 발송 캠페인을 잇는 칸이 없어 예약 여부·예약 시각·취소를 알 수 없었다. 보낸 기록 시각은 토큰 발급 시각이고,
 *   화면이 UTC 시각 글자를 앞 16자로 잘라(끝의 Z 가 떨어짐) 지역 시각으로 다시 읽어 9시간 이른 시각(06:00)이 보였다.
 * 처방: 토큰에 campaign_id(새 칸 · 배포 뒤 DDL · 없으면 종전 동작) · 상태 = 발송결과 「예약내역」과 같은 기준(campaigns.status)
 *   · 시각 = 예약 시각 → 실제 발송 시각 → 발급 시각 · 화면은 전체 시각을 한국 시각으로 그린다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

const calls: Array<{ sql: string; params: any[] }> = [];
let columnRows: any[] = [];
let columnFail = false;
vi.mock('../../config/database', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    query: vi.fn(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('information_schema.columns')) {
        if (columnFail) throw new Error('boom');
        return { rows: columnRows, rowCount: columnRows.length };
      }
      return { rows: [], rowCount: 3 };
    }),
  };
});

import {
  attachDmTokensToCampaign, hasDmTokenCampaignColumn, resetDmTokenCampaignColumnCacheForTest,
  DM_TOKEN_SEND_STATE_SQL, DM_TOKEN_SENT_AT_SQL, DM_TOKEN_CAMPAIGN_JOIN_SQL,
} from '../dm/dm-recipient-token';
import { classifyDmRecipientSegments } from '../dm/dm-tracking';

const back = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');
const FRONT = resolve(__dirname, '../../../../frontend/src');
const front = (rel: string) => readFileSync(join(FRONT, rel), 'utf8');

beforeEach(() => { calls.length = 0; columnRows = []; columnFail = false; resetDmTokenCampaignColumnCacheForTest(); });

describe('토큰 ↔ 발송 캠페인 연결', () => {
  it('칸이 없으면(DDL 전) 아무것도 쓰지 않는다 = 종전 동작', async () => {
    const n = await attachDmTokensToCampaign('dm1', 'co1', ['t1', 't2'], 'camp1');
    expect(n).toBe(0);
    expect(calls.some((c) => c.sql.includes('UPDATE dm_recipient_tokens'))).toBe(false);
  });

  it('칸이 있으면 이번 발송의 토큰에만 · 아직 비어 있는 행에만 캠페인을 적는다', async () => {
    columnRows = [{ '?column?': 1 }];
    const n = await attachDmTokensToCampaign('dm1', 'co1', ['t1', 't2'], 'camp1');
    expect(n).toBe(3);
    const up = calls.find((c) => c.sql.includes('UPDATE dm_recipient_tokens'))!;
    expect(up.sql).toContain('SET campaign_id = $4::uuid');
    expect(up.sql).toContain('token = ANY($3::text[])');
    expect(up.sql).toContain('campaign_id IS NULL');
    expect(up.params).toEqual(['dm1', 'co1', ['t1', 't2'], 'camp1']);
  });

  it('칸 확인이 실패하면 없다고 보고 캐시하지 않는다(다음 호출이 다시 확인)', async () => {
    columnFail = true;
    expect(await hasDmTokenCampaignColumn()).toBe(false);
    columnFail = false;
    columnRows = [{ '?column?': 1 }];
    expect(await hasDmTokenCampaignColumn()).toBe(true);
  });

  it('토큰·캠페인이 비면 조회조차 하지 않는다', async () => {
    expect(await attachDmTokensToCampaign('dm1', 'co1', [], 'camp1')).toBe(0);
    expect(await attachDmTokensToCampaign('dm1', 'co1', ['t1'], '')).toBe(0);
    expect(calls.length).toBe(0);
  });
});

describe('상태·시각 SQL 조각(한 곳 소유)', () => {
  it('상태 = 발송결과 「예약내역」과 같은 기준(campaigns.status) · 캠페인을 모르면 보냄', () => {
    expect(DM_TOKEN_SEND_STATE_SQL).toBe(
      "CASE WHEN cp.status = 'scheduled' THEN 'scheduled' WHEN cp.status = 'cancelled' THEN 'cancelled' WHEN cp.status = 'failed' THEN 'failed' ELSE 'sent' END",
    );
  });
  it('시각 = 예약 시각 → 실제 발송 시각 → 발급 시각', () => {
    expect(DM_TOKEN_SENT_AT_SQL).toBe('COALESCE(cp.scheduled_at, cp.sent_at, t.created_at)');
  });
  it('캠페인은 같은 회사 것만 붙인다', () => {
    expect(DM_TOKEN_CAMPAIGN_JOIN_SQL).toBe('LEFT JOIN campaigns cp ON cp.id = t.campaign_id AND cp.company_id = t.company_id');
  });
});

describe('다시 보내기 대상(세그먼트)은 실제로 받은 사람만', () => {
  it('예약·취소·실패 수신자는 「안 본 사람」에 들지 않는다 · 상태가 없는 옛 행은 받은 것으로 본다', () => {
    const seg = classifyDmRecipientSegments([
      { customer_id: 'a', send_state: 'sent' },
      { customer_id: 'b', send_state: 'scheduled' },
      { customer_id: 'c', send_state: 'cancelled' },
      { customer_id: 'd', send_state: 'failed' },
      { customer_id: 'e' },
    ]);
    expect(seg.unviewed).toEqual(['a', 'e']);
  });
});

describe('배선', () => {
  const builder = back('utils/dm/dm-builder.ts');
  const route = back('routes/dm.ts');

  it('발송 접수 뒤 이번 토큰을 캠페인에 잇는다', () => {
    const s = route.slice(route.indexOf("dmRouter.post('/:id/send-to-target'"), route.indexOf("dmRouter.get('/:id/recipients-tracking'"));
    const at = s.indexOf('campaignId = result.campaignId;');
    const attach = s.indexOf('await attachDmTokensToCampaign(dm.id, companyId, tokenPairs.map((p) => p.token), campaignId);');
    expect(at).toBeGreaterThan(0);
    expect(attach).toBeGreaterThan(at);
  });

  it('수신자 조회는 칸이 있을 때만 캠페인을 붙이고 · 받은 토큰을 먼저 고른다', () => {
    const fn = builder.slice(builder.indexOf('export async function getDmRecipientEngagementRows('), builder.indexOf('export async function trackDmView('));
    expect(fn).toContain('await hasDmTokenCampaignColumn()');
    expect(fn).toContain('${DM_TOKEN_SEND_STATE_SQL} AS send_state');
    expect(fn).toContain('${DM_TOKEN_SENT_AT_SQL} AS sent_at');
    expect(fn).toContain("(${DM_TOKEN_SEND_STATE_SQL}) = 'sent' DESC");
    expect(fn).toContain("'sent' AS send_state, t.created_at AS sent_at");
  });

  it('추적 응답: 보냄 = 실제로 받은 사람 · 예약 수 따로 · 보낸 기록 묶음은 서버가 만든다', () => {
    const r = route.slice(route.indexOf("dmRouter.get('/:id/recipients-tracking'"), route.indexOf("dmRouter.get('/:id/recipient-detail'"));
    expect(r).toContain("sendState: row.send_state || 'sent',");
    expect(r).toContain("sent: recipients.filter((x) => x.sendState === 'sent').length,");
    expect(r).toContain("scheduled: recipients.filter((x) => x.sendState === 'scheduled').length,");
    expect(r).toContain('batches = await getDmSendBatches(req.params.id, companyId);');
  });

  it('목록은 다가오는 예약 시각을 내려준다(목록 칩 「예약」)', () => {
    const fn = builder.slice(builder.indexOf('export async function getDmList('), builder.indexOf('export async function cloneDm(') > 0 ? builder.indexOf('export async function cloneDm(') : undefined);
    expect(fn).toContain('scheduled_at: row.scheduled_at || null,');
    expect(fn).toContain("cp.status = 'scheduled'");
  });
});

describe('화면', () => {
  it('상세 창: 시각을 잘라 쓰지 않고 한국 시각으로 그린다 · 서버 묶음을 쓴다 · 예약 표기', () => {
    const m = front('components/make/DmDetailModal.tsx');
    expect(m).not.toContain('.slice(0, 16)');
    expect(m).toContain('formatKstMonthDayTime(');
    expect(m).toContain('track?.batches');
    expect(m).toContain('(예약)');
    expect(m).toContain('(예약 취소)');
  });

  it('한국 시각 포맷은 공용 파일에 있다', () => {
    const f = front('utils/formatDate.ts');
    expect(f).toContain('export function formatKstMonthDayTime(');
    expect(f).toMatch(/formatKstMonthDayTime[\s\S]*timeZone: 'Asia\/Seoul'/);
  });

  it('내 DM 거름 칩에 「예약」이 있다', () => {
    const p = front('pages/DmBuilderPage.tsx');
    expect(p).toContain("{ key: 'scheduled' as const, label: '예약', count: cnt.scheduled || 0 },");
  });
});
