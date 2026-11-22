/**
 * 답 화면의 막대 그래프(★ 2026-11-22 C155 · 설계서 docs/2026-11-22-c155-ask-answer-conversation-design.md §3-B)
 *
 * 표 위에 그리는 가로 막대. 숫자는 서버가 표와 같이 실어 준 숫자 열 그대로(글자를 다시 숫자로 읽지 않는다).
 * 재지 않은 값(null) = 막대 없이 「—」 · 0 = 길이 0 막대 + 「0」. 계열이 여럿이면(상품 = 조회 · 장바구니 · 구매) 이름마다 가는 막대를 차례로 쌓는다.
 * 막대는 CSS 로 그린다(폭 320 에서도 넘치지 않게 이름 칸 · 값 칸의 폭을 직접 쥔다). 숫자의 근거는 아래 표다 → 그래프는 그림 하나(role="img").
 */
import { askBarRows, type AskChart } from '../../utils/ai-ask';

/** 계열 색 = 검정 · 회색 · 주황 하나(화면 토큰) */
const FILL = ['bg-[#191F28]', 'bg-[#8B95A1]', 'bg-[#F97316]'] as const;

export default function AskBarChart({ chart, title }: { chart: AskChart; title: string }) {
  const { legend, rows } = askBarRows(chart);
  if (rows.length === 0) return null;
  const many = legend.length > 1;
  return (
    <div className="mt-2" role="img" aria-label={`${title} 그래프. 숫자는 아래 표에 있어요.`}>
      {many && (
        <ul className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-[#4E5968]" aria-hidden="true">
          {legend.map((name, i) => (
            <li key={name} className="inline-flex items-center gap-1.5">
              <i className={`h-2 w-2 rounded-sm ${FILL[i % FILL.length]}`} />{name}
            </li>
          ))}
        </ul>
      )}
      <ul className={`grid ${many ? 'gap-2.5' : 'gap-1.5'}`} aria-hidden="true">
        {rows.map((r, ri) => (
          <li key={ri} className="grid grid-cols-[minmax(0,34%)_minmax(0,1fr)] items-center gap-2.5">
            <span className="truncate text-[12.5px] font-semibold text-[#4E5968]">{r.label}</span>
            <span className="grid gap-[3px]">
              {r.cells.map((c, ci) => (
                <span key={ci} className="flex items-center gap-2">
                  <span className="h-[10px] min-w-0 flex-1 overflow-hidden rounded-full bg-[#F2F4F6]">
                    {c.pct !== null && <span className={`block h-full rounded-full ${FILL[ci % FILL.length]}`} style={{ width: `${c.pct}%` }} />}
                  </span>
                  <span className={`w-[64px] shrink-0 whitespace-nowrap text-right text-[12px] font-semibold tabular-nums ${c.pct === null ? 'text-[#8B95A1]' : 'text-[#191F28]'}`}>{c.text}</span>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
