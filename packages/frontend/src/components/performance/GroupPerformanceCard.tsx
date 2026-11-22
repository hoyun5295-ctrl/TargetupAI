/**
 * 고객 묶음별 성과 카드(★ 2026-11-22 C154 · 설계서 docs/2026-11-22-c154-send-ledger-rollup-design.md §3-B)
 *
 * 성과리포트 안의 한 카드. 묶음(한 줄로 묻기의 일곱 줄)마다 받은 분 · 산 분 · 매출 · 문자 비용 · 문자 1원당 매출을 서버가 준 값 그대로 그린다.
 * 닫힌 회사 · 분류코드로 나뉜 담당자 · 실패 = 아무것도 그리지 않는다. 줄 끝 단추 = 그 묶음을 고른 채 한 줄로 묻기로(1클릭).
 * 숫자 = 보낸 뒤 7일 안에 받은 분이 산 금액(귀속) — 효과 증명 카드(대조군)와 다른 숫자라는 것을 머리 글에 적는다.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchGroupPerformance, groupPerfEmpty, perWonBar, perWonText, type GroupPerf, type GroupPerfRow } from '../../utils/group-performance';

const num = (n: number) => Math.round(n).toLocaleString('ko-KR');

export default function GroupPerformanceCard() {
  const navigate = useNavigate();
  const [data, setData] = useState<GroupPerf | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchGroupPerformance().then((p) => { if (alive && p) setData(p); });
    return () => { alive = false; };
  }, []);

  if (!data) return null;

  const send = (g: GroupPerfRow) => navigate(`/ai-ask?group=${encodeURIComponent(g.group)}`);
  const SendButton = ({ g }: { g: GroupPerfRow }) => (
    <button type="button" onClick={() => send(g)}
      className="inline-flex h-9 items-center whitespace-nowrap rounded-lg border border-slate-300 px-3 text-[12.5px] font-semibold text-slate-700 hover:border-slate-400 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900">
      이 묶음에 보내기
    </button>
  );
  const Bar = ({ g }: { g: GroupPerfRow }) => (
    <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
      <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${perWonBar(data.groups, g.perWon)}%` }} />
    </span>
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)]" aria-labelledby="group-performance-title">
      <h3 id="group-performance-title" className="text-[15px] font-bold text-slate-900">고객 묶음별 성과</h3>
      <p className="mt-0.5 text-[12px] leading-[1.6] text-slate-500 break-keep">
        최근 {data.windowDays}일 · 보낸 뒤 {data.attributionDays}일 안에 받은 분이 산 금액이에요. 묶음은 문자를 보낸 날의 구매 기록으로 나눴어요. 대조군으로 잰 효과(위 카드)와는 다른 숫자예요.
      </p>

      {groupPerfEmpty(data) ? (
        <p className="mt-4 rounded-xl bg-slate-50 px-4 py-6 text-center text-[13px] text-slate-600 break-keep">발송 결과를 모으는 중이에요. 보내고 열흘 뒤부터 보여요.</p>
      ) : (
        <>
          {/* 넓은 화면 = 표 */}
          <div className="mt-3 hidden lg:block">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[12px] text-slate-500">
                  <th scope="col" className="py-2 pr-3 font-semibold">묶음</th>
                  <th scope="col" className="py-2 px-2 font-semibold text-right">받은 분</th>
                  <th scope="col" className="py-2 px-2 font-semibold text-right">산 분</th>
                  <th scope="col" className="py-2 px-2 font-semibold text-right">매출</th>
                  <th scope="col" className="py-2 px-2 font-semibold text-right">문자 비용</th>
                  <th scope="col" className="py-2 px-2 font-semibold w-[168px]">문자 1원당 매출</th>
                  <th scope="col" className="py-2 pl-2"><span className="sr-only">보내기</span></th>
                </tr>
              </thead>
              <tbody>
                {data.groups.map((g) => (
                  <tr key={g.group} className="border-b border-slate-100 last:border-0">
                    <td className="py-2.5 pr-3">
                      <div className="font-semibold text-slate-900 break-keep">{g.name}</div>
                      <div className="text-[12px] text-slate-500 break-keep">{g.desc}</div>
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{num(g.recipients)}명</td>
                    {g.buyers === null ? (
                      <td colSpan={4} className="py-2.5 px-2 text-[12.5px] text-slate-500 break-keep">받은 분이 {data.minN}명이 되면 보여 드려요</td>
                    ) : (
                      <>
                        <td className="py-2.5 px-2 text-right tabular-nums">{num(g.buyers)}명</td>
                        <td className="py-2.5 px-2 text-right tabular-nums font-semibold text-slate-900">{num(g.revenue ?? 0)}원</td>
                        <td className="py-2.5 px-2 text-right tabular-nums">{num(g.cost ?? 0)}원</td>
                        <td className="py-2.5 px-2">
                          <span className="block font-bold tabular-nums text-emerald-700">{g.perWon === null ? '—' : perWonText(g.perWon)}</span>
                          <Bar g={g} />
                        </td>
                      </>
                    )}
                    <td className="py-2.5 pl-2 text-right"><SendButton g={g} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* 좁은 화면 = 카드(줄마다 두 줄로 접는다) */}
          <ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 lg:hidden">
            {data.groups.map((g) => (
              <li key={g.group} className="flex flex-col rounded-xl border border-slate-200 p-3">
                <div className="font-semibold text-[14px] text-slate-900 break-keep">{g.name}</div>
                <div className="text-[12px] text-slate-500 break-keep">{g.desc}</div>
                {g.buyers === null ? (
                  <p className="mt-2 text-[12.5px] text-slate-500 break-keep">받은 분 {num(g.recipients)}명 · {data.minN}명이 되면 보여 드려요</p>
                ) : (
                  <>
                    <div className="mt-2 flex items-baseline justify-between gap-2">
                      <span className="text-[12px] text-slate-500">문자 1원당 매출</span>
                      <span className="text-[16px] font-bold tabular-nums text-emerald-700">{g.perWon === null ? '—' : perWonText(g.perWon)}</span>
                    </div>
                    <Bar g={g} />
                    <p className="mt-2 text-[12px] leading-[1.6] text-slate-600 break-keep">
                      받은 분 {num(g.recipients)}명 · 산 분 {num(g.buyers)}명 · 매출 {num(g.revenue ?? 0)}원 · 문자 비용 {num(g.cost ?? 0)}원
                    </p>
                  </>
                )}
                <div className="mt-3 pt-0.5"><SendButton g={g} /></div>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-2 text-[11px] leading-[1.6] text-slate-400 break-keep">
        같은 분이 여러 발송을 받았으면 발송마다 셌어요 · 구매 하나는 그 앞에 받은 가장 늦은 발송 하나에만 셉니다
        {data.unknown > 0 ? ` · 묶음을 정하지 못한 ${num(data.unknown)}명은 뺐어요` : ''}
      </p>
    </section>
  );
}
