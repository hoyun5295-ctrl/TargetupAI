/**
 * 유입 경로 카드(★ 2026-11-21 C152 E · 설계서 docs/2026-11-21-c152-snap-gap-upgrade-design.md §2-E · §3-E)
 *
 * 성과리포트 안의 한 카드. 경로 · 방문 · 구매 · 매출을 서버가 준 줄 그대로 그린다(지어낸 숫자 0).
 * 줄이 없으면(방문도 구매도 없음 · 닫힌 요금제 · 분류코드로 나뉜 담당자 · 실패) 아무것도 그리지 않는다.
 * 방문 0 인 경로 줄(창 앞 7일 방문에 귀속된 구매) · 「방문 기록 없음」 줄도 서버가 준 대로 보인다.
 */
import { useEffect, useState } from 'react';
import { fetchJson } from '../../utils/dashboard-live';

interface InflowRow { channel: string; visits: number; purchases: number; revenue: number }
interface Inflow { windowDays: number; lookbackDays: number; rows: InflowRow[] }

const num = (n: number) => Math.round(n).toLocaleString('ko-KR');

export default function InflowChannelCard() {
  const [data, setData] = useState<Inflow | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchJson('/api/ai/operator/performance/inflow-channels', 30_000).then((r) => {
      if (!alive || !r.ok || !r.body?.success || !Array.isArray(r.body.rows) || r.body.rows.length === 0) return;
      setData({
        windowDays: Number(r.body.windowDays) || 30,
        lookbackDays: Number(r.body.lookbackDays) || 7,
        rows: r.body.rows.map((x: any) => ({
          channel: String(x.channel || ''), visits: Number(x.visits) || 0, purchases: Number(x.purchases) || 0, revenue: Number(x.revenue) || 0,
        })),
      });
    });
    return () => { alive = false; };
  }, []);

  if (!data) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)]" aria-labelledby="inflow-channel-title">
      <h3 id="inflow-channel-title" className="text-[15px] font-bold text-slate-900">유입 경로</h3>
      <p className="mt-0.5 text-[12px] text-slate-500 break-keep">최근 {data.windowDays}일 · 자사몰 방문이 어디서 시작됐고 그 방문이 구매로 이어졌는지</p>

      {/* 넓은 화면 = 표 */}
      <div className="mt-3 hidden md:block overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[12px] text-slate-500">
              <th scope="col" className="py-2 pr-3 font-semibold">경로</th>
              <th scope="col" className="py-2 px-2 font-semibold text-right">방문</th>
              <th scope="col" className="py-2 px-2 font-semibold text-right">구매</th>
              <th scope="col" className="py-2 pl-2 font-semibold text-right">매출</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.channel} className="border-b border-slate-100 last:border-0">
                <td className="py-2.5 pr-3 font-semibold text-slate-900 break-keep">{r.channel}</td>
                <td className="py-2.5 px-2 text-right tabular-nums">{num(r.visits)}</td>
                <td className="py-2.5 px-2 text-right tabular-nums">{num(r.purchases)}건</td>
                <td className="py-2.5 pl-2 text-right tabular-nums font-semibold text-slate-900">{num(r.revenue)}원</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* 좁은 화면 = 카드 1열 */}
      <ul className="mt-3 md:hidden space-y-2">
        {data.rows.map((r) => (
          <li key={r.channel} className="rounded-xl border border-slate-200 p-3">
            <div className="font-semibold text-[14px] text-slate-900 break-keep">{r.channel}</div>
            <div className="mt-1 text-[12px] text-slate-600">방문 {num(r.visits)} · 구매 {num(r.purchases)}건 · 매출 {num(r.revenue)}원</div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-slate-400 break-keep">구매는 같은 방문 또는 구매 앞 {data.lookbackDays}일 안 마지막 방문의 경로로 셉니다 · 이어진 방문이 없는 구매는 「방문 기록 없음」</p>
    </section>
  );
}
