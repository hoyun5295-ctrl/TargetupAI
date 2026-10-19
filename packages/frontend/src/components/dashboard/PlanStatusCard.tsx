/**
 * PlanStatusCard.tsx — 대시보드 「요금제 현황」 칸 (★ 2026-10-19 Dashboard.tsx 에서 옮김 · docs/2026-10-19-dashboard-four-cards-design.md §2-1)
 *
 * 맨 앞 칸 · 돈은 이 칸 한 곳(Harold 1019 「요금제가 우측 하단에 쓸모없어 보인다」):
 *   AI 크레딧 · 이번 달 사용금액(옛 발송 현황 「총 사용금액」) · 충전 잔액(선불 · 이미 읽는 /api/balance 값) · 에이전트 발송 잔액(옛 발송 현황).
 * 요금제 이름 · 잠김 / 남은 날 / 체험 배지 · 주의 점 · 크레딧 상자 = 옛 칸 원본 그대로(글자 크기만 줄임).
 * 상태 · 창(크레딧 이력 · 잔액 현황)은 대시보드가 소유한다 · 이 부품은 모양과 콜백만.
 */
import { Sparkles } from 'lucide-react';
import CountUp from './CountUp';
import type { PrepaidTermView } from '../PrepaidTermCard';
import { dailyDbAnalysisCredits } from '../../constants/credit';
import { formatAgentIdLabel, formatAgentBalance } from '../../utils/agentLabel';
import { DASH_CARD, DashCardHead, DashHeadLink, DashSource, fmtInt } from './dash-card';

export interface PlanCardInfo {
  plan_name: string;
  plan_code: string;
  subscription_status: string;
  trial_expires_at: string;
  current_customers: number;
  prepaid_term?: PrepaidTermView | null;
}

export interface AgentBalanceRow { agentSendId: string; custName: string | null; remAmt: number | null }

export default function PlanStatusCard({
  planInfo, creditInfo, monthlyCost, balance, agentBalances, intro, enterClass, onOpenPricing, onOpenCreditHistory, onOpenBalance,
}: {
  planInfo: PlanCardInfo | null;
  creditInfo: { creditEnabled?: boolean; planCredits: number; purchased: number; total: number | string } | null;
  monthlyCost: number;
  balance: { billingType: string; balance: number } | null;
  agentBalances: AgentBalanceRow[];
  intro: boolean;
  enterClass: string;
  onOpenPricing: () => void;
  onOpenCreditHistory: () => void;
  onOpenBalance: () => void;
}) {
  const customers = Number(planInfo?.current_customers || 0);
  return (
    <div
      onClick={onOpenPricing}
      className={`${DASH_CARD} cursor-pointer hover:shadow-md transition-all ${enterClass}`}
      style={{ animationDelay: '60ms' }}
      data-card="plan"
    >
      <DashCardHead bar="bg-green-600" title="요금제 현황" right={<DashHeadLink label="요금제 안내" />} />
      {/* ★ CT-17: plan_name + D-N 뱃지 같은 줄 배치로 카드 높이 최소화 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-base font-bold text-gray-800">
          {planInfo?.prepaid_term?.state === 'blocked' ? planInfo.prepaid_term.plan_name : (planInfo?.plan_name || '로딩...')}
        </span>
        {/* ★ 2026-10-04 선불 요금제 이용 기간 — 잠김 / 남은 날(자동 연장이 꺼져 있고 7일 이하면 주황) */}
        {/* ★ 2026-10-10 대시보드 모션 I — 발송이 막혔거나(잠김) 곧 막히는(자동 연장 꺼짐 + 3일 이하) 때만 점이 두 번 퍼지고 멈춘다 */}
        {planInfo?.prepaid_term && (planInfo.prepaid_term.state === 'blocked' ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-rose-100 text-rose-700 text-[11px] font-bold rounded-full whitespace-nowrap">
            <span className="relative flex h-1.5 w-1.5" aria-hidden>
              <span className={`absolute inline-flex h-full w-full rounded-full bg-rose-400 ${intro ? 'motion-safe:animate-ping-twice' : ''}`} />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-rose-500" />
            </span>
            잠김
          </span>
        ) : (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold rounded-full whitespace-nowrap ${!planInfo.prepaid_term.auto_renew && planInfo.prepaid_term.days_left <= 7 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
            {!planInfo.prepaid_term.auto_renew && planInfo.prepaid_term.days_left <= 3 && (
              <span className="relative flex h-1.5 w-1.5" aria-hidden>
                <span className={`absolute inline-flex h-full w-full rounded-full bg-amber-400 ${intro ? 'motion-safe:animate-ping-twice' : ''}`} />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
              </span>
            )}
            {planInfo.prepaid_term.days_left <= 1 ? '오늘까지' : `${planInfo.prepaid_term.days_left}일 남음`}
          </span>
        ))}
        {/* 무료체험 중 → 요금제 만료 D-N 뱃지 (BASIC 체험 = plan=BASIC + status='trial') */}
        {planInfo?.subscription_status === 'trial' && planInfo?.trial_expires_at && (() => {
          const daysLeft = Math.max(0, Math.ceil((new Date(planInfo.trial_expires_at).getTime() - Date.now()) / 86400000));
          return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-100 text-violet-700 rounded-full">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-[11px] font-bold whitespace-nowrap">요금제 만료 D-{daysLeft}</span>
            </span>
          );
        })()}
        {/* 체험 만료 후 FREE 강등 마커 */}
        {planInfo?.subscription_status === 'trial_expired' && (
          <span className="px-2 py-0.5 bg-red-100 text-red-600 text-[11px] font-bold rounded-full whitespace-nowrap">체험 만료</span>
        )}
      </div>

      {/* AI 크레딧 — 클릭 시 이력 창(카드 이동과 분리) */}
      {creditInfo?.creditEnabled && (creditInfo.planCredits > 0 || creditInfo.purchased > 0) ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenCreditHistory(); }}
          className="mt-2.5 w-full rounded-xl border border-violet-100 bg-gradient-to-br from-violet-50 to-fuchsia-50/40 px-3 py-2.5 text-left transition-all hover:border-violet-200 hover:shadow-sm group"
        >
          <div className="flex items-center gap-1.5">
            <span className="flex h-4 w-4 items-center justify-center rounded bg-gradient-to-br from-violet-500 to-fuchsia-500">
              <Sparkles className="h-2.5 w-2.5 text-white" />
            </span>
            <span className="text-[11px] font-medium text-violet-700 whitespace-nowrap">AI 크레딧 잔여</span>
            <span className="ml-auto text-[11px] text-violet-400 group-hover:text-violet-600 transition-colors whitespace-nowrap">사용 이력 →</span>
          </div>
          <div className="mt-1 flex items-end gap-1">
            <span className="text-2xl font-bold tabular-nums text-violet-700"><CountUp value={Number(creditInfo.total || 0)} format={fmtInt} animate={intro} animateChanges /></span>
            <span className="mb-0.5 text-[11px] text-slate-400">크레딧</span>
          </div>
          {planInfo?.plan_code !== 'FREE' && (
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 border-t border-violet-100/70 pt-1.5 text-[11px] text-slate-400">
              <span className="whitespace-nowrap">고객 DB {customers.toLocaleString()}명</span>
              {dailyDbAnalysisCredits(customers) > 0 && (
                <span className="whitespace-nowrap">연동 시 매일 분석 <b className="text-violet-600">{dailyDbAnalysisCredits(customers)}크레딧</b></span>
              )}
            </div>
          )}
        </button>
      ) : planInfo?.plan_code !== 'FREE' ? (
        <div className="mt-2.5 text-xs text-gray-400">정상 이용 중</div>
      ) : null}

      {/* 돈 = 바닥 묶음 */}
      <div className="mt-auto pt-2.5 space-y-1.5">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-gradient-to-r from-gray-50 to-gray-50/40 px-3 py-2">
          <span className="text-xs text-gray-500 whitespace-nowrap">이번 달 사용금액</span>
          <span className="flex items-baseline gap-0.5 whitespace-nowrap">
            <b className="text-sm font-bold text-gray-800 tabular-nums"><CountUp value={monthlyCost} format={fmtInt} animate={intro} /></b>
            <span className="text-[11px] text-gray-400">원</span>
          </span>
        </div>
        {balance?.billingType === 'prepaid' && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenBalance(); }}
            className="w-full flex items-center justify-between gap-2 rounded-lg bg-gray-50 hover:bg-gray-100 px-3 py-2 text-left transition-colors"
          >
            <span className="text-xs text-gray-500 whitespace-nowrap">충전 잔액</span>
            <span className="flex items-baseline gap-0.5 whitespace-nowrap">
              <b className="text-sm font-bold text-gray-800 tabular-nums">{fmtInt(Number(balance.balance) || 0)}</b>
              <span className="text-[11px] text-gray-400">원</span>
              <span className="ml-1 text-[11px] text-gray-400">→</span>
            </span>
          </button>
        )}
        {/* ★ 2026-07-24 §5-2 에이전트 발송 잔액 — 선불 발송ID별 게이트웨이 실값 표시 (웹 잔액과 다른 지갑)
            ★ 2026-10-19 발송ID마다 한 줄(목업 그대로 · 머리 줄 없이) · 칸 높이가 다른 칸보다 크게 늘지 않게 */}
        {agentBalances.map((b) => (
          <div key={b.agentSendId} className="flex items-center justify-between gap-2 rounded-lg border border-emerald-100/80 bg-gradient-to-r from-emerald-50/60 to-teal-50/30 px-3 py-2">
            <span className="min-w-0 text-xs text-gray-500 break-keep break-words">
              에이전트 잔액 <span className="text-[10px] tabular-nums text-gray-400">{formatAgentIdLabel(b.agentSendId, b.custName)}</span>
            </span>
            {b.remAmt === null ? (
              <span className="shrink-0 text-[10px] text-gray-400 whitespace-nowrap">잔액 확인 불가</span>
            ) : (
              <span className={`shrink-0 text-sm font-bold tabular-nums whitespace-nowrap ${b.remAmt < 10000 ? 'text-rose-500' : 'text-gray-800'}`}>
                {formatAgentBalance(b.remAmt)}<span className="text-[10px] font-normal text-gray-400">원</span>
              </span>
            )}
          </div>
        ))}
      </div>
      {/* 출처는 한 줄로(칸마다 길이가 달라 줄 수가 늘면 그만큼 다른 칸이 빈다) */}
      <DashSource>요금제 · AI 크레딧 · 이번 달 발송 · 잔액</DashSource>
    </div>
  );
}
