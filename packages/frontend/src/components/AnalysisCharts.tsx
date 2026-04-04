/**
 * D108: AI 분석 시각화 차트 컴포넌트
 * 순수 SVG + CSS. 외부 차트 라이브러리 없음.
 */

/* ─── 가로 바 차트 (채널별 성공률) ─── */
export function HorizontalBarChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="space-y-2.5">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="text-xs text-gray-500 w-12 text-right shrink-0">{d.label}</span>
          <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden relative">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out flex items-center justify-end pr-2"
              style={{ width: `${Math.max((d.value / max) * 100, 4)}%`, backgroundColor: d.color }}
            >
              <span className="text-[10px] font-bold text-white drop-shadow-sm">{d.value.toFixed(1)}%</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── 히트맵 그리드 (요일 x 시간대) ─── */
const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

export function HeatmapGrid({ data }: { data: { day: number; hour: number; rate: number }[] }) {
  const maxRate = Math.max(...data.map(d => d.rate), 1);
  const getColor = (rate: number) => {
    if (rate === 0) return 'bg-gray-100';
    const intensity = rate / maxRate;
    if (intensity > 0.8) return 'bg-emerald-500';
    if (intensity > 0.6) return 'bg-emerald-400';
    if (intensity > 0.4) return 'bg-emerald-300';
    if (intensity > 0.2) return 'bg-emerald-200';
    return 'bg-emerald-100';
  };
  const getRateAt = (day: number, hour: number) => data.find(d => d.day === day && d.hour === hour)?.rate || 0;

  // 주요 시간대만 (6~23시)
  const hours = Array.from({ length: 18 }, (_, i) => i + 6);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[480px]">
        <div className="flex gap-0.5 mb-1">
          <div className="w-6" />
          {hours.map(h => (
            <div key={h} className="flex-1 text-[8px] text-gray-400 text-center">{h}</div>
          ))}
        </div>
        {DAY_LABELS.map((label, day) => (
          <div key={day} className="flex gap-0.5 mb-0.5">
            <div className="w-6 text-[10px] text-gray-500 flex items-center justify-center">{label}</div>
            {hours.map(hour => {
              const rate = getRateAt(day, hour);
              return (
                <div
                  key={hour}
                  className={`flex-1 h-5 rounded-sm ${getColor(rate)} transition-colors`}
                  title={`${label}요일 ${hour}시: ${rate.toFixed(1)}%`}
                />
              );
            })}
          </div>
        ))}
        <div className="flex items-center justify-end gap-1.5 mt-2">
          <span className="text-[9px] text-gray-400">낮음</span>
          {['bg-gray-100', 'bg-emerald-100', 'bg-emerald-200', 'bg-emerald-300', 'bg-emerald-400', 'bg-emerald-500'].map((c, i) => (
            <div key={i} className={`w-3 h-3 rounded-sm ${c}`} />
          ))}
          <span className="text-[9px] text-gray-400">높음</span>
        </div>
      </div>
    </div>
  );
}

/* ─── 도넛 차트 (채널별 비율) ─── */
export function DonutChart({ data, centerLabel }: { data: { label: string; value: number; color: string }[]; centerLabel: string }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const size = 140;
  const strokeWidth = 24;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let accumulated = 0;

  return (
    <div className="flex items-center gap-6">
      <svg width={size} height={size} className="shrink-0">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#f3f4f6" strokeWidth={strokeWidth} />
        {data.map((d, i) => {
          const pct = d.value / total;
          const dashArray = `${pct * circumference} ${circumference}`;
          const rotation = (accumulated * 360) - 90;
          accumulated += pct;
          return (
            <circle
              key={i}
              cx={size / 2} cy={size / 2} r={radius}
              fill="none" stroke={d.color} strokeWidth={strokeWidth}
              strokeDasharray={dashArray}
              transform={`rotate(${rotation} ${size / 2} ${size / 2})`}
              className="transition-all duration-700"
            />
          );
        })}
        <text x={size / 2} y={size / 2 - 6} textAnchor="middle" className="text-xs fill-gray-400">총 발송</text>
        <text x={size / 2} y={size / 2 + 12} textAnchor="middle" className="text-sm font-bold fill-gray-800">{total.toLocaleString()}</text>
      </svg>
      <div className="space-y-2">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
            <span className="text-xs text-gray-600">{d.label}</span>
            <span className="text-xs font-semibold text-gray-800">{d.value.toLocaleString()}건</span>
            <span className="text-[10px] text-gray-400">({((d.value / total) * 100).toFixed(1)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── 수평 스택 바 (성별/등급 비율) ─── */
export function StackBar({ data, label }: { data: { label: string; value: number; color: string }[]; label: string }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1.5">{label}</div>
      <div className="flex h-7 rounded-full overflow-hidden bg-gray-100">
        {data.map((d, i) => (
          <div
            key={i}
            className="flex items-center justify-center transition-all duration-700"
            style={{ width: `${Math.max((d.value / total) * 100, 2)}%`, backgroundColor: d.color }}
          >
            {(d.value / total) > 0.1 && (
              <span className="text-[9px] font-bold text-white drop-shadow-sm">{d.label} {((d.value / total) * 100).toFixed(0)}%</span>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-3 mt-1.5">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
            <span className="text-[10px] text-gray-500">{d.label}: {d.value.toLocaleString()}명</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── 미니 라인 차트 (수신거부 추이) ─── */
export function MiniLineChart({ data }: { data: { month: string; value: number }[] }) {
  if (data.length < 2) return <div className="text-xs text-gray-400 py-4 text-center">데이터 부족</div>;
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const width = 320;
  const height = 80;
  const padding = { top: 8, right: 16, bottom: 20, left: 16 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const points = data.map((d, i) => ({
    x: padding.left + (i / (data.length - 1)) * plotW,
    y: padding.top + plotH - (d.value / maxVal) * plotH,
  }));
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - padding.bottom} L ${points[0].x} ${height - padding.bottom} Z`;

  return (
    <svg width={width} height={height} className="w-full">
      <defs>
        <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#lineGrad)" />
      <path d={linePath} fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="3" fill="#ef4444" stroke="white" strokeWidth="1.5" />
          <text x={p.x} y={height - 4} textAnchor="middle" className="text-[8px] fill-gray-400">{data[i].month}</text>
          <text x={p.x} y={p.y - 8} textAnchor="middle" className="text-[9px] fill-gray-600 font-semibold">{data[i].value}</text>
        </g>
      ))}
    </svg>
  );
}

/* ─── 스코어카드 (종합 점수) ─── */
export function ScoreCard({ score, grade, highlights }: { score: number; grade: string; highlights: string[] }) {
  const getGradeColor = (g: string) => {
    if (g === 'S' || g === 'A+') return { bg: 'bg-emerald-100', text: 'text-emerald-700', ring: 'ring-emerald-300' };
    if (g === 'A' || g === 'B+') return { bg: 'bg-blue-100', text: 'text-blue-700', ring: 'ring-blue-300' };
    if (g === 'B') return { bg: 'bg-amber-100', text: 'text-amber-700', ring: 'ring-amber-300' };
    return { bg: 'bg-red-100', text: 'text-red-700', ring: 'ring-red-300' };
  };
  const colors = getGradeColor(grade);
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="flex items-center gap-6">
      <div className="relative w-24 h-24 shrink-0">
        <svg width="96" height="96" className="transform -rotate-90">
          <circle cx="48" cy="48" r="40" fill="none" stroke="#f3f4f6" strokeWidth="8" />
          <circle cx="48" cy="48" r="40" fill="none" stroke={score >= 80 ? '#10b981' : score >= 60 ? '#3b82f6' : score >= 40 ? '#f59e0b' : '#ef4444'} strokeWidth="8" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} className="transition-all duration-1000" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-gray-800">{score}</span>
          <span className="text-[9px] text-gray-400">/ 100</span>
        </div>
      </div>
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className={`px-2.5 py-1 rounded-lg text-sm font-bold ${colors.bg} ${colors.text} ring-1 ${colors.ring}`}>{grade}</span>
          <span className="text-xs text-gray-500">종합 등급</span>
        </div>
        <ul className="space-y-1">
          {highlights.slice(0, 3).map((h, i) => (
            <li key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
              <span className="text-emerald-500 mt-0.5">&#9679;</span>
              {h}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ─── RFM 매트릭스 (2x2 그리드) ─── */
export function RfmMatrix({ segments }: { segments: { name: string; count: number; description: string; color: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {segments.map((seg, i) => (
        <div key={i} className="rounded-xl p-3 border" style={{ borderColor: seg.color + '40', backgroundColor: seg.color + '08' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold" style={{ color: seg.color }}>{seg.name}</span>
            <span className="text-sm font-bold text-gray-800">{seg.count.toLocaleString()}명</span>
          </div>
          <p className="text-[10px] text-gray-500 leading-relaxed">{seg.description}</p>
        </div>
      ))}
    </div>
  );
}

/* ─── 퍼널 차트 (발송→성공→구매전환) ─── */
export function FunnelChart({ steps }: { steps: { label: string; value: number; color: string }[] }) {
  const maxVal = steps[0]?.value || 1;
  return (
    <div className="space-y-1.5">
      {steps.map((step, i) => {
        const widthPct = Math.max((step.value / maxVal) * 100, 12);
        const conversionRate = i > 0 ? ((step.value / (steps[i - 1]?.value || 1)) * 100).toFixed(1) : null;
        return (
          <div key={i}>
            {conversionRate && (
              <div className="text-center text-[9px] text-gray-400 mb-0.5">
                ↓ {conversionRate}%
              </div>
            )}
            <div className="flex items-center gap-3">
              <div className="w-16 text-right text-xs text-gray-500 shrink-0">{step.label}</div>
              <div className="flex-1 flex justify-center">
                <div
                  className="h-8 rounded-lg flex items-center justify-center transition-all duration-700"
                  style={{ width: `${widthPct}%`, backgroundColor: step.color }}
                >
                  <span className="text-[10px] font-bold text-white drop-shadow-sm">{step.value.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── 액션 플랜 타임라인 카드 (BUSINESS 전용) ─── */
export function ActionTimeline({ actions, onAction }: {
  actions: { title: string; target: string; timing: string; prompt?: string }[];
  onAction?: (prompt: string) => void;
}) {
  return (
    <div className="space-y-3">
      {actions.map((action, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className="w-7 h-7 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center text-xs font-bold shrink-0">
              {i + 1}
            </div>
            {i < actions.length - 1 && <div className="w-px flex-1 bg-pink-200 mt-1" />}
          </div>
          <div className="flex-1 pb-3">
            <div className="font-semibold text-sm text-gray-800">{action.title}</div>
            <div className="text-xs text-gray-500 mt-0.5">{action.target} · {action.timing}</div>
            {action.prompt && onAction && (
              <button
                onClick={() => onAction(action.prompt!)}
                className="mt-2 px-3 py-1.5 text-xs font-medium text-pink-700 bg-pink-50 hover:bg-pink-100 border border-pink-200 rounded-lg transition-colors"
              >
                이 타겟으로 캠페인 만들기 →
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
