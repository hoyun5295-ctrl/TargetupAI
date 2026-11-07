/**
 * CT: effect-measure-core.ts — 효과 판정 · 문장 순수 규칙(★ 2026-11-06 C110 · 설계서 docs/2026-11-06-c110-effect-proof-priority-design.md §2-3 ~ §2-5)
 *
 * DB import 0. 여정 통계 · 성과 리포트 · PDF 가 이 함수의 판정 · 문장을 그대로 쓴다(R56 · 같은 말 한 곳).
 * 검정 = 2×2 표(무리 × 구매) · 기대 빈도 네 칸 중 하나라도 5 미만이면 피셔 정확(양쪽) · 아니면 두 비율 z(합친 비율).
 */

export interface GroupStats { n: number; buyers: number; revenue: number }

export type LiftVerdictKind = 'insufficient' | 'positive' | 'negative' | 'unclear';

export interface LiftResult {
  treated: GroupStats;
  control: GroupStats;
  rateT: number;
  rateC: number;
  liftPp: number;
  incRevenue: number;
  incBuyers: number;
  pValue: number | null;
  test: 'fisher' | 'z' | null;
  verdict: LiftVerdictKind;
  limited: boolean;
  neededPerGroup: number | null;
  sentence: string;
}

/** 판단 하한(D9) — 두 무리 각각 */
export const LIFT_MIN_GROUP = 30;
/** 유의 수준(D9) */
export const LIFT_ALPHA = 0.05;

// ── 수치 ────────────────────────────────────────────────────────────────

/** 로그 감마(Lanczos · g = 7) — 로그 계승 = logGamma(n + 1) */
function logGamma(x: number): number {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61503916999185, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
const logFact = (n: number): number => logGamma(n + 1);

/** 피셔 정확 검정(양쪽) — 표 [[a, nT − a], [c, nC − c]] · 관측 확률 이하인 표의 확률 합 */
export function fisherTwoSided(a: number, nT: number, c: number, nC: number): number {
  const K = a + c;
  const N = nT + nC;
  const lo = Math.max(0, K - nC);
  const hi = Math.min(K, nT);
  const base = logFact(K) + logFact(N - K) + logFact(nT) + logFact(nC) - logFact(N);
  const logP = (x: number): number => base - logFact(x) - logFact(K - x) - logFact(nT - x) - logFact(nC - K + x);
  const obs = logP(a);
  let p = 0;
  for (let x = lo; x <= hi; x++) {
    const lp = logP(x);
    if (lp <= obs + 1e-7) p += Math.exp(lp);
  }
  return Math.min(1, p);
}

/** 표준 정규 누적(Abramowitz–Stegun 7.1.26 erf 근사) */
function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** 두 비율 z 검정(양쪽 · 합친 비율) */
export function zTwoSided(a: number, nT: number, c: number, nC: number): number {
  const p = (a + c) / (nT + nC);
  const se = Math.sqrt(p * (1 - p) * (1 / nT + 1 / nC));
  if (!(se > 0)) return 1;
  const z = (a / nT - c / nC) / se;
  return Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
}

/** 2×2 기대 빈도 중 가장 작은 값 */
function minExpected(a: number, nT: number, c: number, nC: number): number {
  const N = nT + nC;
  const K = a + c;
  return Math.min(nT * K / N, nT * (N - K) / N, nC * K / N, nC * (N - K) / N);
}

/** §2-5 지금 보이는 두 구매율 그대로 차이를 가리려면 무리마다 몇 명(유의 5% · 검정력 80%) · 차이 0 = null */
export function neededPerGroup(pT: number, pC: number): number | null {
  const d = pT - pC;
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return null;
  const v = pT * (1 - pT) + pC * (1 - pC);
  if (!(v > 0)) return null;
  return Math.ceil(((1.96 + 0.84) ** 2) * v / (d * d));
}

// ── 판정 · 문장 ─────────────────────────────────────────────────────────

const won = (n: number): string => `${Math.round(n).toLocaleString('ko-KR')}원`;
const pct1 = (r: number): string => `${(r * 100).toFixed(1)}%`;

export function liftSentence(r: Omit<LiftResult, 'sentence'>): string {
  const tail = r.limited ? ' 이 기간 측정이 일부 막혀 판단을 보류합니다.' : '';
  switch (r.verdict) {
    case 'positive':
      return `받은 고객의 구매율이 대조군보다 ${r.liftPp.toFixed(1)}%p 높았습니다. 늘어난 매출은 약 ${won(r.incRevenue)}, 늘어난 구매는 약 ${Math.round(r.incBuyers).toLocaleString('ko-KR')}건입니다.`;
    case 'negative':
      return `받은 고객의 구매율이 대조군보다 ${(-r.liftPp).toFixed(1)}%p 낮았습니다. 문구, 대상, 시간을 다시 볼 때입니다.`;
    case 'unclear':
      return `아직 차이가 뚜렷하지 않습니다(구매율 ${pct1(r.rateT)}, 대조군 ${pct1(r.rateC)}).${tail}`;
    case 'insufficient':
    default: {
      const need = r.neededPerGroup != null
        ? `판단하려면 각각 ${Math.max(r.neededPerGroup, LIFT_MIN_GROUP).toLocaleString('ko-KR')}명쯤 필요합니다.`
        : `판단하려면 각각 ${LIFT_MIN_GROUP}명 넘게, 구매가 더 쌓여야 합니다.`;
      return `아직 판단 이릅니다. 대조군 ${r.control.n.toLocaleString('ko-KR')}명, 받은 고객 ${r.treated.n.toLocaleString('ko-KR')}명. ${need}${tail}`;
    }
  }
}

/** §2-3 판정 — limited(그 기간 관문 장애) = 판정 보류(insufficient 가 아니면 unclear) */
export function liftVerdict(treated: GroupStats, control: GroupStats, opts?: { limited?: boolean }): LiftResult {
  const limited = opts?.limited === true;
  const nT = Math.max(0, Math.floor(treated.n));
  const nC = Math.max(0, Math.floor(control.n));
  const a = Math.min(nT, Math.max(0, Math.floor(treated.buyers)));
  const c = Math.min(nC, Math.max(0, Math.floor(control.buyers)));
  const rateT = nT > 0 ? a / nT : 0;
  const rateC = nC > 0 ? c / nC : 0;
  const revT = Number(treated.revenue) || 0;
  const revC = Number(control.revenue) || 0;
  const incRevenue = nT > 0 && nC > 0 ? Math.round((revT / nT - revC / nC) * nT) : 0;
  const incBuyers = (rateT - rateC) * nT;
  const liftPp = (rateT - rateC) * 100;

  let verdict: LiftVerdictKind;
  let pValue: number | null = null;
  let test: LiftResult['test'] = null;
  if (nT < LIFT_MIN_GROUP || nC < LIFT_MIN_GROUP || a + c === 0) {
    verdict = 'insufficient';
  } else {
    test = minExpected(a, nT, c, nC) < 5 ? 'fisher' : 'z';
    pValue = test === 'fisher' ? fisherTwoSided(a, nT, c, nC) : zTwoSided(a, nT, c, nC);
    verdict = pValue < LIFT_ALPHA ? (liftPp > 0 ? 'positive' : liftPp < 0 ? 'negative' : 'unclear') : 'unclear';
    if (limited) verdict = 'unclear';
  }
  const base = {
    treated: { n: nT, buyers: a, revenue: revT }, control: { n: nC, buyers: c, revenue: revC },
    rateT, rateC, liftPp, incRevenue, incBuyers, pValue, test, verdict, limited,
    neededPerGroup: neededPerGroup(rateT, rateC),
  };
  return { ...base, sentence: liftSentence(base) };
}

/** 판정 띠 이름(화면 · PDF 같은 말) */
export const LIFT_VERDICT_LABEL: Record<LiftVerdictKind, string> = {
  positive: '효과 있음',
  negative: '효과 낮음',
  unclear: '차이 뚜렷하지 않음',
  insufficient: '아직 판단 이름',
};
