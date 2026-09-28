/**
 * 한줄로 V2 차수 4 PERF 2묶음 (★2026-09-28 · Harold 「전부 다 해야 마무리」) — 고친 자리가 되돌아가지 않게.
 *
 *   R171 브랜드 수신거부 = 받는 번호만 DB에서(숫자만 남겨 비교 · 하이픈 섞인 저장값도 잡는다)
 *   R166 = 처방 철회(발송마다 기록 유지)
 *   R281 슈퍼관리자 발송통계 = 기간 집계 캐시 · R106 대시보드 카드 = 캐시
 *   R266 상태형 트리거(휴면·생일·포인트) = 1시간에 1번 · R265 미리보기 = 한 번의 추출
 *   m046 테스트 발송 = SQL 집계 + 최근 1,000건 목록 · R060 주소록 조회 = 서버 검색 + 상위 N건 · R213 DM 목록 = 쓰는 키만
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const calls: Array<{ sql: string; params: any[] }> = [];
let handler: (sql: string, params: any[]) => any = () => ({ rows: [] });
vi.mock('../../config/database', () => ({
  query: vi.fn(async (sql: string, params: any[] = []) => { calls.push({ sql, params }); return handler(sql, params); }),
  pool: { connect: vi.fn() },
}));

import { getUnsubscribedPhones } from '../unsubscribe-helper';

const SRC = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');

beforeEach(() => { calls.length = 0; handler = () => ({ rows: [] }); });

describe('R171 수신거부 조회(CT getUnsubscribedPhones)', () => {
  it('받는 번호를 숫자만 남겨 넘기고, 저장값도 숫자만 남겨 비교한다', async () => {
    handler = () => ({ rows: [{ phone: '01012345678' }] });
    const out = await getUnsubscribedPhones('u-1', ['010-1234-5678', '01099998888', '', '010 1234 5678']);
    expect(out).toEqual(['01012345678']);
    const c = calls[0];
    expect(c.sql).toContain("regexp_replace(phone, '\\D', '', 'g') = ANY($2::text[])");
    expect(c.params).toEqual(['u-1', ['01012345678', '01099998888']]);
  });
  it('번호가 없으면 조회하지 않는다', async () => {
    expect(await getUnsubscribedPhones('u-1', ['', '---'])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
  it('브랜드 발송은 계정 수신거부 전량을 읽지 않고 CT를 쓴다', () => {
    const src = read('utils/brand-message.ts');
    const fn = src.slice(src.indexOf('async function filterUnsubscribed('), src.indexOf('export async function resolveBrandCallback('));
    expect(fn).toContain('await getUnsubscribedPhones(userId, normalized)');
    expect(fn).not.toContain('SELECT phone FROM unsubscribes WHERE user_id = $1`');
  });
});

describe('R166 처방 철회(Codex medium 2 · 순차 실행기라 경합 없음 · 모아 쓰면 누락·이중 가산)', () => {
  it('실행기는 발송마다 변이 발송 수를 바로 기록한다(모아 쓰기 없음)', () => {
    const src = read('utils/journey-executor.ts');
    expect(src).toContain('await recordJourneyStepVariantReward(activeVariantId, 1, 0, 0);');
    expect(src).not.toContain('queueVariantSent');
    expect(read('utils/bandit-optimizer.ts')).not.toContain('flushVariantSent');
  });
});

describe('R281 · R106 캐시', () => {
  it('슈퍼관리자 발송통계 = 기간 집계를 캐시 CT로(신선도 최대 1분)', () => {
    const src = read('routes/admin.ts');
    expect(src).toContain('key: `admin:stats-send:${JSON.stringify([view, startDate, endDate, companyId])}`');
    expect(src).toMatch(/softTtlSec: 30,\s*hardTtlSec: 60,/);
    expect(src).toContain('const pagedRows = allRows.slice(offset, offset + limit);');
  });
  it('대시보드 카드 = 회사·사용자 범위·카드 목록 키로 캐시', () => {
    const src = read('routes/companies.ts');
    expect(src).toContain('key: `dashboard-cards:${companyId}:${cardScope}:${cardIds.join(\',\')}`');
    expect(src).toContain('compute: () => aggregateDashboardCards(companyId, cardIds, userId, userType),');
  });
});

describe('R266 · R265 여정', () => {
  it('상태형 트리거만 1시간에 1번 · 실패하면 기록하지 않는다', () => {
    const src = read('utils/journey-trigger-watcher.ts');
    expect(src).toContain("export const STATE_TRIGGER_EVENTS = new Set(['customer.dormant', 'customer.birthday_approaching', 'customer.points_expiring']);");
    expect(src).toContain('export const STATE_TRIGGER_INTERVAL_MS = 60 * 60 * 1000;');
    expect(src).toContain('const isStateTrigger = STATE_TRIGGER_EVENTS.has(j.trigger_event);');
    expect(src).toContain('if (isStateTrigger && Date.now() - (_stateTriggerRanAt.get(j.id) || 0) < STATE_TRIGGER_INTERVAL_MS) continue;');
    expect(src).toContain('if (isStateTrigger && !result.paused) _stateTriggerRanAt.set(j.id, Date.now());');
    expect(src).toContain('return { matched: ids.length, enqueued: 0, skipped: ids.length, paused: true };');
    expect(src).toContain('for (const id of Array.from(_stateTriggerRanAt.keys())) if (!activeIds.has(id)) _stateTriggerRanAt.delete(id);');
  });
  it('미리보기는 한 번의 추출로 표본과 인원을 만든다', () => {
    const ai = read('routes/ai.ts');
    expect((ai.match(/await previewJourneyTargets\(/g) || []).length).toBe(2);
    expect(ai).not.toContain('await buildJourneyPreviewSamples(');
    const ex = read('utils/journey-target-extractor.ts');
    const fn = ex.slice(ex.indexOf('export async function previewJourneyTargets('), ex.indexOf('/** 전체 매칭 수 + 등급 분포'));
    expect((fn.match(/selectJourneyTargetCustomerIds\(/g) || []).length).toBe(1);
    expect(fn).toContain('ids.slice(0, sampleLimit)');
  });
});

describe('m046 · R060 · R213 목록', () => {
  it('테스트 발송 = SQL 집계 + 최근 1,000건 · 화면은 서버 건수를 쓴다', () => {
    const camp = read('routes/campaigns.ts');
    expect(camp).toContain('const TEST_LIST_LIMIT = 1000;');
    expect(camp).toContain("testWhere, queryParams, 'sendreq_time DESC, seqno DESC', TEST_LIST_LIMIT, 0)");
    expect(camp).toContain('listCapped: aggTotal > list.length,');
    const fe = readFileSync(join(SRC, '..', '..', 'frontend', 'src', 'components', 'ResultsModal.tsx'), 'utf8');
    expect(fe).toContain('{managerTestTotal ?? (testList || []).length}');
  });
  it('주소록 조회 = limit 이 있으면 서버 검색 + 상위 N건 + 전체 건수 · 불러오기는 전부', () => {
    const src = read('routes/address-books.ts');
    expect(src).toContain('COUNT(*) OVER() AS total_count_all');
    expect(src).toContain("regexp_replace(phone, '\\\\D', '', 'g') LIKE");
    expect(src).toMatch(/const result = await query\(\s*`SELECT id, phone, name, extra1, extra2, extra3\s*FROM address_books\s*WHERE company_id = \$1 AND group_name = \$2\$\{userFilter\}\s*ORDER BY created_at`/);
  });
  it('DM 목록 = brand_kit·settings 는 쓰는 키만', () => {
    const src = read('utils/dm/dm-builder.ts');
    expect((src.match(/jsonb_build_object\('primary_color', brand_kit->'primary_color'\) AS brand_kit/g) || []).length).toBe(2);
    expect((src.match(/jsonb_build_object\('catalog', settings->'catalog'\) AS settings/g) || []).length).toBe(2);
  });
});

describe('R206 고객 적재 = 바뀐 행만 · 적재는 활동이 아니다(Harold 승인)', () => {
  it('skipUnchanged 이면 새 값 묶음이 옛 값과 다를 때만 UPDATE 한다 · 끄면 조건이 없다', async () => {
    const { createCustomerUpsertBuilder } = await import('../customer-upsert');
    const on = createCustomerUpsertBuilder({ source: 'sync', includeUploadedBy: false, skipUnchanged: true }).buildBatch('c-1', [{ phone: '01012345678' }]).sql;
    expect(on).toMatch(/WHERE ROW\(COALESCE\(EXCLUDED\.[a-z_]+, customers\.[a-z_]+\)[\s\S]*\) IS DISTINCT FROM ROW\(customers\.[a-z_]+[\s\S]*\)/);
    const off = createCustomerUpsertBuilder({ source: 'upload', includeUploadedBy: true }).buildBatch('c-1', [{ phone: '01012345678' }], 'u-1').sql;
    expect(off).not.toContain('IS DISTINCT FROM');
  });
  it('기존 행의 마지막 활동 시각을 적재가 다시 쓰지 않는다(신규 행 첫 값은 그대로)', async () => {
    const { createCustomerUpsertBuilder } = await import('../customer-upsert');
    for (const source of ['sync', 'upload', 'manual'] as const) {
      const sql = createCustomerUpsertBuilder({ source, includeUploadedBy: source === 'upload' }).buildBatch('c-1', [{ phone: '010' }], 'u').sql;
      const setPart = sql.slice(sql.indexOf('DO UPDATE SET'));
      expect(setPart, source).not.toContain('last_activity_at');
      expect(sql, source).toContain('last_activity_at');   // INSERT 칸에는 남는다
    }
  });
  it('싱크만 켠다 · 건수는 처리한 행 수(반환 행 수가 아니다)', () => {
    const src = read('routes/sync.ts');
    expect(src).toMatch(/source: 'sync',\s*includeUploadedBy: false,[\s\S]{0,300}skipUnchanged: true,/);
    expect(src).toContain('upsertedCount += chunk.length;');
  });
});
