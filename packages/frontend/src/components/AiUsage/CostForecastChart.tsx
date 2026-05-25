/**
 * CostForecastChart.tsx — AI 사용량 비용 예측 라인 차트 (D217+ 2026-05-25)
 *
 * 옛 30일 실제 + 향후 30일 예측 (선형 회귀 — backend forecast endpoint).
 * 월 한도 수평 dashed line 시각화.
 *
 * SVG 직접 구현 — recharts 의존 X (단일 차트 + 다크 톤 정합 우선).
 */

import { useMemo } from 'react';
import { TrendingUp, AlertTriangle } from 'lucide-react';

export interface ForecastPoint {
  date: string;
  predicted_calls: number;
  predicted_cost: number;
  is_forecast: boolean;
}

interface Props {
  forecast: ForecastPoint[];
  monthlyLimit: number | null;
  loading: boolean;
}

const W = 720;
const H = 220;
const PADDING_LEFT = 50;
const PADDING_RIGHT = 20;
const PADDING_TOP = 20;
const PADDING_BOTTOM = 40;

export default function CostForecastChart({ forecast, monthlyLimit, loading }: Props) {
  const stats = useMemo(() => {
    if (forecast.length === 0) return null;
    const maxCalls = Math.max(
      ...forecast.map((p) => p.predicted_calls),
      monthlyLimit !== null ? monthlyLimit / 30 : 0,
      1,
    );
    const yMax = Math.ceil(maxCalls * 1.2);
    const chartW = W - PADDING_LEFT - PADDING_RIGHT;
    const chartH = H - PADDING_TOP - PADDING_BOTTOM;
    const stepX = chartW / Math.max(1, forecast.length - 1);

    const actualPoints: Array<{ x: number; y: number; data: ForecastPoint }> = [];
    const forecastPoints: Array<{ x: number; y: number; data: ForecastPoint }> = [];
    forecast.forEach((p, i) => {
      const x = PADDING_LEFT + i * stepX;
      const y = PADDING_TOP + chartH - (p.predicted_calls / yMax) * chartH;
      const point = { x, y, data: p };
      if (p.is_forecast) {
        forecastPoints.push(point);
      } else {
        actualPoints.push(point);
      }
    });

    // 옛 → 예측 전환점 (선 연결)
    const transitionIdx = forecast.findIndex((p) => p.is_forecast);
    let bridgePath = '';
    if (transitionIdx > 0 && transitionIdx < forecast.length) {
      const prev = actualPoints[actualPoints.length - 1];
      const next = forecastPoints[0];
      if (prev && next) bridgePath = `M ${prev.x} ${prev.y} L ${next.x} ${next.y}`;
    }

    const actualPath = actualPoints.length > 0
      ? 'M ' + actualPoints.map((p) => `${p.x} ${p.y}`).join(' L ')
      : '';
    const forecastPath = forecastPoints.length > 0
      ? 'M ' + forecastPoints.map((p) => `${p.x} ${p.y}`).join(' L ')
      : '';

    // 한도 일평균 line
    const limitDaily = monthlyLimit !== null ? monthlyLimit / 30 : null;
    const limitY = limitDaily !== null
      ? PADDING_TOP + chartH - (limitDaily / yMax) * chartH
      : null;

    // 한도 도달 예측 시점
    let limitReachedIdx: number | null = null;
    if (limitDaily !== null) {
      for (let i = 0; i < forecast.length; i++) {
        if (forecast[i].is_forecast && forecast[i].predicted_calls >= limitDaily) {
          limitReachedIdx = i;
          break;
        }
      }
    }
    const limitReachedDate = limitReachedIdx !== null ? forecast[limitReachedIdx].date : null;

    // y축 눈금 5개
    const yTicks: Array<{ value: number; y: number }> = [];
    for (let t = 0; t <= 4; t++) {
      const value = Math.round((yMax / 4) * t);
      const y = PADDING_TOP + chartH - (t / 4) * chartH;
      yTicks.push({ value, y });
    }

    // x축 눈금 (5개 균등)
    const xTickCount = 6;
    const xTicks: Array<{ x: number; label: string }> = [];
    for (let t = 0; t < xTickCount; t++) {
      const idx = Math.round(((forecast.length - 1) / (xTickCount - 1)) * t);
      const point = forecast[idx];
      if (point) {
        xTicks.push({
          x: PADDING_LEFT + idx * stepX,
          label: point.date.slice(5),
        });
      }
    }

    return {
      yMax,
      actualPath,
      forecastPath,
      bridgePath,
      actualPoints,
      forecastPoints,
      limitY,
      limitDaily,
      limitReachedDate,
      yTicks,
      xTicks,
    };
  }, [forecast, monthlyLimit]);

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-white/40">
        <div className="text-sm">예측 계산 중...</div>
      </div>
    );
  }

  if (!stats || forecast.length === 0) {
    return (
      <div className="text-center py-10 text-white/40 text-sm">
        예측할 호출 데이터가 부족합니다.
        <br />
        <span className="text-xs">AI 호출이 누적되면 향후 30일 예측을 제공합니다.</span>
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: '600px' }}>
          {/* y축 눈금 + 그리드 */}
          {stats.yTicks.map((t, i) => (
            <g key={`y-${i}`}>
              <line
                x1={PADDING_LEFT}
                y1={t.y}
                x2={W - PADDING_RIGHT}
                y2={t.y}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="1"
              />
              <text
                x={PADDING_LEFT - 8}
                y={t.y + 4}
                textAnchor="end"
                className="fill-white/40"
                style={{ fontSize: '10px' }}
              >
                {t.value.toLocaleString()}
              </text>
            </g>
          ))}

          {/* 한도 line */}
          {stats.limitY !== null && (
            <g>
              <line
                x1={PADDING_LEFT}
                y1={stats.limitY}
                x2={W - PADDING_RIGHT}
                y2={stats.limitY}
                stroke="#fb7185"
                strokeWidth="1.5"
                strokeDasharray="6 4"
              />
              <text
                x={W - PADDING_RIGHT}
                y={stats.limitY - 4}
                textAnchor="end"
                className="fill-rose-300"
                style={{ fontSize: '10px', fontWeight: 600 }}
              >
                일평균 한도 ({Math.round(stats.limitDaily!).toLocaleString()}회)
              </text>
            </g>
          )}

          {/* 옛 데이터 line */}
          {stats.actualPath && (
            <path
              d={stats.actualPath}
              fill="none"
              stroke="#60a5fa"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* 전환 bridge */}
          {stats.bridgePath && (
            <path
              d={stats.bridgePath}
              fill="none"
              stroke="#94a3b8"
              strokeWidth="1.5"
              strokeDasharray="3 3"
            />
          )}

          {/* 예측 line */}
          {stats.forecastPath && (
            <path
              d={stats.forecastPath}
              fill="none"
              stroke="#a78bfa"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="5 3"
            />
          )}

          {/* 옛 데이터 점 */}
          {stats.actualPoints.map((p, i) => (
            <circle
              key={`actual-${i}`}
              cx={p.x}
              cy={p.y}
              r="2.5"
              fill="#60a5fa"
              className="hover:r-4 transition-all"
            >
              <title>{p.data.date} (실제): {p.data.predicted_calls.toLocaleString()}회</title>
            </circle>
          ))}

          {/* 예측 데이터 점 */}
          {stats.forecastPoints.map((p, i) => (
            <circle
              key={`forecast-${i}`}
              cx={p.x}
              cy={p.y}
              r="2"
              fill="#a78bfa"
              fillOpacity="0.7"
            >
              <title>{p.data.date} (예측): {p.data.predicted_calls.toLocaleString()}회</title>
            </circle>
          ))}

          {/* x축 눈금 */}
          {stats.xTicks.map((t, i) => (
            <text
              key={`x-${i}`}
              x={t.x}
              y={H - PADDING_BOTTOM + 16}
              textAnchor="middle"
              className="fill-white/40"
              style={{ fontSize: '10px' }}
            >
              {t.label}
            </text>
          ))}

          {/* 범례 */}
          <g transform={`translate(${PADDING_LEFT}, ${H - 8})`}>
            <circle cx="4" cy="0" r="3" fill="#60a5fa" />
            <text x="12" y="3" className="fill-white/60" style={{ fontSize: '10px' }}>옛 30일 실제</text>
            <circle cx="100" cy="0" r="3" fill="#a78bfa" />
            <text x="108" y="3" className="fill-white/60" style={{ fontSize: '10px' }}>향후 30일 예측 (선형 회귀)</text>
          </g>
        </svg>
      </div>

      {/* 한도 도달 예측 경고 */}
      {stats.limitReachedDate && (
        <div className="mt-3 p-3 bg-rose-500/10 border border-rose-400/30 rounded-lg flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-300 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-white/80 leading-relaxed">
            <strong className="text-rose-200">한도 도달 예측:</strong> 현재 추세가 유지되면 <strong className="text-white">{stats.limitReachedDate}</strong> 경 일평균 한도를 초과할 가능성이 있습니다.
            Batch 처리 모드 전환 또는 한도 알림 설정을 권장합니다.
          </div>
        </div>
      )}

      {!stats.limitReachedDate && monthlyLimit !== null && (
        <div className="mt-3 p-3 bg-emerald-500/10 border border-emerald-400/30 rounded-lg flex items-start gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-300 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-white/80 leading-relaxed">
            <strong className="text-emerald-200">안정적 운영 중:</strong> 향후 30일 예측에서 일평균 한도 초과 시점이 발견되지 않았습니다.
          </div>
        </div>
      )}
    </div>
  );
}
