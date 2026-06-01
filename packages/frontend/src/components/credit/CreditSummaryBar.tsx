import { Sparkles, Zap } from 'lucide-react';
import { CREDIT_TASK_COSTS } from '../../constants/credit';

/**
 * CreditSummaryBar — 요금제 페이지 상단 요약 카드 (반반 구성).
 * 좌: 현재 요금제 + 고객 DB 사용량 게이지 / 우: AI 크레딧 잔여 + 작업당 6칩(3열 그리드).
 * 군더더기 어필 문구(성공만 차감·스팸 무관·종량제 띠) 제거 — 차감 내역은 이력 모달, 차등은 비교표가 보여줌.
 * 라이트 premium 톤(흰 배경 + violet 액센트), 모바일 세로 접힘. 데이터: GET /api/companies/my-credit.
 */
export interface CreditSummaryBarProps {
  // 좌 — 요금제 + DB
  planName: string;
  currentCustomers: number;
  maxCustomers: number;
  usagePercent: number;
  // 우 — 크레딧
  total: number;
  baseRemaining: number;
  purchased: number;
  planCredits: number;
  monthlyUsed: number;
  billingType?: string;
  overageLimit?: number;
  onRecharge?: () => void;
}

const fmt = (n: number) => Number(n || 0).toLocaleString();

export default function CreditSummaryBar({
  planName, currentCustomers, maxCustomers, usagePercent,
  total, baseRemaining, purchased, planCredits, monthlyUsed,
  billingType, overageLimit = 0, onRecharge,
}: CreditSummaryBarProps) {
  const isLow = total <= 5;
  const isPostpaid = billingType === 'postpaid';
  const gaugeMax = Math.max(planCredits, total, 1);
  const basePct = Math.max(0, Math.min(100, (Math.max(0, baseRemaining) / gaugeMax) * 100));
  const purchasedPct = Math.max(0, Math.min(100 - basePct, (purchased / gaugeMax) * 100));
  const remaining = Math.max(0, maxCustomers - currentCustomers);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-sm">
      <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-violet-500 to-fuchsia-500" />
      <div className="flex flex-col gap-6 p-6 lg:flex-row lg:items-stretch lg:gap-8">
        {/* 좌: 현재 요금제 + 고객 DB 사용량 */}
        <div className="lg:w-1/2 lg:flex-shrink-0 lg:border-r lg:border-violet-100 lg:pr-8">
          <div className="text-base font-medium text-slate-500">현재 이용 중인 플랜</div>
          <div className="mt-1 text-2xl font-bold text-violet-600">{planName}</div>
          <div className="mt-5 flex items-end justify-between gap-2">
            <span className="text-base font-medium text-slate-500">고객 DB 사용량</span>
            <span className="text-base font-semibold tabular-nums text-slate-900">
              {fmt(currentCustomers)} <span className="font-normal text-slate-400">/ {fmt(maxCustomers)}명</span>
            </span>
          </div>
          <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full transition-all ${usagePercent >= 90 ? 'bg-rose-500' : usagePercent >= 70 ? 'bg-amber-500' : 'bg-violet-500'}`}
              style={{ width: `${Math.min(100, usagePercent)}%` }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-slate-400">
            <span>{usagePercent.toFixed(1)}% 사용 중</span>
            <span>{fmt(remaining)}명 여유</span>
          </div>
        </div>

        {/* 우: AI 크레딧 잔여 + 작업당 6칩 */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <span className="text-base font-medium text-slate-500">AI 크레딧 잔여</span>
              {isLow && (
                <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-500">잔여 부족</span>
              )}
            </div>
            {onRecharge && (
              <button
                onClick={onRecharge}
                className="flex-shrink-0 rounded-lg bg-violet-600 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-violet-700"
              >
                충전 문의
              </button>
            )}
          </div>
          <div className="mt-1 flex items-end gap-2">
            <span className="text-3xl font-bold tabular-nums text-slate-900">{fmt(total)}</span>
            <span className="mb-1 text-sm text-slate-400">크레딧</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-violet-50">
            <div className="flex h-full">
              <div className="h-full bg-violet-500" style={{ width: `${basePct}%` }} />
              <div className="h-full bg-fuchsia-400" style={{ width: `${purchasedPct}%` }} />
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-violet-500" /> 기본 {fmt(Math.max(0, baseRemaining))}</span>
            <span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-fuchsia-400" /> 구매 {fmt(purchased)}</span>
            <span className="inline-flex items-center gap-1"><Zap className="h-3 w-3" /> 이번달 {fmt(monthlyUsed)}</span>
            {isPostpaid && overageLimit > 0 && <span>· 후불 한도 {fmt(overageLimit)}</span>}
          </div>

          {/* 작업당 크레딧 — 3열 그리드 정렬(라벨 좌 · 숫자 우, 세로 줄맞춤) */}
          <div className="mt-4 border-t border-slate-100 pt-3">
            <div className="text-base font-medium text-slate-500">작업당 크레딧</div>
            <div className="mt-2.5 grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3">
              {CREDIT_TASK_COSTS.map(({ key, label, cost, icon: Icon }) => (
                <div key={key} className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
                    <Icon className="h-4 w-4 flex-shrink-0 text-violet-500" />
                    {label}
                  </span>
                  <b className="text-sm font-bold tabular-nums text-violet-700">{cost}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
