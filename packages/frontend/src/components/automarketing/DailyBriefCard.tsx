// 오늘의 추천 브리핑 — 매일 9시 일일 분석 엔진이 만든 회사 맞춤 추천 (2026-07-02 3단계)
// 카드 클릭 한 번 = 크레딧 확인 → 자동마케팅 생성 + 즉시 초안(전체 AI 체인은 이 순간에만 실행 — 원가 통제).
import { ChevronRight } from 'lucide-react';
import ZoneEmphasis from '../zone/ZoneEmphasis';

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

  // ★ 2026-09-30 AI 존 대개편: 화면당 강조 카드 1장(ZoneEmphasis · AI 추천 표지) · 추천 줄은 가로 3칸(내용·1클릭 그대로)
  return (
    <ZoneEmphasis
      kind="ai"
      title="AI 일일 브리핑"
      meta={dateLabel || undefined}
    >
      {brief.headline && <div className="text-[13px] text-slate-600 -mt-1 mb-3 leading-relaxed">{brief.headline}</div>}
      {recs.length > 0 ? (
        <div className="grid md:grid-cols-3 gap-3">
          {recs.map((rec, i) => (
            <div key={i} className="rounded-xl border border-slate-200 p-3.5 flex flex-col">
              <div className="text-[13.5px] font-semibold text-slate-900 leading-snug flex items-center gap-1.5 flex-wrap">
                {rec.title}
                {rec.opportunityType === 'journey_promotion' && <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium">성과 검증</span>}
                {rec.recommendedChannel && CHANNEL_LABEL[rec.recommendedChannel] && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-700 font-medium">{CHANNEL_LABEL[rec.recommendedChannel]}</span>
                )}
              </div>
              {rec.targetCount != null && <div className="text-[12px] text-indigo-700 mt-1">대상 {rec.targetCount.toLocaleString()}명</div>}
              <div className="text-[12.5px] text-slate-500 mt-1 leading-relaxed flex-1">{rec.reason}</div>
              <button
                onClick={() => onStart(rec)}
                disabled={submitting}
                className="mt-2.5 self-start inline-flex items-center gap-1 text-[13px] font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-30 transition-colors"
              >
                {startLabel(rec)}<ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[13px] text-slate-500">오늘은 새로 추천할 만한 신호가 없습니다. 데이터가 쌓이면 추천이 늘어납니다.</div>
      )}
      <div className="mt-3 text-[10px] text-slate-400 italic">Data source: 회사 고객 DB 실측 신호 · 누적 학습 메모리 · 운영 현황 (매일 오전 분석)</div>
    </ZoneEmphasis>
  );
}
