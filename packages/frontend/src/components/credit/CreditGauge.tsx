import { Sparkles, Zap, AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * CreditGauge — AI 크레딧 잔여 공용 게이지 (종량제 Phase 5).
 * 대시보드(light) / 요금제 페이지·관리자(dark) 양쪽에서 재사용.
 * 데이터 출처: GET /api/companies/my-credit (getCreditState + monthlyUsed).
 */
export interface CreditGaugeProps {
  total: number;
  baseRemaining: number;
  purchased: number;
  planCredits: number;
  monthlyUsed: number;
  resetAt?: string | null;
  billingType?: string;
  overageLimit?: number;
  variant?: 'light' | 'dark';
  compact?: boolean;
  onRecharge?: () => void;
}

/** 다음 월초(KST 근사)까지 남은 일수. */
function daysUntilReset(resetAt?: string | null): number | null {
  if (!resetAt) return null;
  const reset = new Date(resetAt);
  if (isNaN(reset.getTime())) return null;
  const next = new Date(reset.getFullYear(), reset.getMonth() + 1, 1);
  const diff = Math.ceil((next.getTime() - Date.now()) / 86400000);
  return diff > 0 ? diff : 0;
}

export default function CreditGauge({
  total, baseRemaining, purchased, planCredits, monthlyUsed,
  resetAt, billingType, overageLimit = 0, variant = 'dark', compact = false, onRecharge,
}: CreditGaugeProps) {
  const dark = variant === 'dark';
  const isLow = total <= 5;
  const isPostpaid = billingType === 'postpaid';
  const dleft = daysUntilReset(resetAt);

  const gaugeMax = Math.max(planCredits, total, 1);
  const basePct = Math.max(0, Math.min(100, (Math.max(0, baseRemaining) / gaugeMax) * 100));
  const purchasedPct = Math.max(0, Math.min(100 - basePct, (purchased / gaugeMax) * 100));

  const wrap = dark
    ? 'bg-slate-900/60 border border-white/10'
    : 'bg-white border border-violet-100 shadow-sm';
  const titleC = dark ? 'text-white/70' : 'text-slate-500';
  const bigC = dark ? 'text-white' : 'text-slate-900';
  const subC = dark ? 'text-white/50' : 'text-slate-400';
  const track = dark ? 'bg-white/10' : 'bg-violet-50';

  return (
    <div className={`rounded-2xl ${wrap} ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <span className={`text-xs font-medium ${titleC}`}>AI 크레딧 잔여</span>
        </div>
        {dleft != null && (
          <span className={`inline-flex items-center gap-1 text-[11px] ${subC}`}>
            <RefreshCw className="h-3 w-3" /> {dleft}일 후 충전
          </span>
        )}
      </div>

      <div className="mt-2 flex items-end gap-2">
        <span className={`font-bold tabular-nums ${bigC} ${compact ? 'text-2xl' : 'text-3xl'}`}>
          {total.toLocaleString()}
        </span>
        <span className={`mb-1 text-xs ${subC}`}>크레딧</span>
        {isLow && (
          <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-400">
            <AlertTriangle className="h-3 w-3" /> 잔여 부족
          </span>
        )}
      </div>

      {/* 기본분 + 구매분 게이지 */}
      <div className={`mt-3 h-2 w-full overflow-hidden rounded-full ${track}`}>
        <div className="flex h-full">
          <div className="h-full bg-violet-500" style={{ width: `${basePct}%` }} />
          <div className="h-full bg-fuchsia-400" style={{ width: `${purchasedPct}%` }} />
        </div>
      </div>
      <div className={`mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] ${subC}`}>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-violet-500" /> 기본분 {Math.max(0, baseRemaining).toLocaleString()}</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-fuchsia-400" /> 구매분 {purchased.toLocaleString()}</span>
        <span className="inline-flex items-center gap-1"><Zap className="h-3 w-3" /> 이번달 사용 {monthlyUsed.toLocaleString()}</span>
      </div>

      {isPostpaid && overageLimit > 0 && (
        <div className={`mt-2 text-[11px] ${subC}`}>후불 추가 사용 한도 {overageLimit.toLocaleString()} 크레딧</div>
      )}

      {onRecharge && (
        <button
          onClick={onRecharge}
          className={`mt-3 w-full rounded-xl py-2 text-xs font-semibold transition ${
            dark ? 'bg-violet-500/20 text-violet-200 hover:bg-violet-500/30' : 'bg-violet-600 text-white hover:bg-violet-700'
          }`}
        >
          크레딧 충전 문의
        </button>
      )}

      {!compact && (
        <p className={`mt-3 text-[10px] italic ${dark ? 'text-white/30' : 'text-slate-300'}`}>
          Data source: companies.ai_credits + ai_credit_transactions (이번달 차감 합)
        </p>
      )}
    </div>
  );
}
