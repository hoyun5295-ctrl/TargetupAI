/**
 * group-performance.ts — 고객 묶음별 성과의 서버 호출 · 글자 만들기
 *   (★ 2026-11-22 C154 · 설계서 docs/2026-11-22-c154-send-ledger-rollup-design.md §3-B · §3-C · 서버 = backend routes/ai-line.ts GET /ask/group-performance · utils/send-ledger-rollup.ts)
 *
 * 서버가 준 값만 쓴다(숫자를 지어내지 않는다). 닫힌 회사 · 분류코드로 나뉜 담당자 · 실패 · 표 없음 = null = 카드 · 격자 칸 없음.
 * 숫자 = 보낸 뒤 7일 안에 받은 분이 산 금액(대조군으로 잰 효과와 다른 숫자). 받은 분이 모자란 묶음은 서버가 숫자를 비워 보낸다(null).
 */
import { fetchJson } from './dashboard-live';

export interface GroupPerfRow {
  group: string;
  name: string;
  desc: string;
  recipients: number;
  buyers: number | null;
  revenue: number | null;
  cost: number | null;
  perWon: number | null;
}
export interface GroupPerf { windowDays: number; attributionDays: number; minN: number; groups: GroupPerfRow[]; unknown: number }

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** (순수) 서버 응답 → 화면 값. live 가 아니거나 꼴이 다르면 null */
export function readGroupPerf(d: any): GroupPerf | null {
  if (!d?.success || d.live !== true || !Array.isArray(d.groups)) return null;
  return {
    windowDays: Number(d.windowDays) || 90,
    attributionDays: Number(d.attributionDays) || 7,
    minN: Number(d.minN) || 30,
    unknown: Math.max(0, Number(d.unknown) || 0),
    groups: d.groups.map((x: any) => ({
      group: String(x.group || ''), name: String(x.name || ''), desc: String(x.desc || ''),
      recipients: Math.max(0, Number(x.recipients) || 0),
      buyers: numOrNull(x.buyers), revenue: numOrNull(x.revenue), cost: numOrNull(x.cost), perWon: numOrNull(x.perWon),
    })),
  };
}

export async function fetchGroupPerformance(): Promise<GroupPerf | null> {
  const r = await fetchJson('/api/ai-line/ask/group-performance', 30_000);
  return r.ok ? readGroupPerf(r.body) : null;
}

/** (순수) 문자 1원당 매출 글자 — 100원 이상은 정수 · 그 아래는 소수 한 자리 */
export function perWonText(v: number): string {
  return `${v >= 100 ? Math.round(v).toLocaleString('ko-KR') : v.toFixed(1)}원`;
}

/** (순수) 막대 길이(0 ~ 100) — 가장 큰 1원당 매출이 100 · 값이 없는 묶음은 0 */
export function perWonBar(rows: ReadonlyArray<Pick<GroupPerfRow, 'perWon'>>, v: number | null): number {
  const max = Math.max(0, ...rows.map((r) => r.perWon ?? 0));
  return v === null || max <= 0 ? 0 : Math.round((Math.max(0, v) / max) * 100);
}

/** (순수) 아직 보여 줄 숫자가 없는가(받은 분이 한 묶음도 없다) → 「모으는 중」 빈 상태 */
export const groupPerfEmpty = (p: GroupPerf): boolean => p.groups.every((g) => g.recipients === 0) && p.unknown === 0;

/** (순수) 묶음 키 → 1원당 매출(값이 있는 묶음만) — 한 줄로 묻기 묶음 줄이 쓴다 */
export function perWonByGroup(p: GroupPerf | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const g of p?.groups || []) if (g.perWon !== null) out.set(g.group, g.perWon);
  return out;
}
