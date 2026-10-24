/**
 * journey-credit-forecast.ts — 켜 둔 여정이 한 달에 쓰는 운영 크레딧 예상(★ 2026-10-20 여정 V.3 묶음 1 · 설계서 §5-4)
 *
 * 요금제 내림 경고(고객 신청 · 슈퍼관리자 승인 목록)와 지도 요약 숫자가 같은 함수를 쓴다(숫자가 화면마다 다르면 그 자체가 클레임).
 * 예측 모델을 쓰지 않는다. 사실과 규칙 두 가지만:
 *   - 계보의 첫 운영 차감이 30일보다 오래됐으면 = 지난 30일 운영 차감 행 수 × 단가(원장 사실 · basis 'measured')
 *   - 아니면 = 30일 × 단가(규칙 · basis 'max' · 화면에 「최대」)
 * approved_at 은 다시 켤 때 NOW 로 덮여(journey-builder activateJourney) 「켠 지 며칠」의 기준으로 못 쓴다 → 원장 첫 차감을 쓴다.
 * 운영 키 = journey-operation:{계보 뿌리 또는 V.3 전 판 id}:{KST 날짜} → 키 둘째 마디를 여정 표로 이어 계보로 모은다.
 * ⛔ 조회 실패는 던진다(모르는 값을 0 으로 접지 않는다 · 호출부 503/500).
 * 한계: V.3 전 바닥 아래 공짜 발송일은 원장에 없어 그 기간 실측이 낮다.
 * ★ 2026-10-23 여정 결함 0(V.3 §16) — 자동 마케팅 운영 크레딧도 같은 달 크레딧에서 나간다 → 지난 30일 실제(원장 행 수 × 단가)를 합에 넣는다
 *   (옛: 세지 않아 요금제를 내린 뒤 둘을 합친 사용이 기본 크레딧을 넘으면 여정이 크레딧 부족으로 멈췄다 · D1).
 */
import { query } from '../config/database';
import { lineageColumnsReady } from './journey-lineage';
import { getCreditCost } from './ai-credit-calc';

export interface ForecastLineage {
  rootId: string;
  name: string;
  /** 지난 30일 실제 운영 크레딧(원장) */
  measured30: number;
  /** 경고에 쓰는 값(measured = 실측 · max = 30일 최대) */
  credits: number;
  basis: 'measured' | 'max';
}

export interface JourneyCreditForecast {
  /** 여정 운영 예상 + 자동 마케팅 운영(지난 30일 실제) */
  total: number;
  /** 자동 마케팅 운영 크레딧(지난 30일 실제 · 원장) */
  autoMarketing30?: number;
  basis: 'measured' | 'max' | 'mixed';
  perLineage: ForecastLineage[];
}

export const FORECAST_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 순수 — 켜진 여정(계보 뿌리) · 여정 id → 뿌리 · 원장 묶음(키 둘째 마디별 30일 행 수 · 첫 차감 시각)으로 계산한다. */
export function computeJourneyCreditForecast(input: {
  now: Date;
  unitCost: number;
  active: Array<{ id: string; name: string; root: string }>;
  idToRoot: Map<string, string>;
  ledger: Array<{ journeyKey: string; n30: number; firstAt: Date | string | null }>;
}): JourneyCreditForecast {
  const byRoot = new Map<string, { n30: number; firstAt: number | null }>();
  for (const l of input.ledger) {
    const root = input.idToRoot.get(String(l.journeyKey));
    if (!root) continue;
    const cur = byRoot.get(root) || { n30: 0, firstAt: null };
    cur.n30 += Number(l.n30) || 0;
    const t = l.firstAt ? new Date(l.firstAt).getTime() : null;
    if (t != null && Number.isFinite(t) && (cur.firstAt == null || t < cur.firstAt)) cur.firstAt = t;
    byRoot.set(root, cur);
  }
  const seen = new Set<string>();
  const perLineage: ForecastLineage[] = [];
  for (const a of input.active) {
    if (seen.has(a.root)) continue;
    seen.add(a.root);
    const l = byRoot.get(a.root);
    const measured30 = (l?.n30 || 0) * input.unitCost;
    const old = l?.firstAt != null && input.now.getTime() - l.firstAt >= FORECAST_WINDOW_DAYS * DAY_MS;
    perLineage.push({
      rootId: a.root,
      name: String(a.name || '').replace(/ \(새 판\)$/, ''),
      measured30,
      credits: old ? measured30 : input.unitCost * FORECAST_WINDOW_DAYS,
      basis: old ? 'measured' : 'max',
    });
  }
  const total = perLineage.reduce((s, x) => s + x.credits, 0);
  const kinds = new Set(perLineage.map((x) => x.basis));
  const basis: JourneyCreditForecast['basis'] = kinds.size === 0 || (kinds.size === 1 && kinds.has('measured')) ? 'measured' : kinds.size === 1 ? 'max' : 'mixed';
  return { total, basis, perLineage };
}

/** 요금제 내림 경고 판정 — 예상이 새 요금제 월 기본 크레딧을 넘을 때만. 크레딧제 미적용 요금제(null)는 보지 않는다. */
export function journeyCreditOverPlan(f: JourneyCreditForecast, planCreditsPerMonth: number | null): boolean {
  if (planCreditsPerMonth == null || !Number.isFinite(planCreditsPerMonth)) return false;
  return f.total > planCreditsPerMonth;
}

/** 원장(운영 차감) 묶음 + 여정 id → 계보 뿌리 — 예상 · 지도가 같은 조회를 쓴다(회사당 각 1번). */
async function loadOperationLedger(companyId: string, now: Date, rootSql: string): Promise<{
  idToRoot: Map<string, string>;
  ledger: Array<{ journeyKey: string; n30: number; firstAt: Date | string | null }>;
}> {
  const all = await query(`SELECT id, ${rootSql} AS root FROM journeys WHERE company_id = $1::uuid`, [companyId]);
  const led = await query(
    `SELECT split_part(idempotency_key, ':', 2) AS journey_key,
            COUNT(*) FILTER (WHERE created_at > $2::timestamptz - INTERVAL '${FORECAST_WINDOW_DAYS} days')::int AS n30,
            MIN(created_at) AS first_at
       FROM ai_credit_transactions
      WHERE company_id = $1::uuid AND source = 'journey-operation' AND type = 'deduct'
      GROUP BY 1`,
    [companyId, now.toISOString()],
  );
  return {
    idToRoot: new Map(all.rows.map((r: any) => [String(r.id), String(r.root)])),
    ledger: led.rows.map((r: any) => ({ journeyKey: String(r.journey_key || ''), n30: Number(r.n30) || 0, firstAt: r.first_at || null })),
  };
}

/** 지난 30일 실제 운영 크레딧(원장) — 계보 뿌리별(지도 카드 · 요약 줄). */
export async function operationCredits30dByRoot(companyId: string, now: Date = new Date()): Promise<Map<string, number>> {
  const ready = await lineageColumnsReady();
  const { idToRoot, ledger } = await loadOperationLedger(companyId, now, ready ? 'COALESCE(lineage_id, id)' : 'id');
  const unit = getCreditCost('journey-operation');
  const out = new Map<string, number>();
  for (const l of ledger) {
    const root = idToRoot.get(l.journeyKey);
    if (!root) continue;
    out.set(root, (out.get(root) || 0) + (Number(l.n30) || 0) * unit);
  }
  return out;
}

/** 회사 하나의 예상(켜진 여정 · 계보 표 · 원장 각 1번). */
export async function journeyCreditForecast(companyId: string, now: Date = new Date()): Promise<JourneyCreditForecast> {
  const ready = await lineageColumnsReady();
  const rootSql = ready ? 'COALESCE(lineage_id, id)' : 'id';
  const act = await query(
    `SELECT id, name, ${rootSql} AS root FROM journeys
      WHERE company_id = $1::uuid AND status = 'active' AND archived_at IS NULL
      ORDER BY ${ready ? 'entry_closed_at NULLS FIRST, ' : ''}created_at ASC`,
    [companyId],
  );
  const am = await query(
    `SELECT COUNT(*)::int AS n FROM ai_credit_transactions
      WHERE company_id = $1::uuid AND source = 'continuous-operator-send' AND type = 'deduct'
        AND created_at > $2::timestamptz - INTERVAL '${FORECAST_WINDOW_DAYS} days'`,
    [companyId, now.toISOString()],
  );
  const autoMarketing30 = (Number(am.rows[0]?.n) || 0) * getCreditCost('continuous-operator-send');
  if (act.rows.length === 0) return { total: autoMarketing30, autoMarketing30, basis: 'measured', perLineage: [] };
  const { idToRoot, ledger } = await loadOperationLedger(companyId, now, rootSql);
  const f = computeJourneyCreditForecast({
    now,
    unitCost: getCreditCost('journey-operation'),
    active: act.rows.map((r: any) => ({ id: String(r.id), name: String(r.name || ''), root: String(r.root) })),
    idToRoot,
    ledger,
  });
  return { ...f, total: f.total + autoMarketing30, autoMarketing30 };
}
