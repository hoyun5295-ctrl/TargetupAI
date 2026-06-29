/**
 * AiProposalSummaryModal.tsx (2026-06-29 신설)
 *
 * AI Operator 추천 결과의 장황한 분석 섹션(예상 성과·AI 진단·종합 분석·추천 이유·활용 데이터)을
 * `AI 제안 요약` 버튼 1개로 모아 탭으로 분리. 메인 화면은 핵심 카드 + 발송 CTA만 남겨 깔끔하게.
 *
 * 다크 톤 모달 정합 (bg-slate-900 + border-white/10 + rounded-2xl + shadow-2xl) · ESC/backdrop 닫기 · createPortal.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles, LineChart } from 'lucide-react';
import CompanyDataProfileCard from './CompanyDataProfileCard';
import type { ProposalResponse } from '../pages/AiOperatorPage';

interface Props {
  proposal: ProposalResponse;
  onClose: () => void;
}

type TabKey = 'forecast' | 'synthesis' | 'reason' | 'data';

export default function AiProposalSummaryModal({ proposal, onClose }: Props) {
  const perf = proposal.performance;
  const insight = perf.insight;
  const insufficient = perf.basis?.level === 'insufficient_data';

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'forecast', label: '예상·진단' },
    ...(proposal.meta?.aiSynthesis ? [{ key: 'synthesis' as const, label: '종합 분석' }] : []),
    ...(proposal.recommendationReason ? [{ key: 'reason' as const, label: '추천 이유' }] : []),
    { key: 'data', label: '활용 데이터' },
  ];
  const [tab, setTab] = useState<TabKey>('forecast');

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[1200] p-4 text-white" onClick={onClose}>
      <div
        className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-violet-500/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">AI 제안 요약</h3>
              <p className="text-[11px] text-white/50 mt-0.5">예측·진단·종합 분석·활용 데이터를 한곳에서</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors" aria-label="닫기">
            <X className="w-4 h-4 text-white/50" />
          </button>
        </div>

        {/* 탭 */}
        <div className="flex items-center gap-1 px-4 pt-3 border-b border-white/10 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3.5 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap transition-colors ${
                tab === t.key ? 'bg-white/10 text-white border-b-2 border-violet-400' : 'text-white/50 hover:text-white/80'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'forecast' && (
            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <LineChart className="w-4 h-4 text-fuchsia-300" />
                  <h4 className="text-sm font-semibold text-white">예상 성과</h4>
                  <span className="text-[11px] text-white/45">{perf.basis?.label || '회사 실데이터 기반 추정'}</span>
                </div>
                {insufficient ? (
                  <div className="rounded-xl border border-amber-400/30 bg-amber-500/5 p-4">
                    <p className="text-amber-200 text-xs font-semibold mb-1.5">정확한 예측을 위해 고객 데이터가 필요합니다</p>
                    <p className="text-white/60 text-[11px] leading-relaxed">
                      구매횟수·구매일·등급 데이터를 넣으면 등급별 정밀 예측이 활성화됩니다. (가짜 수치 대신 정직하게 비워둡니다)
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-fuchsia-200 mb-1">예상 전환</p>
                      <p className="text-base font-bold text-white">{perf.expectedConversions.toLocaleString()}명</p>
                      <p className="text-[10px] text-white/40 mt-0.5">전환율 {(perf.conversionRate * 100).toFixed(1)}%</p>
                    </div>
                    <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-fuchsia-200 mb-1">예상 매출</p>
                      <p className="text-base font-extrabold text-emerald-400">{perf.expectedRevenue.toLocaleString()}원</p>
                      <p className="text-[10px] text-white/40 mt-0.5">발송비 {proposal.cost.estimated.toLocaleString()}원</p>
                    </div>
                    <div className="p-3 rounded-xl bg-gradient-to-br from-fuchsia-500/10 to-pink-500/10 border border-fuchsia-400/30">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-fuchsia-200 mb-1">투자 대비</p>
                      <p className="text-base font-bold text-white">
                        {proposal.cost.estimated > 0 && perf.expectedRevenue > 0
                          ? `${(perf.expectedRevenue / proposal.cost.estimated).toFixed(1)}배`
                          : '—'}
                      </p>
                    </div>
                  </div>
                )}
                {perf.basis?.notes && perf.basis.notes.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {perf.basis.notes.map((n, i) => (
                      <li key={i} className="text-[10px] text-white/45 flex items-start gap-1"><span className="text-fuchsia-300">·</span> {n}</li>
                    ))}
                  </ul>
                )}
                <p className="text-[10px] text-white/30 italic mt-2">Data source — 회사 실데이터 (등급 구매주기·발송 실측·CDP), 임의 추정치 미사용</p>
              </div>

              {insight && (insight.diagnosis || insight.insights.length > 0) && (
                <div className="rounded-2xl border border-violet-400/30 bg-gradient-to-br from-violet-600/15 to-fuchsia-600/10 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-4 h-4 text-violet-300" />
                    <h4 className="text-sm font-bold text-white">AI 분석가 진단</h4>
                  </div>
                  {insight.diagnosis && (
                    <p className="text-sm text-white/90 leading-relaxed mb-3 font-medium">{insight.diagnosis}</p>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {insight.insights.length > 0 && (
                      <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-200 mb-2">인사이트</p>
                        <ul className="space-y-1.5">
                          {insight.insights.map((s, i) => (
                            <li key={i} className="text-[11px] text-white/70 leading-relaxed flex gap-1"><span className="text-violet-400 shrink-0">·</span> {s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {insight.strategy.length > 0 && (
                      <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-200 mb-2">다음 액션</p>
                        <ul className="space-y-1.5">
                          {insight.strategy.map((s, i) => (
                            <li key={i} className="text-[11px] text-white/70 leading-relaxed flex gap-1"><span className="text-emerald-400 shrink-0">→</span> {s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {insight.risks.length > 0 && (
                      <div className="rounded-xl bg-amber-500/5 border border-amber-400/20 p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-200 mb-2">주의</p>
                        <ul className="space-y-1.5">
                          {insight.risks.map((s, i) => (
                            <li key={i} className="text-[11px] text-white/70 leading-relaxed flex gap-1"><span className="text-amber-400 shrink-0">!</span> {s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'synthesis' && proposal.meta?.aiSynthesis && (
            <div className="p-4 rounded-xl bg-gradient-to-br from-violet-500/10 to-fuchsia-500/5 border border-violet-400/20">
              <p className="text-[10px] font-semibold tracking-[0.22em] text-violet-300/70 uppercase mb-1.5">AI 종합 분석</p>
              <p className="text-sm text-white/80 leading-relaxed whitespace-pre-line">{proposal.meta.aiSynthesis}</p>
            </div>
          )}

          {tab === 'reason' && proposal.recommendationReason && (
            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10">
              <p className="text-[10px] font-semibold tracking-[0.22em] text-white/40 uppercase mb-1.5">AI Recommendation Reason</p>
              <p className="text-sm text-white/70 leading-relaxed">{proposal.recommendationReason}</p>
            </div>
          )}

          {tab === 'data' && <CompanyDataProfileCard />}
        </div>
      </div>
    </div>,
    document.body,
  );
}
