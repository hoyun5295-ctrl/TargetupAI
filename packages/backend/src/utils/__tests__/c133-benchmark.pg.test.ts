// replaces: none
/**
 * C133 F3 — 업종 평균 비교 · 실 PostgreSQL 판(★ 2026-11-13 · 설계서 docs/2026-11-13-hanjul-v3-design.md §4 · 대기 DDL C133-DDL-4 를 시험 안에서 얹는다)
 *   운영 문장을 글자 그대로 돌린다(표 = 운영 schema-only 덤프 사본).
 *   1. 스냅숏 = 회사별 비율(결과 확정 캠페인만 · 분모 0 · 업종 없음 · 비활성 회사는 행 없음) · 다시 돌려도 같은 행
 *   2. 읽기 = 내 값과 같은 업종 **다른 회사** 평균(자기 제외 · 큰 회사가 평균을 끌지 않는다 = 회사별 비율의 평균)
 *   3. ⛔ 다른 회사가 5곳 미만이면 평균을 싣지 않는다(자기 포함 5가 아니라 자기 제외 5)
 *   4. 시연 · 합성 데이터 회사는 평균에서 빠지지만 자기 값은 본다 · 오래된 스냅숏은 비교하지 않는다
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool, query } from '../../config/database';
import { ledgerBlockSql } from './pg/global-setup';
import { insertMinimalRow } from './pg/fixtures';
import {
  snapshotBenchmarks, readBenchmark, benchCell, benchStageOpen, benchRunDue,
  BENCH_MIN_PEERS, BENCH_READ_SQL, BENCH_STALE_DAYS, BENCH_KEEP_DAYS,
} from '../performance-benchmark';

const co = (n: number) => `00000000-0000-0000-0000-00000c1334${String(n).padStart(2, '0')}`;
const ME = co(1);
const PEERS = [2, 3, 4, 5, 6].map(co);          // 같은 업종 다섯 곳
const SYN = co(7);                               // 합성 데이터 회사(평균에서 뺀다)
const OTHER_IND = co(8);                         // 다른 업종
const NO_IND = co(9);                            // 업종 없음
const INACTIVE = co(10);                         // 정지 회사
const LONELY = co(11);                           // 업종에 혼자
const IND = 'c133-beauty';

const camp = (company: string, sent: number, success: number, extra: Record<string, unknown> = {}) =>
  insertMinimalRow(pool, 'campaigns', {
    id: randomUUID(), company_id: company, campaign_name: 't', status: 'completed', result_final: true,
    sent_count: sent, success_count: success, fail_count: sent - success, sent_at: new Date(Date.now() - 3 * 86400000).toISOString(), ...extra,
  });
const spam = async (company: string, results: Array<[string, string | null]>, status = 'completed') => {
  const id = randomUUID();
  await insertMinimalRow(pool, 'spam_filter_tests', { id, company_id: company, user_id: userOf(company), status, created_at: new Date(Date.now() - 86400000).toISOString() });
  for (const [carrier, result] of results) await insertMinimalRow(pool, 'spam_filter_test_results', { id: randomUUID(), test_id: id, carrier, message_type: 'SMS', phone: '01000000000', result });
};
/** 회사마다 검사 실행자 한 명(spam_filter_tests.user_id 외래 키) — 회사 id 의 끝 두 자리로 만든다 */
const userOf = (company: string) => company.replace('c1334', 'c1335');
const snapRows = async (company: string) =>
  (await query(`SELECT metric, value, industry_code FROM benchmark_company_daily WHERE company_id = $1::uuid ORDER BY metric`, [company])).rows;

const savedEnv: Record<string, string | undefined> = {};
beforeAll(async () => {
  for (const k of ['SYNTHETIC_DATA_COMPANY_IDS', 'V3_STAGE_BENCHMARK']) savedEnv[k] = process.env[k];
  process.env.SYNTHETIC_DATA_COMPANY_IDS = SYN;
  await pool.query(ledgerBlockSql('C133-DDL-4'));
  const mk = (id: string, industry: string | null, status = 'active') => insertMinimalRow(pool, 'companies', { id, industry_code: industry, status });
  await mk(ME, IND);
  for (const p of PEERS) await mk(p, ` ${IND} `);      // 앞뒤 공백이 있어도 같은 업종
  await mk(SYN, IND);
  await mk(OTHER_IND, 'c133-food');
  await mk(NO_IND, null);
  await mk(INACTIVE, IND, 'suspended');
  await mk(LONELY, 'c133-solo');
  for (const c of [ME, ...PEERS]) await insertMinimalRow(pool, 'users', { id: userOf(c), company_id: c, login_id: `c133b${c.slice(-2)}`, name: '담당', user_type: 'admin' });

  await camp(ME, 1000, 900);                                        // 0.90
  await camp(ME, 3000, 2950);                                       // 합쳐서 3850 / 4000 = 0.9625(캠페인별 비율의 평균 0.9417 과 다르다 = 발송 건수로 합친 값)
  await camp(ME, 500, 0, { result_final: false });                  // 결과 미확정 = 세지 않는다
  await camp(ME, 500, 0, { status: 'cancelled' });                  // 완료 아님 = 세지 않는다
  await camp(ME, 500, 0, { sent_at: new Date(Date.now() - 45 * 86400000).toISOString() });   // 창 밖
  // 다른 회사 다섯: 0.80 · 0.90 · 0.90 · 1.00 · 0.90(발송이 100만 건인 큰 회사) → 회사별 비율의 평균 = 0.90
  await camp(PEERS[0], 100, 80);
  await camp(PEERS[1], 100, 90);
  await camp(PEERS[2], 10, 9);
  await camp(PEERS[3], 10, 10);
  await camp(PEERS[4], 1_000_000, 900_000);
  await camp(SYN, 100, 10);                                         // 합성 회사 0.10 — 평균에 들면 안 된다
  await camp(OTHER_IND, 100, 50);
  await camp(NO_IND, 100, 50);
  await camp(INACTIVE, 100, 50);
  await camp(LONELY, 100, 70);
  await camp(co(2), 0, 0);                                          // 발송 0 캠페인 = 분모에 영향 없음

  await spam(ME, [['SKT', 'blocked'], ['SKT', 'pass'], ['SKT', 'pass'], ['SKT', 'pass'], ['KT', 'pass'], ['KT', 'timeout'], ['LGU', null], ['ETC', 'blocked']]);
  for (const p of PEERS) await spam(p, [['SKT', 'blocked'], ['SKT', 'pass']]);                // 0.5씩
  await spam(PEERS[0], [['KT', 'blocked']]);                                                  // KT 는 한 곳뿐
  await spam(ME, [['SKT', 'blocked']], 'active');                                             // 끝나지 않은 검사 = 세지 않는다
});

afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('스냅숏(실 PG)', () => {
  it('회사별 비율만 · 결과 확정 완료 캠페인 · 창 30일 · 업종 없는 회사 · 정지 회사는 행 없음', async () => {
    const n = await snapshotBenchmarks();
    expect(n).toBeGreaterThan(0);
    const mine = await snapRows(ME);
    expect(mine.find((r: any) => r.metric === 'success_rate')).toMatchObject({ value: 0.9625, industry_code: IND });
    expect(mine.find((r: any) => r.metric === 'spam_block:SKT').value).toBe(0.25);      // 차단 1 ÷ (정상 3 + 차단 1)
    expect(mine.find((r: any) => r.metric === 'spam_block:KT').value).toBe(0);          // 시간 초과는 분모에서 뺀다 → 정상 1
    expect(mine.some((r: any) => r.metric === 'spam_block:LGU')).toBe(false);           // 판정 대기뿐 = 분모 0 = 행 없음
    expect(mine.some((r: any) => r.metric === 'spam_block:ETC')).toBe(false);           // 모르는 통신사 표기는 싣지 않는다
    expect((await snapRows(PEERS[0]))[0].industry_code).toBe(IND);                       // 공백 정리
    expect(await snapRows(NO_IND)).toEqual([]);
    expect(await snapRows(INACTIVE)).toEqual([]);
    expect((await snapRows(SYN)).length).toBe(1);                                         // 합성 회사도 자기 행은 있다(자기 값은 본다)
  });

  it('다시 돌려도 같은 행(오늘 것을 지우고 넣는다) · 보관 기간 밖 날짜는 지운다', async () => {
    const before = await snapRows(ME);
    await query(`INSERT INTO benchmark_company_daily (day, company_id, industry_code, metric, value) VALUES (current_date - $1::int - 5, $2::uuid, 'x', 'success_rate', 0.5)`, [BENCH_KEEP_DAYS, ME]);
    await snapshotBenchmarks();
    expect(await snapRows(ME)).toEqual(before);
  });
});

describe('읽기(실 PG)', () => {
  it('내 값 · 같은 업종 다른 회사 평균 · 차이 = 회사별 비율의 산술 평균(큰 회사가 끌지 않는다) · 합성 회사 제외', async () => {
    const v = await readBenchmark(ME);
    expect(v.hasIndustry).toBe(true);
    expect(v.ready).toBe(true);
    expect(v.successRate.available).toBe(true);
    const s = v.successRate as any;
    expect(s.mine).toBeCloseTo(0.9625, 10);
    expect(s.avg).toBeCloseTo(0.9, 10);            // (0.8 + 0.9 + 0.9 + 1.0 + 0.9) / 5 · 합성 회사 0.10 은 빠짐 · 발송량 가중이면 0.9000…와 다르다
    expect(s.diff).toBeCloseTo(0.0625, 10);
    expect(Object.keys(s).sort()).toEqual(['available', 'avg', 'diff', 'mine']);   // 회사 수를 싣지 않는다
  });

  it('⛔ 다른 회사가 5곳 미만이면 평균을 싣지 않는다 — 자기 제외로 센다', async () => {
    // PEERS[0] 에게 다른 회사 = ME + PEERS 넷 = 5(합성 제외) → 보인다
    expect((await readBenchmark(PEERS[0])).successRate.available).toBe(true);
    // 한 곳을 지우면 ME 에게 다른 회사 = 4 → 안 보인다(자기를 넣어 5로 세면 보이게 된다 = 변이)
    await query(`DELETE FROM benchmark_company_daily WHERE company_id = $1::uuid`, [PEERS[4]]);
    const v = await readBenchmark(ME);
    expect(v.successRate).toEqual({ available: false, reason: 'few_peers' });
    expect(v.ready).toBe(true);
    await snapshotBenchmarks();
    expect((await readBenchmark(ME)).successRate.available).toBe(true);
    expect(BENCH_MIN_PEERS).toBe(5);
  });

  it('통신사별 스팸 검사 차단율 = 내 값이 있는 통신사만 · 지표마다 회사 수를 따로 센다', async () => {
    const v = await readBenchmark(ME);
    expect(v.spamBlock.map((c) => c.carrier)).toEqual(['SKT', 'KT']);
    const skt = v.spamBlock[0] as any;
    expect(skt).toMatchObject({ carrier: 'SKT', available: true });
    expect(skt.mine).toBeCloseTo(0.25, 10);
    expect(skt.avg).toBeCloseTo(0.5, 10);
    expect(v.spamBlock[1]).toEqual({ carrier: 'KT', available: false, reason: 'few_peers' });   // KT 는 다른 회사가 한 곳뿐
  });

  it('합성 회사는 자기 값과 실제 회사 평균을 본다 · 업종 혼자 · 업종 없음 · 다른 업종', async () => {
    const syn = await readBenchmark(SYN);
    expect((syn.successRate as any).mine).toBeCloseTo(0.1, 10);
    expect(syn.successRate.available).toBe(true);                       // 다른 회사 = ME + PEERS 다섯 = 6
    expect((await readBenchmark(LONELY)).successRate).toEqual({ available: false, reason: 'few_peers' });
    const none = await readBenchmark(NO_IND);
    expect(none).toMatchObject({ hasIndustry: false, ready: false, successRate: { available: false, reason: 'no_own' }, spamBlock: [] });
    expect((await readBenchmark(OTHER_IND)).successRate).toEqual({ available: false, reason: 'few_peers' });
  });

  it('오래된 스냅숏은 비교하지 않는다(워커가 멈춘 채 옛 평균을 보이지 않는다)', async () => {
    await query(`UPDATE benchmark_company_daily SET day = day - $1::int - 1`, [BENCH_STALE_DAYS]);
    const v = await readBenchmark(ME);
    expect(v.ready).toBe(false);
    expect(v.successRate).toEqual({ available: false, reason: 'no_own' });
    await query(`DELETE FROM benchmark_company_daily`);
    await snapshotBenchmarks();
  });

  it('읽기 문장은 자기와 뺄 회사를 평균에서 뺀다(글자 계약)', () => {
    expect(BENCH_READ_SQL).toContain('o.company_id <> $1::uuid AND NOT (o.company_id = ANY($2::uuid[]))');
    expect(BENCH_READ_SQL).toContain('o.industry_code = m.industry_code AND o.metric = m.metric');
  });
});

describe('순수 판정', () => {
  it('benchCell: 내 값 없음 · 회사 수 부족 · 평균 없음 · 정상', () => {
    expect(benchCell(null, 9, 0.5)).toEqual({ available: false, reason: 'no_own' });
    expect(benchCell(0.9, 4, 0.5)).toEqual({ available: false, reason: 'few_peers' });
    expect(benchCell(0.9, 5, null)).toEqual({ available: false, reason: 'few_peers' });
    expect(benchCell(0.9, 5, 0.5)).toEqual({ available: true, mine: 0.9, avg: 0.5, diff: 0.4 });
    expect(benchCell(0, 5, 0)).toEqual({ available: true, mine: 0, avg: 0, diff: 0 });   // 0 도 값이다
  });

  it('단계가 닫혀 있으면 스냅숏을 만들지 않는다 · 밤 계산 = KST 4시대 하루 한 번', () => {
    expect(benchStageOpen({})).toBe(false);
    expect(benchStageOpen({ V3_STAGE_BENCHMARK: ' ' })).toBe(false);
    expect(benchStageOpen({ V3_STAGE_BENCHMARK: '*' })).toBe(true);
    expect(benchStageOpen({ V3_STAGE_BENCHMARK: ME })).toBe(true);
    const at = (iso: string) => new Date(iso);
    expect(benchRunDue(at('2026-11-13T19:10:00Z'), '')).toBe(true);              // KST 11-14 04:10
    expect(benchRunDue(at('2026-11-13T19:40:00Z'), '2026-11-14')).toBe(false);   // 그날 이미 돌았다
    expect(benchRunDue(at('2026-11-13T20:10:00Z'), '')).toBe(false);             // KST 05시
  });
});
