// 실행 중인 자동마케팅 관리 — 오퍼레이터 목록 + 예산 + 지금 실행/수정/중단 (2026-06-27)
import { Clock, Play, Edit2, Trash2, AlertCircle, Plus } from 'lucide-react';
import { ContinuousOperator, won } from './types';
import StatusBadge from './StatusBadge';

interface Props {
  operators: ContinuousOperator[];
  onRunNow: (id: string) => void;
  onEdit: (op: ContinuousOperator) => void;
  onDelete: (id: string) => void;
  onCreate: () => void;
}

const POLICY_LABEL: Record<string, string> = { daily: '매일', weekly: '매주', monthly: '매월', yearly: '매년' };

export default function OperatorsManageList({ operators, onRunNow, onEdit, onDelete, onCreate }: Props) {
  if (operators.length === 0) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-xl p-12 text-center text-sm text-white/50">
        실행 중인 자동 마케팅이 없습니다.
        <div className="text-xs text-white/40 mt-2">마케팅 목표를 한 줄로 입력하면 AI가 매일 새 캠페인을 추천해드립니다.</div>
        <button onClick={onCreate} className="mt-4 px-4 py-2 bg-indigo-500/30 hover:bg-indigo-500/50 text-indigo-50 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border border-indigo-400/30 transition-colors">
          <Plus className="w-3.5 h-3.5" />새 자동 마케팅 만들기
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {operators.map((op) => {
        const monthSpent = op.budgetSpentMonth || 0;
        const monthBudget = op.budgetMonthly || 0;
        const monthPct = monthBudget > 0 ? (monthSpent / monthBudget) * 100 : 0;
        const threshold = op.budgetAlertThreshold || 80;
        const isAlert = monthBudget > 0 && monthPct >= threshold;
        const isOver = monthBudget > 0 && monthPct >= 100;
        return (
          <div key={op.id} className="bg-white/5 border border-white/10 rounded-xl p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <div className="text-base font-semibold text-white">{op.name}</div>
                  <StatusBadge status={op.status} />
                </div>
                <div className="text-sm text-white/70 mb-2">{op.objective}</div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/50">
                  <span><Clock className="w-3 h-3 inline" /> {POLICY_LABEL[op.schedule] || op.schedule}{op.schedule === 'yearly' && op.scheduleMonth ? ` ${op.scheduleMonth}월 ${op.scheduleDayOfMonth ?? 1}일` : ''} {op.scheduleTime} (KST)</span>
                  <span>·</span>
                  <span>다음 실행 {op.nextRunAt ? new Date(op.nextRunAt).toLocaleString('ko-KR') : '-'}</span>
                  <span>·</span>
                  <span>제안 {op.totalProposals}건 (승인 {op.totalApproved} / 거부 {op.totalRejected} / 자동 {op.totalAutoExecuted})</span>
                </div>

                {monthBudget > 0 && (
                  <div className="mt-3 p-2.5 bg-slate-950/40 border border-white/10 rounded-lg">
                    <div className="flex items-center justify-between text-[11px] mb-1.5">
                      <span className={isOver ? 'text-rose-300 font-semibold' : isAlert ? 'text-amber-300 font-semibold' : 'text-white/60'}>이번 달 예산 사용</span>
                      <span className="text-white/70 font-mono tabular-nums">{won(monthSpent)} / {won(monthBudget)} ({monthPct.toFixed(0)}%)</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div className={`h-full ${isOver ? 'bg-rose-400' : isAlert ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${Math.min(100, monthPct)}%` }} />
                    </div>
                    {isOver && <div className="mt-1.5 text-[10px] text-rose-300 flex items-center gap-1"><AlertCircle className="w-2.5 h-2.5" /> 월 예산 초과: 새 제안 생성 자동 차단</div>}
                    {!isOver && isAlert && <div className="mt-1.5 text-[10px] text-amber-300 flex items-center gap-1"><AlertCircle className="w-2.5 h-2.5" /> 알림 임계값 {threshold}% 도달</div>}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1.5 shrink-0">
                <button onClick={() => onRunNow(op.id)} className="text-xs bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 px-2 py-1 rounded flex items-center gap-1 border border-indigo-400/30 transition-colors">
                  <Play className="w-3 h-3" /> 지금 실행
                </button>
                <button onClick={() => onEdit(op)} className="text-xs text-white/70 hover:bg-white/10 px-2 py-1 rounded flex items-center gap-1 border border-white/10 transition-colors">
                  <Edit2 className="w-3 h-3" /> 수정
                </button>
                <button onClick={() => onDelete(op.id)} className="text-xs text-rose-300 hover:bg-rose-500/20 px-2 py-1 rounded flex items-center gap-1 border border-rose-400/30 transition-colors">
                  <Trash2 className="w-3 h-3" /> 중단
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
