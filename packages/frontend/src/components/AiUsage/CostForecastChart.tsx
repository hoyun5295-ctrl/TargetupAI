/**
 * CostForecastChart.tsx — AI 사용량 비용 예측 라인 차트 (D217+ 2026-05-25)
 *
 * 옛 30일 실제 + 향후 30일 예측 (선형 회귀 — backend forecast endpoint).
 * ★ 2026-11-01 월 AI 호출 수 한도 삭제 — 한도 선 · 한도 도달 예측을 지웠다(쓰는 양 = 크레딧).
 *
 * SVG 직접 구현 — recharts 의존 X (단일 차트 + 다크 톤 정합 우선).
 */

import { OUI_CHART_GRID } from '../../utils/operator-ui';
import { useMemo } from 'react';

export interface ForecastPoint {
  date: string;
  predicted_calls: number;
  predicted_cost: number;
  is_forecast: boolean;
}

interface Props {
  forecast: ForecastPoint[];
  loading: boolean;
}

const W = 720;
const H = 220;
const PADDING_LEFT = 50;
const PADDING_RIGHT = 20;
const PADDING_TOP = 20;
const PADDING_BOTTOM = 40;

export default function CostForecastChart({ forecast, loading }: Props) {
  const stats = useMemo(() => {
    if (forecast.length === 0) return null;
    const maxCalls = Math.max(...forecast.map((p) => p.predicted_calls), 1);
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
      yTicks,
      xTicks,
    };
  }, [forecast]);

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-slate-400">
        <div className="text-sm">예측 계산 중...</div>
      </div>
    );
  }

  if (!stats || forecast.length === 0) {
    return (
      <div className="text-center py-10 text-slate-400 text-sm">
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
                stroke={OUI_CHART_GRID}
                strokeWidth="1"
              />
              <text
                x={PADDING_LEFT - 8}
                y={t.y + 4}
                textAnchor="end"
                className="fill-slate-400"
                style={{ fontSize: '10px' }}
              >
                {t.value.toLocaleString()}
              </text>
            </g>
          ))}

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
              className="fill-slate-400"
              style={{ fontSize: '10px' }}
            >
              {t.label}
            </text>
          ))}

          {/* 범례 */}
          <g transform={`translate(${PADDING_LEFT}, ${H - 8})`}>
            <circle cx="4" cy="0" r="3" fill="#60a5fa" />
            <text x="12" y="3" className="fill-slate-500" style={{ fontSize: '10px' }}>옛 30일 실제</text>
            <circle cx="100" cy="0" r="3" fill="#a78bfa" />
            <text x="108" y="3" className="fill-slate-500" style={{ fontSize: '10px' }}>향후 30일 예측 (선형 회귀)</text>
          </g>
        </svg>
      </div>

    </div>
  );
}
