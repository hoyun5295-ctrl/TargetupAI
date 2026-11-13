/**
 * ★ CT-66: 업종 평균 비교 컨트롤타워 (D213+ 2026-05-24 → ★ 2026-11-13 C133 F3 다시 씀 · 설계서 docs/2026-11-13-hanjul-v3-design.md §4)
 *
 * 옛 판(요금제 축 · 절댓값 · 부르는 곳 0)을 걷고 다시 썼다.
 *   축 = 업종(companies.industry_code · 브랜드 학습 창이 저장) · 지표 = **비율만**(다른 회사 규모가 드러나는 절댓값은 싣지 않는다).
 *   지표: success_rate = 최근 30일 결과가 확정된 캠페인의 성공 ÷ 발송 / spam_block:<통신사> = 최근 30일 스팸 검사의 차단 ÷ (정상 + 차단).
 *   ※ 통신사별 발송 성공률은 실패 행에 통신사가 남는지 서버에서 잰 뒤에 붙인다(설계서 §15 · 재기 전에는 만들지 않는다).
 *
 * 하루 한 번 워커가 **회사마다 그 시점의 업종 · 지표 값**을 benchmark_company_daily(배포 원장 C133-DDL-4)에 쓴다(분모 0 · 업종 빈 회사는 행 없음).
 * 화면 요청은 **가장 최근 날짜의 그 스냅숏만** 읽는다: 내 값 = 내 행 · 평균 = 같은 날 · 같은 업종 · 같은 지표의 **다른 회사 행**의 산술 평균
 *   (큰 회사 하나가 평균을 끌지 않게 회사별 비율의 평균). 야간 뒤에 결과 · 업종이 바뀌어도 한 스냅숏 안에서 빼고 세므로 어긋나지 않는다.
 *
 * ⛔ 영구 원칙
 *   - 다른 회사 값은 서버 밖으로 나가지 않는다. 응답 = 내 값 · 평균 · 차이뿐(회사 수 k 도 싣지 않는다).
 *   - 지표마다 평균에 든 다른 회사가 BENCH_MIN_PEERS(5)곳 미만이면 그 지표는 available: false(평균을 싣지 않는다).
 *   - 시연 회사 · 합성 데이터 회사는 평균에서 뺀다(자기 값은 본다 = 사내 회사로 화면을 확인할 수 있다).
 *   - 스냅숏은 벤치마크 단계(V3_STAGE_BENCHMARK)가 한 곳이라도 열렸을 때만 만든다(닫혀 있으면 부하 0).
 */
import { query, withTransaction } from '../config/database';
import { listDemoCompanyIds } from './demo-company';
import { syntheticDataCompanyIds } from './demo-data';
import { resolveCompanyIndustry } from './copy-prompt-composer';
import { v3StageScope } from './v3-stage';

export const BENCH_MIN_PEERS = 5;
export const BENCH_WINDOW_DAYS = 30;
/** 스냅숏을 두는 기간(일) — 화면은 가장 최근 날만 읽는다 · 그보다 오래된 날은 지운다 */
export const BENCH_KEEP_DAYS = 40;
/** 스냅숏이 이보다 오래됐으면 비교하지 않는다(워커가 멈춘 채 옛 평균을 보이지 않는다) */
export const BENCH_STALE_DAYS = 3;
export const BENCH_METRIC_SUCCESS = 'success_rate';
export const BENCH_METRIC_SPAM_PREFIX = 'spam_block:';
/** 스팸 검사 단말의 통신사 표기(spam_filter_test_results.carrier) */
export const BENCH_CARRIERS = ['SKT', 'KT', 'LGU'] as const;

const kstToday = `(NOW() AT TIME ZONE 'Asia/Seoul')::date`;
/** 업종 값(공백 정리 · 표 칸 길이로 자른다 — 긴 값 하나가 그날 스냅숏 전체를 떨어뜨리지 않게) */
const INDUSTRY_SQL = `LEFT(TRIM(co.industry_code), 40)`;

/** 회사별 발송 성공률 — 결과가 확정된(result_final) 완료 캠페인만($1 창 일수). 분모 0 인 회사 · 업종 빈 회사 · 활성 아님은 행 없음 */
export const BENCH_SUCCESS_SQL = `
  INSERT INTO benchmark_company_daily (day, company_id, industry_code, metric, value)
  SELECT ${kstToday}, c.company_id, ${INDUSTRY_SQL}, '${BENCH_METRIC_SUCCESS}',
         SUM(c.success_count)::float8 / SUM(c.sent_count)
    FROM campaigns c
    JOIN companies co ON co.id = c.company_id
   WHERE c.status = 'completed' AND c.result_final = true
     AND c.sent_at > NOW() - ($1::int * INTERVAL '1 day')
     AND co.status = 'active' AND NULLIF(TRIM(co.industry_code), '') IS NOT NULL
   GROUP BY c.company_id, ${INDUSTRY_SQL}
  HAVING SUM(c.sent_count) > 0 AND SUM(c.success_count) <= SUM(c.sent_count)`;

/** 회사 · 통신사별 스팸 검사 차단율 — 끝난 검사의 정상 수신 · 차단 판정만($1 창 일수 · 발송 실패 · 시간 초과 · 판정 대기는 분모에서 뺀다) */
export const BENCH_SPAM_SQL = `
  INSERT INTO benchmark_company_daily (day, company_id, industry_code, metric, value)
  SELECT ${kstToday}, t.company_id, ${INDUSTRY_SQL}, '${BENCH_METRIC_SPAM_PREFIX}' || r.carrier,
         (COUNT(*) FILTER (WHERE r.result = 'blocked'))::float8 / COUNT(*)
    FROM spam_filter_test_results r
    JOIN spam_filter_tests t ON t.id = r.test_id
    JOIN companies co ON co.id = t.company_id
   WHERE t.status = 'completed' AND t.created_at > NOW() - ($1::int * INTERVAL '1 day')
     AND r.result IN ('pass', 'blocked') AND r.carrier = ANY($2::text[])
     AND co.status = 'active' AND NULLIF(TRIM(co.industry_code), '') IS NOT NULL
   GROUP BY t.company_id, ${INDUSTRY_SQL}, r.carrier`;

/** 오늘(KST) 스냅숏을 통째로 다시 쓴다(지우고 넣기 · 한 트랜잭션) + 보관 기간 밖 날짜 삭제. 돌려주는 값 = 넣은 행 수 */
export async function snapshotBenchmarks(): Promise<number> {
  return withTransaction(async (run) => {
    await run(`SET LOCAL statement_timeout = 120000`);
    await run(`DELETE FROM benchmark_company_daily WHERE day = ${kstToday} OR day < ${kstToday} - $1::int`, [BENCH_KEEP_DAYS]);
    const a = await run(BENCH_SUCCESS_SQL, [BENCH_WINDOW_DAYS]);
    const b = await run(BENCH_SPAM_SQL, [BENCH_WINDOW_DAYS, [...BENCH_CARRIERS]]);
    return (a.rowCount || 0) + (b.rowCount || 0);
  });
}

export type BenchCell =
  | { available: true; mine: number; avg: number; diff: number }
  | { available: false; reason: 'few_peers' | 'no_own' };

export interface BenchmarkView {
  /** 이 회사의 업종이 정해져 있는가(없으면 화면이 「업종을 고르면 견줘 드려요」) */
  hasIndustry: boolean;
  /** 비교할 스냅숏이 있는가(없음 = 아직 계산 전 · 오래됨) */
  ready: boolean;
  successRate: BenchCell;
  /** 통신사별 스팸 검사 차단율(내 값이 있는 통신사만) */
  spamBlock: Array<{ carrier: string } & BenchCell>;
}

/**
 * 가장 최근 스냅숏에서 내 행과 같은 업종 · 같은 지표의 다른 회사 평균($1 회사 · $2 평균에서 뺄 회사들 · $3 오래됨 기준 일수).
 *   k 는 판정에만 쓰고 응답에 싣지 않는다.
 */
export const BENCH_READ_SQL = `
  WITH d AS (SELECT MAX(day) AS day FROM benchmark_company_daily WHERE day >= ${kstToday} - $3::int)
  SELECT m.metric, m.value AS mine, p.k, p.avg
    FROM d
    JOIN benchmark_company_daily m ON m.day = d.day AND m.company_id = $1::uuid
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS k, AVG(o.value) AS avg
        FROM benchmark_company_daily o
       WHERE o.day = d.day AND o.industry_code = m.industry_code AND o.metric = m.metric
         AND o.company_id <> $1::uuid AND NOT (o.company_id = ANY($2::uuid[]))
    ) p ON TRUE`;

/** (순수) 내 값 · 다른 회사 수 · 평균 → 화면 칸. 회사 수가 모자라면 평균을 싣지 않는다 */
export function benchCell(mine: number | null | undefined, k: number, avg: number | null | undefined): BenchCell {
  if (mine === null || mine === undefined || !Number.isFinite(Number(mine))) return { available: false, reason: 'no_own' };
  if (k < BENCH_MIN_PEERS || avg === null || avg === undefined || !Number.isFinite(Number(avg))) return { available: false, reason: 'few_peers' };
  return { available: true, mine: Number(mine), avg: Number(avg), diff: Number(mine) - Number(avg) };
}

/** 평균에서 빼는 회사(시연 · 합성 데이터) */
export async function benchExcludedCompanyIds(): Promise<string[]> {
  return [...new Set([...(await listDemoCompanyIds()), ...syntheticDataCompanyIds()])];
}

export async function readBenchmark(companyId: string): Promise<BenchmarkView> {
  const [industry, excluded] = await Promise.all([resolveCompanyIndustry(companyId), benchExcludedCompanyIds()]);
  const r = await query(BENCH_READ_SQL, [companyId, excluded, BENCH_STALE_DAYS]);
  const byMetric = new Map<string, any>(r.rows.map((x: any) => [String(x.metric), x]));
  const cell = (metric: string): BenchCell => {
    const x = byMetric.get(metric);
    return x ? benchCell(Number(x.mine), Number(x.k || 0), x.avg === null ? null : Number(x.avg)) : { available: false, reason: 'no_own' };
  };
  return {
    hasIndustry: !!industry,
    ready: r.rows.length > 0,
    successRate: cell(BENCH_METRIC_SUCCESS),
    spamBlock: BENCH_CARRIERS
      .filter((c) => byMetric.has(`${BENCH_METRIC_SPAM_PREFIX}${c}`))
      .map((c) => ({ carrier: c, ...cell(`${BENCH_METRIC_SPAM_PREFIX}${c}`) })),
  };
}

// ── 야간 워커 ──

const WORKER_INTERVAL_MS = 30 * 60 * 1000;
export const BENCH_RUN_HOUR_KST = 4;
const BOOT_FILL_DELAY_MS = 120_000;
let workerTimer: ReturnType<typeof setInterval> | null = null;
let lastRunDayKst = '';
let running = false;

const kstNow = (d: Date) => new Date(d.getTime() + 9 * 3600 * 1000);

/** (순수) 벤치마크 단계가 한 곳이라도 열렸는가 — 닫혀 있으면 스냅숏을 만들지 않는다 */
export function benchStageOpen(env: Record<string, string | undefined> = process.env): boolean {
  const s = v3StageScope('benchmark', env);
  return s.all || s.ids.length > 0;
}

/** (순수) 지금 밤 계산을 돌릴 차례인가 — KST 4시대 · 그날 아직 안 돌았을 때 */
export function benchRunDue(now: Date, lastDay: string): boolean {
  const k = kstNow(now);
  return k.getUTCHours() === BENCH_RUN_HOUR_KST && k.toISOString().slice(0, 10) !== lastDay;
}

async function runSnapshot(label: string): Promise<void> {
  if (running || !benchStageOpen()) return;
  running = true;
  try {
    const n = await snapshotBenchmarks();
    console.log(`[benchmark] ${label} — 스냅숏 ${n}행`);
  } catch (err: any) {
    console.error(`[benchmark] ${label} 실패(표가 없으면 DDL C133-DDL-4 확인 · 옛 스냅숏 유지):`, err?.message);
  } finally {
    running = false;
  }
}

export function startBenchmarkWorker(): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    const now = new Date();
    if (!benchRunDue(now, lastRunDayKst)) return;
    lastRunDayKst = kstNow(now).toISOString().slice(0, 10);
    void runSnapshot('밤 계산');
  }, WORKER_INTERVAL_MS);
  // 기동 직후 — 쓸 만한 스냅숏이 없을 때만 한 번(단계를 방금 연 날 밤까지 빈 화면으로 기다리지 않게)
  setTimeout(() => {
    if (!benchStageOpen()) return;
    void query(`SELECT 1 FROM benchmark_company_daily WHERE day >= ${kstToday} - 1 LIMIT 1`)
      .then((r) => { if (r.rows.length === 0) return runSnapshot('첫 채우기'); })
      .catch((err: any) => console.error('[benchmark] 첫 채우기 확인 실패:', err?.message));
  }, BOOT_FILL_DELAY_MS).unref?.();
  console.log('[benchmark] 워커 시작 — 매일 KST 4시대 · 벤치마크 단계가 열렸을 때만');
}

export function stopBenchmarkWorker(): void {
  if (workerTimer) { clearInterval(workerTimer); workerTimer = null; }
}
