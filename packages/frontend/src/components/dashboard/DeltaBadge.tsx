/**
 * DeltaBadge (D132 Phase A)
 *
 * 카드 하단에 표시되는 "30일 전 대비 증감" 뱃지.
 * 증가 → green / 감소 → red / 변화 없음 → gray
 * 디자인 토큰은 FileUploadMappingModal / PricingPage violet 톤 계승 (파스텔·심플·모던).
 *
 * Props:
 *   delta         — 증감 절대값 (음수 가능, null이면 미표시)
 *   deltaPercent  — % (소수점 1자리, null이면 값만 표시)
 *   baseline      — 비교 기준일 ISO (툴팁용, 생략 가능)
 *   suffix        — value 단위 ('명' | '원' | '%' 등, delta 표기에 사용)
 *   size          — 'sm' | 'md' (기본 sm)
 */
interface DeltaBadgeProps {
  delta: number | null;
  deltaPercent?: number | null;
  baseline?: string;
  suffix?: string;
  size?: 'sm' | 'md';
}

export default function DeltaBadge({ delta, deltaPercent, baseline, suffix = '', size = 'sm' }: DeltaBadgeProps) {
  if (delta === null || delta === undefined) return null;

  const isPositive = delta > 0;
  const isNegative = delta < 0;
  const isZero = delta === 0;

  const colorClass = isPositive
    ? 'bg-green-50 text-green-700 border-green-200'
    : isNegative
    ? 'bg-red-50 text-red-600 border-red-200'
    : 'bg-gray-100 text-gray-500 border-gray-200';

  const icon = isPositive ? '↑' : isNegative ? '↓' : '—';
  const sign = isPositive ? '+' : '';
  const absDelta = Math.abs(delta);

  // 숫자 포맷 (큰 금액은 1,000 단위 콤마)
  const formattedDelta = isZero
    ? '0'
    : `${sign}${delta.toLocaleString('ko-KR')}${suffix}`;

  const formattedPercent =
    deltaPercent === null || deltaPercent === undefined
      ? null
      : `${isPositive ? '+' : ''}${deltaPercent.toFixed(1)}%`;

  const baselineLabel = baseline
    ? (() => {
        try {
          const d = new Date(baseline);
          return `기준: ${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
        } catch {
          return '30일 전 대비';
        }
      })()
    : '30일 전 대비';

  const sizeClass =
    size === 'md'
      ? 'px-2 py-0.5 text-xs gap-1'
      : 'px-1.5 py-0.5 text-[10px] gap-0.5';

  return (
    <span
      title={baselineLabel}
      className={`inline-flex items-center rounded-md border font-semibold whitespace-nowrap ${colorClass} ${sizeClass}`}
    >
      <span className="text-[9px] leading-none">{icon}</span>
      <span>{formattedDelta}</span>
      {formattedPercent && <span className="opacity-80">({formattedPercent})</span>}
    </span>
  );
}
