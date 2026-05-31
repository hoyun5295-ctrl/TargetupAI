import React from 'react';
import { TrendingUp, Users, MessageSquare, Target, Sparkles, AlertCircle, CheckCircle2, BarChart3, Database } from 'lucide-react';

interface OperatorResultCardProps {
  result: any;
  onApprove?: () => void;
  onReject?: () => void;
}

/**
 * AI Operator 결과 카드 — orchestrate 응답 표시.
 * 성과 추정(performance) + 근거(basis.level 4종) + ROI 절대액 + 등급별 분해.
 * 데이터 기반 3계층(등급 실측 / 구매주기 / 데이터 부족) — 임의 추정치 미사용.
 */

// basis.level 4종 → 표시 메타
const LEVEL_META: Record<string, { badge: string; cls: string; Icon: any }> = {
  grade_actual: { badge: '등급별 실측', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', Icon: CheckCircle2 },
  campaign_actual: { badge: '발송 실측', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30', Icon: CheckCircle2 },
  purchase_cycle: { badge: '구매주기 기반', cls: 'bg-violet-500/15 text-violet-300 border-violet-500/30', Icon: BarChart3 },
  insufficient_data: { badge: '데이터 필요', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30', Icon: AlertCircle },
};

const CONFIDENCE_LABEL: Record<string, string> = { high: '신뢰도 높음', medium: '신뢰도 보통', low: '신뢰도 낮음' };

export default function OperatorResultCard({ result, onApprove, onReject }: OperatorResultCardProps) {
  if (!result) return null;
  const perf = result.performance || {};
  const basis = result.basis || {};
  const targeting = result.targeting || {};
  const cost = result.estimatedCost ?? result.cost?.estimated ?? 0;
  const revenue = perf.expectedRevenue ?? result.estimatedRevenue ?? 0;

  const level: string = basis.level || 'insufficient_data';
  const isInsufficient = level === 'insufficient_data';
  const meta = LEVEL_META[level] || LEVEL_META.insufficient_data;
  const breakdown: any[] = Array.isArray(basis.gradeBreakdown) ? basis.gradeBreakdown : [];

  const fmt = (n: any) => (typeof n === 'number' ? n.toLocaleString() : n ?? '-');
  const pct = (n: any) => (typeof n === 'number' ? `${(n * 100).toFixed(1)}%` : '-');
  // 투자 대비 배수 — 수만% ROI 비현실 표기 방지: 발송비 대비 예상 매출 절대 배수로 표시
  const multiple = cost > 0 && revenue > 0 ? revenue / cost : 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900 p-5 space-y-4">
      {/* 헤더 + 근거 레벨 배지 + 신뢰도 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-violet-400" />
          <h3 className="text-lg font-bold text-white">AI 분석 결과</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${meta.cls}`}>
            <meta.Icon className="w-3 h-3" /> {meta.badge}
          </span>
          {basis.confidence && (
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/60">
              {CONFIDENCE_LABEL[basis.confidence] || basis.confidence}
            </span>
          )}
        </div>
      </div>

      {/* 타겟 + 채널 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-slate-800/60 p-3">
          <div className="flex items-center gap-1.5 text-white/50 text-xs mb-1">
            <Users className="w-3.5 h-3.5" /> 타겟 고객
          </div>
          <div className="text-xl font-bold text-white">{fmt(targeting.estimatedCount)}명</div>
        </div>
        <div className="rounded-xl bg-slate-800/60 p-3">
          <div className="flex items-center gap-1.5 text-white/50 text-xs mb-1">
            <MessageSquare className="w-3.5 h-3.5" /> 채널
          </div>
          <div className="text-xl font-bold text-white">{targeting.channel || result.channel || 'SMS'}</div>
        </div>
      </div>

      {isInsufficient ? (
        /* 데이터 부족 — 가짜 숫자 대신 정직한 안내 (수치 미표시) */
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex items-center gap-1.5 text-amber-300 text-sm font-medium mb-1.5">
            <Database className="w-4 h-4" /> 정확한 예측을 위해 고객 데이터가 필요합니다
          </div>
          <p className="text-white/70 text-xs leading-relaxed">
            {basis.label || '고객의 구매횟수·구매일·등급 데이터를 넣으면 등급별 정밀 예측이 활성화됩니다.'}
          </p>
          {Array.isArray(basis.notes) && basis.notes.length > 0 && (
            <ul className="mt-2 space-y-1">
              {basis.notes.map((n: string, i: number) => (
                <li key={i} className="text-white/50 text-[11px] flex items-start gap-1">
                  <span className="text-amber-400 mt-0.5">·</span> {n}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          {/* 성과 추정 — 전환 / 매출 / 투자 대비 (행사기간 기준 명시) */}
          <div className="rounded-xl bg-gradient-to-br from-violet-600/20 to-fuchsia-600/20 border border-violet-500/20 p-4">
            <div className="flex items-center gap-1.5 text-violet-300 text-xs mb-3">
              <TrendingUp className="w-3.5 h-3.5" /> 예상 성과 (행사 {basis.eventWindowDays || 7}일 기준)
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="text-white/50 text-xs mb-1">예상 전환</div>
                <div className="text-lg font-bold text-white">{fmt(perf.expectedConversions)}명</div>
                <div className="text-white/40 text-[11px]">{pct(perf.conversionRate)}</div>
              </div>
              <div>
                <div className="text-white/50 text-xs mb-1">예상 매출</div>
                <div className="text-lg font-bold text-emerald-400">{fmt(revenue)}원</div>
              </div>
              <div>
                <div className="text-white/50 text-xs mb-1">투자 대비</div>
                <div className="text-lg font-bold text-white">{multiple > 0 ? `${multiple.toFixed(1)}배` : '-'}</div>
                <div className="text-white/40 text-[11px]">발송비 {fmt(cost)}원</div>
              </div>
            </div>
          </div>

          {/* 등급별 분해 (여러 등급 타겟일 때) */}
          {breakdown.length > 0 && (
            <div className="rounded-xl bg-slate-800/40 p-3">
              <div className="flex items-center gap-1.5 text-white/60 text-xs mb-2">
                <BarChart3 className="w-3.5 h-3.5" /> 등급별 예상
              </div>
              <div className="space-y-1.5">
                {breakdown.map((b: any, i: number) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-white/70 font-medium w-16 shrink-0 truncate">{b.grade}</span>
                    <span className="text-white/40 w-14 text-right">{fmt(b.count)}명</span>
                    <span className="text-violet-300 w-12 text-right">{pct(b.conversionRate)}</span>
                    <span className="text-white/60 w-16 text-right">전환 {fmt(b.expectedConversions)}</span>
                    <span className="text-emerald-400/80 flex-1 text-right">{fmt(b.expectedRevenue)}원</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 근거 */}
          {basis.label && (
            <div className="rounded-xl bg-slate-800/40 p-3">
              <div className="flex items-center gap-1.5 text-white/60 text-xs mb-1.5">
                <Target className="w-3.5 h-3.5" /> 추정 근거
              </div>
              <div className="text-sm text-white/80">{basis.label}</div>
              {Array.isArray(basis.notes) && basis.notes.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {basis.notes.map((n: string, i: number) => (
                    <li key={i} className="text-white/50 text-xs flex items-start gap-1">
                      <span className="text-violet-400 mt-0.5">·</span> {n}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {/* Source caption */}
      <p className="text-[10px] text-white/30 italic">
        Data source — 등급별 구매주기·발송 후 구매 실측·CDP 이벤트 (회사 실데이터 기반, 임의 추정치 미사용)
      </p>

      {/* 액션 */}
      {(onApprove || onReject) && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={onReject}
            className="flex-1 rounded-xl border border-white/10 bg-slate-800 px-4 py-2.5 text-sm text-white/70 hover:bg-slate-700"
          >
            거부
          </button>
          <button
            onClick={onApprove}
            className="flex-1 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white"
          >
            승인
          </button>
        </div>
      )}
    </div>
  );
}
