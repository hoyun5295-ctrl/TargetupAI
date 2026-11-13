/**
 * benchmark.ts — 성과리포트 「업종 평균」 비교의 서버 호출 · 글자 만들기
 *   (★ 2026-11-13 C133 F3 · 설계서 docs/2026-11-13-hanjul-v3-design.md §4-2 · 서버 = backend routes/benchmark.ts · utils/performance-benchmark.ts)
 *
 * 서버가 준 값만 쓴다(평균을 지어내지 않는다). 닫힌 회사 · 실패 · 표 없음 = null = 비교 줄 없음.
 * 비교 창은 늘 최근 30일이다(화면의 기간 고르기와 따로) → 글자에 「최근 30일 기준」을 적는다.
 */
import { fetchJson } from './dashboard-live';

export type BenchCell =
  | { available: true; mine: number; avg: number; diff: number }
  | { available: false; reason: 'few_peers' | 'no_own' };

export interface BenchmarkView {
  hasIndustry: boolean;
  ready: boolean;
  minPeers: number;
  windowDays: number;
  successRate: BenchCell;
  spamBlock: Array<{ carrier: string } & BenchCell>;
}

export async function fetchBenchmark(): Promise<BenchmarkView | null> {
  const r = await fetchJson('/api/benchmark/summary');
  const d = r.body;
  if (!r.ok || !d?.success || d.live !== true || !d.successRate || !Array.isArray(d.spamBlock)) return null;
  return {
    hasIndustry: d.hasIndustry === true, ready: d.ready === true,
    minPeers: Number(d.minPeers) || 5, windowDays: Number(d.windowDays) || 30,
    successRate: d.successRate, spamBlock: d.spamBlock,
  };
}

const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
/** 차이(비율) → 「1.2%p 높음」 · 0.05%p 안쪽은 「같은 수준」 */
export function pointDiffText(diff: number): string {
  const p = Math.abs(diff * 100);
  return p < 0.05 ? '같은 수준' : `${p.toFixed(1)}%p ${diff > 0 ? '높음' : '낮음'}`;
}

export interface BenchLine { text: string; tone: 'good' | 'bad' | 'same' | 'hint' }

/**
 * (순수) 성공률 카드의 비교 줄. 높을수록 좋다.
 *   업종이 없으면 고르는 길을 알려 주고 · 같은 업종 회사가 모자라면 그렇다고 적는다(회사 수는 적지 않는다) · 내 값이 없으면 줄 없음.
 */
export function successBenchLine(b: BenchmarkView | null): BenchLine | null {
  if (!b) return null;
  if (!b.hasIndustry) return { text: '브랜드 학습 창에서 업종을 고르면 같은 업종과 견줘 드려요', tone: 'hint' };
  const c = b.successRate;
  if (c.available) {
    const same = Math.abs(c.diff * 100) < 0.05;
    return { text: `최근 ${b.windowDays}일 기준 업종 평균 ${pct(c.avg)} · ${pointDiffText(c.diff)}`, tone: same ? 'same' : c.diff > 0 ? 'good' : 'bad' };
  }
  if (c.reason === 'few_peers') return { text: '같은 업종 회사가 아직 적어 평균을 보여 드리지 않아요', tone: 'hint' };
  return null;
}

const CARRIER_LABEL: Record<string, string> = { SKT: 'SKT', KT: 'KT', LGU: 'LG U+' };

export interface SpamBenchCell { label: string; value: string; tone?: 'emerald' | 'rose' }

/** (순수) 통신사별 스팸 검사 차단율 띠의 칸 — 평균이 있는 통신사만. 낮을수록 좋다 */
export function spamBenchCells(b: BenchmarkView | null): SpamBenchCell[] {
  if (!b) return [];
  const out: SpamBenchCell[] = [];
  for (const c of b.spamBlock) {
    if (!c.available) continue;
    const same = Math.abs(c.diff * 100) < 0.05;
    out.push({
      label: `${CARRIER_LABEL[c.carrier] || c.carrier} 차단율`,
      value: `${pct(c.mine)} · 업종 평균 ${pct(c.avg)}`,
      ...(same ? {} : { tone: c.diff < 0 ? 'emerald' as const : 'rose' as const }),
    });
  }
  return out;
}
