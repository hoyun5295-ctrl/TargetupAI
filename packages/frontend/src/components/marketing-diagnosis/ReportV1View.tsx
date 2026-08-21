/**
 * ReportV1View — v1 스냅샷 리포트 (2026-08-16 · v3 개편에서 동결 분리)
 *
 * 원본 = 2026-08-16 DiagnosisReportView(설계서 §5-4·§5-5) **원형 이동 — 동작 무변경**.
 * v1 result 스냅샷 행의 재열람 계약을 이 파일이 지킨다(스냅샷 백필·마이그레이션 없음 — v3 C4).
 * 신규 화면 작업은 ReportV2View에 — 이 파일은 손대지 않는다.
 */
import { useState } from 'react';
import { ArrowRight, MessageSquareText, Sparkles, Stethoscope, X } from 'lucide-react';
import type { DiagnosisResultDto } from './diagnosisApi';

const EXAMPLE_CHANNELS = [
  { key: 'dm', label: '모바일 DM' },
  { key: 'email', label: '이메일' },
  { key: 'inapp', label: '인앱 메시지' },
] as const;

function dDay(trialExpiresAt?: string | null): number | null {
  if (!trialExpiresAt) return null;
  const diff = new Date(trialExpiresAt).getTime() - Date.now();
  if (Number.isNaN(diff) || diff <= 0) return null;
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

interface Props {
  result: DiagnosisResultDto;
  /** 퍼널 A 제출 응답의 outcome(리포트 재열람은 result.grant_outcome 사용) */
  outcome?: DiagnosisResultDto['grant_outcome'];
  trialExpiresAt?: string | null;
  /** 히어로 CTA — 첫 발송 해보기(granted) */
  onFirstSend?: () => void;
  /** 히어로 CTA — 추천 요금제로 상담 신청(not_eligible·already_granted) */
  onConsult?: () => void;
  /** 「다른 요금제 보기」 */
  onSeePlans?: () => void;
  /** 하단 「나중에 결정할게요」 */
  onLater?: () => void;
}

export default function ReportV1View({
  result, outcome, trialExpiresAt, onFirstSend, onConsult, onSeePlans, onLater,
}: Props) {
  const [zoom, setZoom] = useState<{ src: string; label: string } | null>(null);
  const effectiveOutcome = outcome ?? result.grant_outcome;
  const d = dDay(trialExpiresAt);
  const industry = result.examples?.industry ?? null;

  return (
    <div className="flex flex-col gap-5 break-keep">
      {/* ── 히어로 ── */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-sky-600/30 via-indigo-600/25 to-slate-900 p-5 md:p-6">
        <div className="pointer-events-none absolute -right-14 -top-16 h-44 w-44 rounded-full bg-sky-400/15 blur-3xl" aria-hidden />
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 shadow-lg shadow-sky-500/25">
            <Stethoscope className="h-5 w-5 text-white" aria-hidden />
          </span>
          <div className="min-w-0">
            {effectiveOutcome === 'granted' ? (
              <>
                <p className="text-lg font-bold tracking-tight text-white md:text-xl">
                  7일 무료체험이 시작되었습니다{d != null ? ` · D-${d}` : ''}
                </p>
                <p className="mt-1 text-sm text-white/70">{result.summary}</p>
              </>
            ) : (
              <p className="text-lg font-bold tracking-tight text-white md:text-xl">{result.summary}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {effectiveOutcome === 'granted' && onFirstSend && (
                <button
                  type="button"
                  onClick={onFirstSend}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-bold text-indigo-700 shadow-sm transition-all hover:shadow-lg"
                >
                  첫 발송 해보기 <ArrowRight className="h-4 w-4" aria-hidden />
                </button>
              )}
              {(effectiveOutcome === 'not_eligible' || effectiveOutcome === 'already_granted' || result.no_match) && onConsult && (
                <button
                  type="button"
                  onClick={onConsult}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-bold text-indigo-700 shadow-sm transition-all hover:shadow-lg"
                >
                  <MessageSquareText className="h-4 w-4" aria-hidden />
                  {result.no_match ? '상담으로 확인하기' : '추천 요금제로 상담 신청'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── 소견 ── */}
      {result.findings.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 md:p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-sky-300/80">진단 소견</p>
          <ul className="mt-2 flex flex-col gap-2">
            {result.findings.map((f) => (
              <li key={f.key} className="flex items-start gap-2 text-sm text-white/80">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" aria-hidden />
                {f.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── 근거 1: 효과(수치 전부 서버 계산 스냅샷) ── */}
      {result.effects.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {result.effects.map((e, i) => (
            <div key={`${e.kind}-${i}`} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs text-white/50">{e.label}</p>
              <p className="mt-1 text-sm font-semibold leading-relaxed text-white">{e.value}</p>
              <p className="mt-2 text-[10px] italic text-white/30">Data source: {e.source}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── 근거 2: 추천 요금제 ── */}
      {result.recommendation && (
        <div className="rounded-2xl border border-sky-400/25 bg-gradient-to-br from-sky-500/10 to-indigo-500/10 p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-sky-300/80">추천 요금제</p>
              <p className="mt-1 text-xl font-bold text-white">
                {result.recommendation.plan_name}
                <span className="ml-2 text-sm font-semibold text-white/60">
                  월 {result.recommendation.monthly_price.toLocaleString()}원
                </span>
              </p>
            </div>
            {onSeePlans && (
              <button
                type="button"
                onClick={onSeePlans}
                className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-sm font-semibold text-white/85 transition-colors hover:border-sky-400/40 hover:text-white"
              >
                다른 요금제 보기 <ArrowRight className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
          {result.recommendation.reasons.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5 border-t border-white/10 pt-3">
              {result.recommendation.reasons.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px] text-white/70">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400" aria-hidden />
                  <span>
                    「{r.question}」에 <span className="font-semibold text-white/90">{r.option}</span>라고 답하셔서예요.
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[10px] italic text-white/30">Data source: 답변 × 요금제 실데이터(요금제 표가 진실)</p>
        </div>
      )}

      {/* ── 업종 예시 목업 ── */}
      {industry && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-sky-300/80">이 분야에서 이렇게 씁니다</p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {EXAMPLE_CHANNELS.map((ch) => {
              const src = `/diagnosis-examples/${industry}-${ch.key}.html`;
              return (
                <button
                  key={ch.key}
                  type="button"
                  onClick={() => setZoom({ src, label: ch.label })}
                  className="group overflow-hidden rounded-2xl border border-white/10 bg-white/5 text-left transition-all hover:border-sky-400/40"
                >
                  <div className="pointer-events-none h-44 overflow-hidden bg-slate-950">
                    <iframe
                      title={`${ch.label} 예시`}
                      src={src}
                      sandbox=""
                      loading="lazy"
                      className="h-[352px] w-[200%] origin-top-left scale-50 border-0"
                    />
                  </div>
                  <p className="px-3 py-2 text-xs font-semibold text-white/80">{ch.label} 예시 보기</p>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] italic text-white/30">예시 목업 · 가상 브랜드 · 실제 고객 사례 아님</p>
        </div>
      )}

      {onLater && (
        <div className="flex justify-center pb-1">
          <button
            type="button"
            onClick={onLater}
            className="min-h-[44px] rounded-xl px-4 py-2 text-sm text-white/50 transition-colors hover:text-white/80"
          >
            나중에 결정할게요
          </button>
        </div>
      )}

      {/* 확대 보기 — 커스텀 오버레이(native dialog 0) */}
      {zoom && (
        <div
          className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setZoom(null); }}
        >
          <div className="relative flex h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
              <p className="text-sm font-semibold text-white">{zoom.label} 예시</p>
              <button
                type="button"
                onClick={() => setZoom(null)}
                aria-label="닫기"
                className="grid h-9 w-9 place-items-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <iframe title={`${zoom.label} 예시 확대`} src={zoom.src} sandbox="" className="w-full flex-1 border-0 bg-white" />
            <p className="border-t border-white/10 px-4 py-2 text-[10px] italic text-white/30">
              예시 목업 · 가상 브랜드 · 실제 고객 사례 아님
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
