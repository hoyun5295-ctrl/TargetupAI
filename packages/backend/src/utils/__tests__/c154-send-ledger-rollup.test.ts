/**
 * C154 발송 원장 굴리기 — 순수 · 계약 시험(★ 2026-11-22 · 설계서 docs/2026-11-22-c154-send-ledger-rollup-design.md §5)
 *   기대값 = 설계서의 표 · 손으로 센 예(코드가 세는 방식으로 다시 세지 않는다).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { carrierKey, carrierNet, carrierNetSql, CARRIER_KEYS, SUCCESS_CODES, PENDING_CODES } from '../sms-result-map';
import {
  newTally, tallyRows, carrierSendRates, foldGroupPerformance,
  CARRIER_MIN_SENT, GROUP_PERF_MIN_N, CLOSE_AFTER_DAYS, ATTRIBUTION_DAYS, SKIP_AFTER_DAYS, CELLS_ROLL_WITHIN_DAYS,
} from '../send-ledger-rollup';
import { askCellSql, askCellOfSql } from '../ask-segments';
import { V3_FEATURES, V3_STAGE_ENV, V3_PLAN_KEY, v3StageOpen, v3StageScope } from '../v3-stage';
import { sendBenchCells, sendBenchFootnote, spamBenchCells, type BenchmarkView } from '../../../../frontend/src/utils/benchmark';
import { readGroupPerf, perWonText, perWonBar, groupPerfEmpty, perWonByGroup } from '../../../../frontend/src/utils/group-performance';

describe('K1 통신사 키 — 저장 여덟 · 띠 세 줄(설계서 D4)', () => {
  it('큐 표의 통신사 값마다 키가 정해진다', () => {
    const table: Array<[string | null | undefined, string]> = [
      ['11', 'SKT'], ['SKT', 'SKT'], ['12', 'SKT_MVNO'],
      ['16', 'KT'], ['KTF', 'KT'], ['17', 'KT_MVNO'],
      ['19', 'LGU'], ['LGT', 'LGU'], ['20', 'LGU_MVNO'],
      ['', 'unknown'], [null, 'unknown'], [undefined, 'unknown'], ['  ', 'unknown'],
      ['99', 'etc'], ['XYZ', 'etc'],
    ];
    for (const [raw, key] of table) expect(carrierKey(raw)).toBe(key);
  });
  it('저장 키 = 여덟 개', () => {
    expect([...CARRIER_KEYS].sort()).toEqual(['KT', 'KT_MVNO', 'LGU', 'LGU_MVNO', 'SKT', 'SKT_MVNO', 'etc', 'unknown']);
  });
  it('띠 = 알뜰폰을 그 망의 통신사에 더한다 · 그 밖 · 미상은 망이 없다', () => {
    expect(carrierNet('SKT')).toBe('SKT');
    expect(carrierNet('SKT_MVNO')).toBe('SKT');
    expect(carrierNet('KT_MVNO')).toBe('KT');
    expect(carrierNet('LGU_MVNO')).toBe('LGU');
    expect(carrierNet('etc')).toBeNull();
    expect(carrierNet('unknown')).toBeNull();
  });
});

describe('K2 칸 식 한 곳 — 기준 날짜 · 마지막 구매일 · 구매 횟수를 받는 꼴(설계서 S4)', () => {
  // 고치기 전(배포본)의 askCellSql('c') 가 내던 글자 그대로 — 한 줄로 묻기의 세기 · 명단이 쓰는 SQL 이 바뀌지 않는다
  const NOW_CELL = "(CASE WHEN c.recent_purchase_date IS NULL THEN 'nobuy' ELSE 'r' || (CASE WHEN (((NOW() AT TIME ZONE 'Asia/Seoul')::date - 0) - c.recent_purchase_date) <= 30 THEN 0 WHEN (((NOW() AT TIME ZONE 'Asia/Seoul')::date - 0) - c.recent_purchase_date) <= 90 THEN 1 WHEN (((NOW() AT TIME ZONE 'Asia/Seoul')::date - 0) - c.recent_purchase_date) <= 180 THEN 2 WHEN (((NOW() AT TIME ZONE 'Asia/Seoul')::date - 0) - c.recent_purchase_date) <= 365 THEN 3 ELSE 4 END)::text || 'c' || (CASE WHEN COALESCE(c.purchase_count, 0) <= 1 THEN 0 WHEN c.purchase_count <= 3 THEN 1 ELSE 2 END)::text END)";
  it('지금 쓰임(askCellSql) = 고치기 전 글자 그대로', () => {
    expect(askCellSql('c')).toBe(NOW_CELL);
  });
  it('세 식을 받는 꼴 = 같은 틀에 식만 바뀐다(발송 시점의 칸을 되짚을 때 쓴다)', () => {
    expect(askCellOfSql('$3::date', 'x.d', 'x.n')).toBe(
      "(CASE WHEN x.d IS NULL THEN 'nobuy' ELSE 'r' || (CASE WHEN ($3::date - x.d) <= 30 THEN 0 WHEN ($3::date - x.d) <= 90 THEN 1 WHEN ($3::date - x.d) <= 180 THEN 2 WHEN ($3::date - x.d) <= 365 THEN 3 ELSE 4 END)::text || 'c' || (CASE WHEN COALESCE(x.n, 0) <= 1 THEN 0 WHEN x.n <= 3 THEN 1 ELSE 2 END)::text END)",
    );
  });
});

describe('K3 단계 스위치 — 굴리기(설계서 D2)', () => {
  const CO = '11111111-1111-4111-8111-111111111111';
  it('기능 rollup = ENV V3_STAGE_ROLLUP · 요금제 키 ai_premium', () => {
    expect(V3_FEATURES).toContain('rollup');
    expect(V3_STAGE_ENV.rollup).toBe('V3_STAGE_ROLLUP');
    expect(V3_PLAN_KEY.rollup).toBe('ai_premium');
  });
  it('ENV 가 비면 닫힘 · 회사 id 가 있으면 그 회사만 · 요금제가 먼저', () => {
    expect(v3StageOpen('rollup', CO, true, {})).toBe(false);
    expect(v3StageOpen('rollup', CO, true, { V3_STAGE_ROLLUP: CO })).toBe(true);
    expect(v3StageOpen('rollup', CO, true, { V3_STAGE_ROLLUP: '22222222-2222-4222-8222-222222222222' })).toBe(false);
    expect(v3StageOpen('rollup', CO, false, { V3_STAGE_ROLLUP: '*' })).toBe(false);
    expect(v3StageScope('rollup', {})).toEqual({ all: false, ids: [] });
    expect(v3StageScope('rollup', { V3_STAGE_ROLLUP: '*' })).toEqual({ all: true, ids: [] });
  });
});

describe('K4 낱행 세기 — 성공 · 실패 · 대기 · 통신사 · 받은 번호(설계서 S2 · S3 · D3 · D7)', () => {
  const OK = SUCCESS_CODES[0];
  const WAIT = PENDING_CODES[0];
  const FAILED = 3999;   // 성공 · 대기 어느 표에도 없는 코드 = 실패
  it('손으로 센 예 — 성공 4(SKT 2 · SKT 알뜰 1 · KT 1) · 실패 3(SKT 1 · 미상 2) · 대기 1', () => {
    expect([...SUCCESS_CODES, ...PENDING_CODES]).not.toContain(FAILED);
    const t = newTally();
    tallyRows(t, [
      { seqno: 1, dest_no: '01000000001', status_code: OK, mob_company: '11' },
      { seqno: 2, dest_no: '010-0000-0002', status_code: OK, mob_company: 'SKT' },
      { seqno: 3, dest_no: '01000000003', status_code: OK, mob_company: '12' },
      { seqno: 4, dest_no: '01000000004', status_code: OK, mob_company: '16' },
    ]);
    tallyRows(t, [
      { seqno: 5, dest_no: '01000000005', status_code: FAILED, mob_company: '11' },
      { seqno: 6, dest_no: '01000000006', status_code: FAILED, mob_company: '' },
      { seqno: 7, dest_no: '01000000007', status_code: FAILED, mob_company: null },
      { seqno: 8, dest_no: '01000000008', status_code: WAIT, mob_company: null },
    ]);
    expect({ success: t.success, fail: t.fail, pending: t.pending, rows: t.rows }).toEqual({ success: 4, fail: 3, pending: 1, rows: 8 });
    expect(t.carriers.get('SKT')).toEqual({ success: 2, fail: 1 });
    expect(t.carriers.get('SKT_MVNO')).toEqual({ success: 1, fail: 0 });
    expect(t.carriers.get('KT')).toEqual({ success: 1, fail: 0 });
    expect(t.carriers.get('unknown')).toEqual({ success: 0, fail: 2 });
    // 받은 번호 = 성공 건만 · 숫자만 남긴 값
    expect([...t.phones.keys()].sort()).toEqual(['01000000001', '01000000002', '01000000003', '01000000004']);
  });
  it('같은 번호에 두 건 성공 = 건수 2(비용은 성공 건수로 센다)', () => {
    const t = newTally();
    tallyRows(t, [
      { seqno: 1, dest_no: '01000000001', status_code: OK, mob_company: '19' },
      { seqno: 2, dest_no: '01000000001', status_code: OK, mob_company: '19' },
      { seqno: 3, dest_no: '01000000001', status_code: FAILED, mob_company: '19' },
    ]);
    expect(t.phones.get('01000000001')).toBe(2);
    expect(t.carriers.get('LGU')).toEqual({ success: 2, fail: 1 });
  });
});

describe('K5 통신사별 발송 성공률 — 통신사가 남은 행만 · 알뜰폰은 그 망에(설계서 D3 · D4)', () => {
  it('성공 ÷ (성공 + 실패) · 미상 실패는 따로 세고 분모에 넣지 않는다 · 그 밖도 띠에 없다', () => {
    const out = carrierSendRates([
      { carrier: 'SKT', success: 60, fail: 20 }, { carrier: 'SKT_MVNO', success: 15, fail: 5 },   // 75 ÷ 100
      { carrier: 'unknown', success: 0, fail: 40 }, { carrier: 'etc', success: 500, fail: 500 },
    ]);
    expect(out).toEqual({ rates: [{ carrier: 'SKT', rate: 0.75 }], unknownFail: 40 });
  });
  it('건수가 모자란 통신사(성공 + 실패 100 미만) · 줄이 없는 통신사는 싣지 않는다 · 빈 입력 = 빈 띠', () => {
    expect(CARRIER_MIN_SENT).toBe(100);
    expect(carrierSendRates([{ carrier: 'KT', success: 99, fail: 0 }, { carrier: 'LGU', success: 0, fail: 100 }]))
      .toEqual({ rates: [{ carrier: 'LGU', rate: 0 }], unknownFail: 0 });
    expect(carrierSendRates([])).toEqual({ rates: [], unknownFail: 0 });
  });
  it('SQL 접기 = 같은 표(여덟 키 → 세 망 · 그 밖 · 미상은 NULL)', () => {
    expect(carrierNetSql('k.carrier')).toBe(
      "(CASE WHEN k.carrier IN ('SKT', 'SKT_MVNO') THEN 'SKT' WHEN k.carrier IN ('KT', 'KT_MVNO') THEN 'KT' WHEN k.carrier IN ('LGU', 'LGU_MVNO') THEN 'LGU' END)");
    for (const k of CARRIER_KEYS) expect(carrierNetSql('x').includes(`'${k}'`)).toBe(carrierNet(k) !== null);
  });
});

describe('K6 고객 묶음별 성과 — 칸을 묶음으로 · 1원당 매출(설계서 S6)', () => {
  it('묶음 일곱 줄(화면 순서) · 정하지 못한 칸은 따로 · 받은 고객 30 미만 = 숫자 없음 · 비용 0 = 1원당 매출 없음', () => {
    expect(GROUP_PERF_MIN_N).toBe(30);
    const out = foldGroupPerformance([
      { cell: 'r3c2', recipients: 20, buyers: 2, revenue: 60000, cost: 600 },
      { cell: 'r4c2', recipients: 10, buyers: 1, revenue: 30000, cost: 300 },     // 떠나는 단골 = 30 · 3 · 90,000 · 900 → 100
      { cell: 'r1c0', recipients: 29, buyers: 9, revenue: 99999, cost: 870 },     // 다음 구매 차례 = 29 → 숫자 없음
      { cell: 'nobuy', recipients: 50, buyers: 0, revenue: 0, cost: 0 },          // 비용 0 → 1원당 매출 없음
      { cell: 'unknown', recipients: 7, buyers: 3, revenue: 5000, cost: 210 },
      { cell: 'zz', recipients: 2, buyers: 0, revenue: 0, cost: 60 },             // 표에 없는 칸 = 정하지 못함
    ]);
    expect(out.unknown).toBe(9);
    expect(out.groups.map((g) => g.group)).toEqual(['leave', 'rest', 'fade', 'next', 'loyal', 'new', 'nobuy']);
    expect(out.groups[0]).toEqual({ group: 'leave', name: '떠나는 단골', desc: '네 번 이상 사고 반년 넘게 안 오신 분', recipients: 30, buyers: 3, revenue: 90000, cost: 900, perWon: 100 });
    expect(out.groups[3]).toEqual({ group: 'next', name: '다음 구매 차례', desc: '한 번 사고 1~3달이 지난 분', recipients: 29, buyers: null, revenue: null, cost: null, perWon: null });
    expect(out.groups[6]).toEqual({ group: 'nobuy', name: '구매 기록 없음', desc: '구매 기록이 아직 올라오지 않은 분', recipients: 50, buyers: 0, revenue: 0, cost: 0, perWon: null });
    expect(out.groups[1]).toEqual({ group: 'rest', name: '오래 쉰 고객', desc: '세 번까지 사고 반년 넘게 안 오신 분', recipients: 0, buyers: null, revenue: null, cost: null, perWon: null });
  });
});

// ── 계약(소스) ──

const src = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
/** 주석을 지운 소스(판정 자리만 본다) */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('K7 계약 — 일꾼 · 주소 · 큐 표 SQL 의 자리(설계서 §5 계약)', () => {
  const roll = code(src('utils/send-ledger-rollup.ts'));

  it('날짜 상수 = 설계서 값(귀속 7일 · 닫기 10일 · 굳히기 14일 · 낱행은 발송 3일 안)', () => {
    expect([ATTRIBUTION_DAYS, CLOSE_AFTER_DAYS, SKIP_AFTER_DAYS, CELLS_ROLL_WITHIN_DAYS]).toEqual([7, 10, 14, 3]);
  });

  it('일꾼 한 회차: 굳히기 → 닫기 → 정리가 단계 판정 앞 · 단계가 닫히면(열린 회사 0) 낱행 읽기에 닿지 않는다', () => {
    const tick = roll.slice(roll.indexOf('export async function runRollupTick('), roll.indexOf('const WORKER_INTERVAL_MS'));
    const at = (needle: string) => { const i = tick.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i; };
    expect(at('await skipStale()')).toBeLessThan(at('await closeDue()'));
    expect(at('await closeDue()')).toBeLessThan(at('await pruneRollup()'));
    expect(at('await pruneRollup()')).toBeLessThan(at('rollupLiveCompanyIds'));
    expect(at('if (ids.length === 0) return out;')).toBeLessThan(at('pickRollCandidates('));
    expect(at('pickRollCandidates(')).toBeLessThan(at('await read(c, '));
    // ★ 구현 Codex 1R — 읽기 예산이 쪽 읽기까지 내려간다: 첫 캠페인만 캠페인 한 건 상한 · 그 뒤는 회차 예산 · 시간이 모자란 것은 실패 시도가 아니다
    expect(tick).toContain('await read(c, wasFirst ? Date.now() + ROLL_CAMPAIGN_MAX_MS : tickUntil)');
    expect(at('if (e instanceof RollBudgetExceeded && !wasFirst) break;')).toBeLessThan(at('await failRoll(c)'));
    const reader = roll.slice(roll.indexOf('export async function readCampaignTally('), roll.indexOf('export async function failRoll('));
    expect(reader.indexOf('if (Date.now() > until) throw new RollBudgetExceeded();')).toBeGreaterThan(-1);
    expect(reader.lastIndexOf('if (Date.now() > until) throw new RollBudgetExceeded();')).toBeLessThan(reader.indexOf('await readRows(table, c.id, after, ROLL_PAGE, expiredOnly)'));
    // ★ 구현 Codex 2R — 표 목록 조회도 읽기 예산 안에서만 기다린다(상한 없는 풀 대기가 회차를 붙잡지 않는다)
    expect(reader).toContain('classifyResultTables(await withinBudget(tablesOf(c), until))');
    expect(reader).not.toContain('await tablesOf(c)');
    expect(tick).toContain('pickRollCandidates({ all: false, ids })');     // 고르는 범위 = 다시 판정한 회사들(명단 그대로가 아니다)
  });

  it('큐 표(SMSQ_SEND)에 거는 SQL 은 이 모듈에 없다 — 낱행은 CT-04 함수로만 읽는다', () => {
    expect(roll).not.toMatch(/SMSQ_SEND|mysqlQuery|withBoundedMysql/);
    expect(roll).toContain('smsCampaignRowsAfter');
    const q = code(src('utils/sms-queue.ts'));
    const fn = q.slice(q.indexOf('export function smsCampaignRowsSql('), q.indexOf('export async function smsExecAll('));
    expect(fn).toContain('const sql = smsCampaignRowsSql(table, limit, expiredOnly);');   // 읽기 = 그 문장 그대로(켜기 전 서버 확인이 EXPLAIN 하는 것과 같은 문장)
    expect(fn).toContain('WHERE app_etc1 = ? AND seqno > ?');              // 조건 맨 앞 = 캠페인(R94)
    expect(fn).toContain('ORDER BY seqno LIMIT');
    expect(fn).not.toMatch(/OFFSET/i);
    // 만료 실패 조건 = 캠페인 합계 CT 와 같은 뜻(성공 · 대기가 아니고 통신사 전송 시각이 빈 행)
    expect(fn).toContain("const expired = expiredOnly ? ` AND ${CAMPAIGN_EXPIRED_ROWS_WHERE}` : '';");
  });

  it('읽기 둘은 어긋난 캠페인(drift)을 뺀다 · 묶음 성과는 닫힌 캠페인만', () => {
    const reads = roll.slice(roll.indexOf('const CARRIER_ROWS_FROM'), roll.indexOf('const LIVE_TTL_MS'));
    expect(reads.match(/r\.drift = 0/g)?.length).toBe(2);
    expect(reads).toContain("r.cells_state = 'closed'");
  });

  it('주소: 묶음 성과 = 요금제 → 굴리기 단계 → 회사 전체 판정 차례 · 표 없음 = 503 / 업종 평균 = 단계가 열린 회사에게만 새 칸', () => {
    const r = code(src('routes/ai-line.ts'));
    const g = r.slice(r.indexOf("router.get('/ask/group-performance'"), r.indexOf("router.post('/ask/count'"));
    const at = (needle: string) => { const i = g.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i; };
    expect(at('await lineGate(req, res)')).toBeLessThan(at("v3Live('rollup', v.companyId)"));
    expect(at("v3Live('rollup', v.companyId)")).toBeLessThan(at('companyWideViewer(req.user as any)'));
    expect(at('companyWideViewer(req.user as any)')).toBeLessThan(at('readGroupPerformance(v.companyId)'));
    expect(g).toContain("handleDbMigrationError(err, res, 'campaign_cell_results')");
    const b = code(src('routes/benchmark.ts'));
    expect(b).toContain("(await v3Live('rollup', companyId)) ? await readSendSuccess(companyId) : null");
    expect(b.indexOf("!(await v3Live('benchmark', companyId))")).toBeLessThan(b.indexOf('readSendSuccess(companyId)'));
  });

  it('일꾼이 app 에 등록돼 있다', () => {
    const app = src('app.ts');
    expect(app).toContain("import { startSendLedgerRollupWorker } from './utils/send-ledger-rollup';");
    expect(code(app)).toContain('startSendLedgerRollupWorker();');
  });
});

// ── 화면(순수 함수 · 소스 계약) ──

const front = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'frontend', 'src', rel), 'utf8');

describe('K8 화면 — 통신사 띠의 발송 성공률 칸(설계서 §3-A)', () => {
  const base: BenchmarkView = { hasIndustry: true, ready: true, minPeers: 5, windowDays: 30, successRate: { available: false, reason: 'no_own' }, spamBlock: [] };

  it('평균이 있으면 「내 값 · 업종 평균」 + 색(높으면 초록 · 낮으면 빨강) · 평균이 없으면 내 값만 · 마지막 칸 = 통신사 미상 실패', () => {
    const cells = sendBenchCells({
      ...base, unknownFail: 1204,
      sendSuccess: [
        { carrier: 'SKT', available: true, mine: 0.987, avg: 0.979, diff: 0.008 },
        { carrier: 'KT', available: true, mine: 0.95, avg: 0.97, diff: -0.02 },
        { carrier: 'LGU', available: false, reason: 'few_peers', mine: 0.9 },
      ],
    });
    expect(cells).toEqual([
      { label: 'SKT 발송 성공률', value: '98.7%', sub: '업종 평균 97.9%', tone: 'emerald' },
      { label: 'KT 발송 성공률', value: '95.0%', sub: '업종 평균 97.0%', tone: 'rose' },
      { label: 'LG U+ 발송 성공률', value: '90.0%' },
      { label: '통신사 미상 실패', value: '1,204건' },
    ]);
  });
  it('칸이 없는 응답(단계 닫힘) · 내 값이 하나도 없음 = 띠 없음 · 스팸 검사 띠는 그대로', () => {
    expect(sendBenchCells(base)).toEqual([]);
    expect(sendBenchCells({ ...base, sendSuccess: [], unknownFail: 9 })).toEqual([]);
    expect(sendBenchCells(null)).toEqual([]);
    expect(spamBenchCells(base)).toEqual([]);
  });
  it('발치 글 = 미상 실패 · 알뜰폰을 어떻게 셌는지 · 평균이 있을 때만 견준다는 문장 · 검사 방식 낱말 0', () => {
    const none = sendBenchFootnote({ ...base, sendSuccess: [{ carrier: 'SKT', available: false, reason: 'few_peers', mine: 0.9 }] });
    const some = sendBenchFootnote({ ...base, sendSuccess: [{ carrier: 'SKT', available: true, mine: 0.9, avg: 0.8, diff: 0.1 }] });
    expect(none).toBe('통신사를 알 수 없는 실패(없는 번호 등)는 성공률에서 뺐어요 · 알뜰폰은 그 망의 통신사에 더했어요 · 높을수록 좋아요');
    expect(some).toContain('같은 업종 5곳 이상 평균과 견줍니다');
    for (const t of [none, some]) expect(t).not.toMatch(/검사폰|단말|테스트폰/);
  });
});

describe('K9 화면 — 고객 묶음별 성과(설계서 §3-B · §3-C)', () => {
  const body = {
    success: true, live: true, windowDays: 90, attributionDays: 7, minN: 30, unknown: 6,
    groups: [
      { group: 'leave', name: '떠나는 단골', desc: '설명', recipients: 30, buyers: 3, revenue: 90000, cost: 900, perWon: 100 },
      { group: 'next', name: '다음 구매 차례', desc: '설명', recipients: 29, buyers: null, revenue: null, cost: null, perWon: null },
      { group: 'loyal', name: '요즘 단골', desc: '설명', recipients: 50, buyers: 5, revenue: 6200, cost: 500, perWon: 12.4 },
    ],
  };
  it('서버 응답을 그대로 읽는다 · 닫힘(live 아님) · 꼴이 다르면 null', () => {
    const p = readGroupPerf(body)!;
    expect([p.windowDays, p.attributionDays, p.minN, p.unknown, p.groups.length]).toEqual([90, 7, 30, 6, 3]);
    expect(p.groups[1]).toEqual({ group: 'next', name: '다음 구매 차례', desc: '설명', recipients: 29, buyers: null, revenue: null, cost: null, perWon: null });
    expect(readGroupPerf({ success: true, live: false })).toBeNull();
    expect(readGroupPerf({ success: true, live: true })).toBeNull();
    expect(readGroupPerf(null)).toBeNull();
  });
  it('1원당 매출 글자 · 막대 길이 · 묶음 표 · 빈 상태', () => {
    expect([perWonText(12.44), perWonText(100), perWonText(1234.5), perWonText(0)]).toEqual(['12.4원', '100원', '1,235원', '0.0원']);
    const p = readGroupPerf(body)!;
    expect([perWonBar(p.groups, 100), perWonBar(p.groups, 12.4), perWonBar(p.groups, null), perWonBar([], 5)]).toEqual([100, 12, 0, 0]);
    expect([...perWonByGroup(p).entries()]).toEqual([['leave', 100], ['loyal', 12.4]]);
    expect(perWonByGroup(null).size).toBe(0);
    expect(groupPerfEmpty(p)).toBe(false);
    expect(groupPerfEmpty({ ...p, unknown: 0, groups: p.groups.map((g) => ({ ...g, recipients: 0 })) })).toBe(true);
  });
  it('배선: 성과 화면에 카드 · 띠 · 카드의 단추는 그 묶음을 실은 한 줄로 묻기 주소로 · 한 줄로 묻기는 묶음 표에 있는 키일 때만 2단계로 연다', () => {
    const page = front('pages/PerformancePage.tsx');
    expect(page).toContain('<GroupPerformanceCard />');
    expect(page).toContain('cells={sendBenchCells(bench)}');
    expect(page.indexOf('<EffectProofCard')).toBeLessThan(page.indexOf('<GroupPerformanceCard />'));
    const card = front('components/performance/GroupPerformanceCard.tsx');
    expect(card).toContain('navigate(`/ai-ask?group=${encodeURIComponent(g.group)}`)');
    expect(card).toContain('if (!data) return null;');
    expect(card).toContain('대조군으로 잰 효과(위 카드)와는 다른 숫자예요.');
    expect(card).toContain('발송 결과를 모으는 중이에요. 보내고 열흘 뒤부터 보여요.');
    const ask = front('pages/AiAskPage.tsx');
    const eff = ask.slice(ask.indexOf('const groupParamDone = useRef(false);'), ask.indexOf('const [reading, setReading] = useState(false);'));
    expect(eff).toContain("new URLSearchParams(window.location.search).get('group')");
    expect(eff).toContain('seg.groups.find((g) => g.key === k)');
    expect(eff.indexOf('if (!hit) return;')).toBeLessThan(eff.indexOf("begin('pick', [hit.key]);"));
    // ★ 구현 Codex 1R — 묶음 숫자가 오기 전에 사용자가 시작한 흐름(흐름 번호가 올랐다)이 있으면 자동으로 열지 않는다(받은 답 · 진행 중인 흐름을 지우지 않는다)
    expect(eff.indexOf('if (flow.current !== 0) return;')).toBeGreaterThan(-1);
    expect(eff.indexOf('if (flow.current !== 0) return;')).toBeLessThan(eff.indexOf("new URLSearchParams(window.location.search).get('group')"));
    expect(eff.indexOf("begin('pick', [hit.key]);")).toBeLessThan(eff.indexOf('setStep(2);'));
    expect(ask).toContain('`문자 1원당 매출 ${perWonText(perWon.get(g.key)!)}`');
  });
  it('새 화면 글에 모델명 · 검사 방식 낱말 · native dialog 가 없다', () => {
    for (const f of ['components/performance/GroupPerformanceCard.tsx', 'utils/group-performance.ts']) {
      const s = front(f);
      expect(s).not.toMatch(/Opus|Sonnet|Haiku|GPT|Claude|Anthropic|claude-/);
      expect(s).not.toMatch(/검사폰|테스트폰|\balert\(|\bconfirm\(|\bprompt\(/);
    }
  });
});
