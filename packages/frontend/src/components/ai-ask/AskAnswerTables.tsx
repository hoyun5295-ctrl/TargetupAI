/**
 * 답에 붙는 표 묶음(★ 2026-11-22 C155 — AiAskPage 답 화면에서 옮겨 온 조각 + 표 위 막대 그래프 · 설계서 §3)
 *
 * 표 = 서버가 준 글자 표 그대로(숫자의 근거) · 그 위에 숫자 열로 그린 막대(있을 때만).
 * sendable = 가장 늦은 답의 표인가 — 「이 묶음에게 보내기」는 그 표에만 둔다(지난 답의 숫자로 보내지 않게 · 설계서 D7).
 */
import type { AskGroupKey, AskTable } from '../../utils/ai-ask';
import AskBarChart from './AskBarChart';

export default function AskAnswerTables({ tables, sendable, ready, onSend }: {
  tables: AskTable[];
  sendable: boolean;
  ready: boolean;
  onSend: (group: AskGroupKey) => void;
}) {
  return (
    <div className="mt-5 grid grid-cols-1 gap-4 min-[900px]:grid-cols-2">
      {tables.map((t) => {
        const keys = sendable ? t.groupKeys : undefined;
        return (
          <section key={t.key} className={`min-w-0 rounded-2xl border border-[#E5E8EB] p-4 ${t.key === 'groups' ? 'min-[900px]:col-span-2' : ''}`} aria-label={t.title}>
            <h2 className="text-[13.5px] font-bold">{t.title}</h2>
            {t.chart && <AskBarChart chart={t.chart} title={t.title} />}
            {/* 좁은 화면의 고객 묶음 = 줄마다 카드(이름 · 숫자 · 단추 · 4칸 표는 폭 375 에서 숫자가 잘려 접혔다 · 폭 훑기 실측) */}
            {t.groupKeys && (
              <ul className="mt-3 grid gap-2 sm:hidden">
                {t.rows.map((r, ri) => (
                  <li key={ri} className="rounded-xl bg-[#F9FAFB] p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <b className="text-[14px] font-bold">{r[0]}</b>
                      <span className="shrink-0 whitespace-nowrap text-[13.5px] font-bold tabular-nums">{r[1]}</span>
                    </div>
                    {r.slice(2).map((cell, ci) => cell !== '—' && (
                      <p key={ci} className="mt-0.5 text-[12.5px] text-[#636D7A]">{t.columns[ci + 2]} <span className="whitespace-nowrap tabular-nums">{cell}</span></p>
                    ))}
                    {keys && (
                      <button type="button" disabled={!ready} onClick={() => onSend(keys[ri])}
                        className="mt-2 h-9 w-full rounded-lg bg-[#191F28] text-[13px] font-bold text-white hover:bg-[#333D4B] disabled:opacity-50">
                        이 묶음에게 보내기
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <table className={`mt-3 w-full text-[13px] ${t.groupKeys ? 'hidden sm:table' : ''}`}>
              <thead>
                <tr className="border-b border-[#E5E8EB] text-left text-[12px] text-[#636D7A]">
                  {t.columns.map((c, ci) => <th key={c} scope="col" className={`py-1.5 font-semibold ${ci === 0 ? 'pr-2' : 'whitespace-nowrap px-2 text-right'}`}>{c}</th>)}
                  {keys && <th scope="col" className="py-1.5 pl-2 text-right font-semibold"><span className="sr-only">보내기</span></th>}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((r, ri) => (
                  <tr key={ri} className="border-b border-[#F2F4F6] last:border-0">
                    {r.map((cell, ci) => <td key={ci} className={`py-2 ${ci === 0 ? 'pr-2 font-semibold' : 'whitespace-nowrap px-2 text-right tabular-nums'}`}>{cell}</td>)}
                    {keys && (
                      <td className="py-1.5 pl-2 text-right">
                        <button type="button" disabled={!ready} onClick={() => onSend(keys[ri])}
                          className="h-8 whitespace-nowrap rounded-lg bg-[#191F28] px-3 text-[12.5px] font-bold text-white hover:bg-[#333D4B] disabled:opacity-50">
                          이 묶음에게 보내기
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
