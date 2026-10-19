/**
 * HubRecommendModal.tsx — 「오늘의 추천 캠페인」 창 (★ 2026-10-19 AiLinePage 추천 띠 안 창을 원본 그대로 옮김)
 *
 * 쓰는 곳 = AI 한줄로 화면 추천 띠 · 대시보드 「오늘의 추천」 칸의 「모두 보기」(docs/2026-10-19-dashboard-four-cards-design.md §2-4).
 * 창은 X · ESC 로만 닫는다(바깥 눌러 닫기 없음 · 전역 규칙). 대시보드 칸 안에서 열려도 갇히지 않게 body 로 띄운다.
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { hubRecLabel, type AutoMarketingSummary, type CompanyHealthDiagnosis, type DiagnosisBrief, type HubRec } from '../../lib/hub-recommend';

export default function HubRecommendModal({ diagnosis, brief, recs, useBrief, autoMarketing, onClose, onRun }: {
  diagnosis: CompanyHealthDiagnosis;
  brief: DiagnosisBrief | null;
  recs: HubRec[];
  useBrief: boolean;
  autoMarketing: AutoMarketingSummary;
  onClose: () => void;
  onRun: (r: HubRec) => void;
}) {
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pending = autoMarketing.pendingProposals;
  const scoreTone = diagnosis.overallScore >= 70 ? 'text-emerald-700' : diagnosis.overallScore >= 40 ? 'text-amber-700' : 'text-rose-700';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60" role="dialog" aria-modal="true" aria-labelledby="hub-rec-title">
      <div className="relative w-full max-w-4xl max-h-[88vh] overflow-y-auto rounded-3xl p-6 md:p-8 bg-white text-slate-900 shadow-[0_24px_64px_-12px_rgba(15,23,42,0.45)]">
        <button type="button" onClick={onClose} className="absolute top-5 right-5 w-9 h-9 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="닫기">
          <X className="w-[18px] h-[18px]" />
        </button>
        <div className="flex items-start justify-between gap-6 pr-12 mb-5">
          <div className="min-w-0">
            <h3 id="hub-rec-title" className="text-[19px] font-bold tracking-[-0.02em]">오늘의 추천 캠페인</h3>
            <p className="text-[14px] mt-1 text-slate-600">
              {useBrief ? (brief?.headline || '매일 오전 분석 · 우리 고객 데이터에서 오늘 할 만한 캠페인을 골랐습니다.') : '일일 분석이 쌓이기 전 기본 추천입니다. 회사 실측 신호로 골랐습니다.'}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[12px] text-slate-500">회사 건강 점수</div>
            <div className={`text-[24px] font-bold tabular-nums ${scoreTone}`}>{diagnosis.overallScore}</div>
          </div>
        </div>

        {diagnosis.topConcerns.length > 0 && (
          <div className="mb-5 p-4 rounded-2xl bg-slate-50 border border-slate-200">
            <div className="text-[13px] font-semibold mb-2 text-slate-600">AI 진단 우선 항목</div>
            <ul className="space-y-1.5 text-[14px] text-slate-700">
              {diagnosis.topConcerns.map((c, i) => (
                <li key={i} className="flex gap-2"><span className="text-amber-600">•</span><span>{c}</span></li>
              ))}
            </ul>
          </div>
        )}

        {recs.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {recs.map((r, i) => {
              const count = r.rec.targetCount;
              return (
                <div key={r.kind === 'rule' ? r.rec.id : `brief-${i}`} className="flex flex-col p-5 rounded-2xl bg-white border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_10px_24px_-14px_rgba(15,23,42,0.25)]">
                  <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                    <span className={`text-[12px] font-bold px-2 py-0.5 rounded-full ${i === 0 ? 'bg-slate-900 text-white' : 'bg-indigo-50 text-indigo-800'}`}>{r.kind === 'rule' ? r.rec.priority : i + 1}순위</span>
                    {count != null && count > 0 && <span className="text-[13px] text-slate-500">{count.toLocaleString()}명</span>}
                    {r.kind === 'brief' && r.rec.opportunityType === 'journey_promotion' && <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800">성과 검증</span>}
                    {r.kind === 'brief' && r.rec.recommendedChannel === 'email' && <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-sky-50 text-sky-800">이메일 추천</span>}
                    {r.kind === 'brief' && r.rec.recommendedChannel === 'dm' && <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-sky-50 text-sky-800">모바일 DM 추천</span>}
                  </div>
                  <h4 className="text-[16px] font-bold mb-1.5">{r.rec.title}</h4>
                  <p className="text-[13px] leading-relaxed mb-2 text-slate-700">{r.rec.reason}</p>
                  {r.kind === 'rule' && r.rec.expectedImpact && <p className="text-[12px] text-slate-500 mb-2">{r.rec.expectedImpact}</p>}
                  <div className="flex-1" />
                  <button type="button" onClick={() => onRun(r)} className="mt-2 w-full h-10 rounded-xl text-[14px] font-semibold bg-amber-500 text-slate-900 hover:bg-amber-400 transition-colors">{hubRecLabel(r)}</button>
                </div>
              );
            })}
          </div>
        )}

        {/* ★ 2026-07-02 1차: 자동마케팅 현황 요약 — 승인 대기가 있으면 바로 가게 */}
        <button
          type="button"
          onClick={() => { onClose(); navigate('/continuous-operator?tab=running'); }}
          className="mt-4 w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl text-[14px] bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 transition-colors"
        >
          <span>
            실행 중인 자동 마케팅 <b>{autoMarketing.active}</b>개
            {pending > 0 && <> · 승인 대기 <b>{pending.toLocaleString()}</b>건</>}
          </span>
          <span className="font-semibold text-indigo-700 shrink-0">자동 마케팅 관리 →</span>
        </button>
        <p className="mt-3 text-[12px] text-slate-500 italic">
          Data source: {useBrief ? '매일 오전 일일 분석 (고객 DB 실측 신호 · 누적 학습)' : '회사 실측 신호 (일일 분석 누적 전 기본 추천)'}
        </p>
      </div>
    </div>,
    document.body,
  );
}
