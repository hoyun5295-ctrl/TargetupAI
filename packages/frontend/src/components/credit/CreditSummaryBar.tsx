import { Sparkles, Zap, AlertTriangle } from 'lucide-react';
import { CREDIT_TASK_COSTS } from '../../constants/credit';

/**
 * CreditSummaryBar — 요금제 페이지 상단 크레딧 요약 바 (종량제 D229+ UI 폴리시).
 * 좌측: 잔여 + 게이지(기본분·구매분) / 우측: 작업당 크레딧 칩 + 충전 문의.
 * 라이트 premium 톤(흰 배경 + violet 액센트), 모바일 세로 접힘.
 * 데이터: GET /api/companies/my-credit.
 */
export interface CreditSummaryBarProps {
  total: number;
  baseRemaining: number;
  purchased: number;
  planCredits: number;
  monthlyUsed: number;
  billingType?: string;
  overageLimit?: number;
  onRecharge?: () => void;
}

export default function CreditSummaryBar({
  total, baseRemaining, purchased, planCredits, monthlyUsed,
  billingType, overageLimit = 0, onRecharge,
}: CreditSummaryBarProps) {
  const isLow = total <= 5;
  const isPostpaid = billingType === 'postpaid';
  const gaugeMax = Math.max(planCredits, total, 1);
  const basePct = Math.max(0, Math.min(100, (Math.max(0, baseRemaining) / gaugeMax) * 100));
  const purchasedPct = Math.max(0, Math.min(100 - basePct, (purchased / gaugeMax) * 100));

  return (
    <div className="relative overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-sm">
      <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-violet-500 to-fuchsia-500" />
      <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:gap-6">
        {/* 좌: 잔여 + 게이지 */}
        <div className="lg:w-[42%] lg:flex-shrink-0 lg:border-r lg:border-violet-100 lg:pr-6">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <span className="text-xs font-medium text-slate-500">AI 크레딧 잔여</span>
            {isLow && (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-500">
                <AlertTriangle className="h-3 w-3" /> 잔여 부족
              </span>
            )}
          </div>
          <div className="mt-1 flex items-end gap-2">
            <span className="text-3xl font-bold tabular-nums text-slate-900">{Number(total).toLocaleString()}</span>
            <span className="mb-1 text-xs text-slate-400">크레딧</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-violet-50">
            <div className="flex h-full">
              <div className="h-full bg-violet-500" style={{ width: `${basePct}%` }} />
              <div className="h-full bg-fuchsia-400" style={{ width: `${purchasedPct}%` }} />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-violet-500" /> 기본 {Math.max(0, Number(baseRemaining)).toLocaleString()}</span>
            <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-fuchsia-400" /> 구매 {Number(purchased).toLocaleString()}</span>
            <span className="inline-flex items-center gap-1"><Zap className="h-3 w-3" /> 이번달 {Number(monthlyUsed).toLocaleString()}</span>
          </div>
          {isPostpaid && overageLimit > 0 && (
            <div className="mt-1 text-[11px] text-slate-400">후불 추가 한도 {Number(overageLimit).toLocaleString()} 크레딧</div>
          )}
        </div>

        {/* 우: 작업당 크레딧 칩 */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">작업당 크레딧</span>
            {onRecharge && (
              <button
                onClick={onRecharge}
                className="flex-shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700"
              >
                충전 문의
              </button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {CREDIT_TASK_COSTS.map(({ key, label, cost, icon: Icon }) => (
              <span
                key={key}
                className="inline-flex items-center gap-1.5 rounded-full border border-violet-100 bg-violet-50/60 py-1 pl-2.5 pr-1.5 text-xs text-slate-600"
              >
                <Icon className="h-3.5 w-3.5 text-violet-500" />
                {label}
                <b className="ml-0.5 rounded-full bg-white px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-violet-700 shadow-sm">{cost}</b>
              </span>
            ))}
          </div>
          <p className="mt-2.5 text-[11px] text-slate-400">성공한 작업만 차감 · 실패 시 미차감 · 스팸필터 테스트는 크레딧 무관</p>
        </div>
      </div>
    </div>
  );
}
