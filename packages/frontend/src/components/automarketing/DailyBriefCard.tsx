// 오늘의 추천 브리핑 — 매일 9시 일일 분석 엔진이 만든 회사 맞춤 추천 (2026-07-02 3단계)
// 카드 클릭 한 번 = 크레딧 확인 → 자동마케팅 생성 + 즉시 초안(전체 AI 체인은 이 순간에만 실행 — 원가 통제).
import { Sparkles, ChevronRight } from 'lucide-react';

export interface DailyBriefRecommendation {
  title: string;
  objective: string;
  reason: string;
  opportunityType: string | null;   // 신호 type | 'journey_promotion'(여정 정착 제안)
  targetCount: number | null;
  valueAtStake: number | null;
  // 채널 성과 학습 근거가 있을 때만 — 'email'/'dm'이면 해당 채널 화면으로 안내
  recommendedChannel?: 'sms' | 'email' | 'dm' | null;
}

const CHANNEL_LABEL: Record<string, string> = { email: '이메일 추천', dm: '모바일 DM 추천' };

function startLabel(rec: DailyBriefRecommendation): string {
  if (rec.opportunityType === 'journey_promotion') return '여정으로 굳히기';
  if (rec.recommendedChannel === 'email') return '이메일에서 진행';
  if (rec.recommendedChannel === 'dm') return '모바일 DM에서 진행';
  return '이 추천으로 시작';
}

export interface DailyBrief {
  brief_date: string;
  headline: string | null;
  recommendations: DailyBriefRecommendation[];
  created_at: string;
}

interface Props {
  brief: DailyBrief;
  submitting: boolean;
  onStart: (rec: DailyBriefRecommendation) => void;
}

export default function DailyBriefCard({ brief, submitting, onStart }: Props) {
  const recs = Array.isArray(brief.recommendations) ? brief.recommendations : [];
  const dateLabel = (() => {
    try {
      return new Date(brief.brief_date).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
    } catch { return ''; }
  })();

  return (
    <div className="bg-gradient-to-br from-indigo-500/15 to-slate-900 border border-indigo-400/25 rounded-2xl p-5">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-indigo-500/25 flex items-center justify-center shrink-0">
          <Sparkles className="w-4.5 h-4.5 text-indigo-300" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">AI 일일 브리핑 {dateLabel && <span className="text-white/40 font-normal">· {dateLabel}</span>}</div>
          {brief.headline && <div className="text-[13px] text-white/70 mt-0.5 leading-relaxed">{brief.headline}</div>}
        </div>
      </div>

      {recs.length > 0 ? (
        <div className="mt-4 space-y-2">
          {recs.map((rec, i) => (
            <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-3.5 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="text-[13px] font-medium text-white flex items-center gap-2 flex-wrap">
                  {rec.title}
                  {rec.targetCount != null && <span className="text-[11px] text-indigo-300">대상 {rec.targetCount.toLocaleString()}명</span>}
                  {rec.opportunityType === 'journey_promotion' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-medium">성과 검증</span>}
                  {rec.recommendedChannel && CHANNEL_LABEL[rec.recommendedChannel] && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-medium">{CHANNEL_LABEL[rec.recommendedChannel]}</span>
                  )}
                </div>
                <div className="text-[11px] text-white/50 mt-1 leading-relaxed">{rec.reason}</div>
              </div>
              <button
                onClick={() => onStart(rec)}
                disabled={submitting}
                className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-lg bg-indigo-500/40 hover:bg-indigo-500/60 disabled:opacity-30 text-indigo-50 font-medium transition-colors"
              >
                {startLabel(rec)}<ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 text-xs text-white/45">오늘은 새로 추천할 만한 신호가 없습니다. 데이터가 쌓이면 추천이 늘어납니다.</div>
      )}

      <div className="mt-3 text-[10px] text-white/30 italic">Data source: 회사 고객 DB 실측 신호 · 누적 학습 메모리 · 운영 현황 (매일 오전 분석)</div>
    </div>
  );
}
