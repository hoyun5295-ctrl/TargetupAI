/**
 * ReportV2View — v2 스토리형 진단 리포트 (2026-08-16 v3 개편 · 브레인스토밍 수렴안)
 *
 * 블록 순서 = 표지(강점절+약점절 2행 + 단계 눈금) → 들은 것 → 잘하는 것 → 짚이는 것 →
 * 축별 판정 → 병목(인과 3단) → 30일 실행 → 실적(A) → 구분선+견적 → 업종 예시.
 *
 * 계약 (회의 확정)
 *   - 표지~병목에 자사명 0. 자사 연결은 30일 실행의 각주(작은 활자·이탤릭·브랜드색 0)뿐.
 *   - 브랜드 컬러(sky 그라데이션)를 내용 블록에 칠하지 않는다 — "브랜드색 = 판매 신호" 학습 차단.
 *   - 칭찬은 조용하게(화려하면 아부) · 병목 1순위만 rose, 나머지 amber · 숫자 점수 비노출.
 *   - preview(퍼널 B 폼 앞) = plan30·effects·recommendation·examples 부재 — 흐림·자물쇠 없이 부재 안내 평문.
 *   - 전 필드 방어적 접근(preview 부분 결과·이후 스키마 확장 대비 — 백지 크래시 금지).
 */
import { useState } from 'react';
import { ArrowRight, Check, MessageSquareText, X } from 'lucide-react';
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
  outcome?: DiagnosisResultDto['grant_outcome'];
  trialExpiresAt?: string | null;
  /** 표지 1층 — A는 회사명, B는 폼 뒤 재렌더에서 회사명. 없으면 서버 cover.subject(접점 구절). */
  coverTitle?: string | null;
  /** 퍼널 B 폼 앞 미리보기 — 실행 순서·예시·견적 대신 부재 안내를 그린다. */
  previewMode?: boolean;
  onFirstSend?: () => void;
  onConsult?: () => void;
  onSeePlans?: () => void;
  onLater?: () => void;
}

export default function ReportV2View({
  result, outcome, trialExpiresAt, coverTitle, previewMode = false,
  onFirstSend, onConsult, onSeePlans, onLater,
}: Props) {
  const [zoom, setZoom] = useState<{ src: string; label: string } | null>(null);
  const effectiveOutcome = outcome ?? result.grant_outcome;
  const d = dDay(trialExpiresAt);
  const industry = result.examples?.industry ?? null;

  const stage = result.stage ?? null;
  const cover = result.cover ?? null;
  const obsItems = Array.isArray(result.observation?.items) ? result.observation!.items : [];
  const praises = Array.isArray(result.praises) ? result.praises : [];
  const insights = Array.isArray(result.insights) ? result.insights : [];
  const axes = Array.isArray(result.axes) ? result.axes : [];
  const gaps = Array.isArray(result.gaps) ? result.gaps : [];
  const plan30 = Array.isArray(result.plan30) ? result.plan30 : [];
  const effects = Array.isArray(result.effects) ? result.effects : [];
  const subjectLine = coverTitle || cover?.subject || null;

  return (
    <div className="flex flex-col gap-5 break-keep">
      {/* 체험 지급 고지 — 리포트 밖 얇은 띠(지급 영수증이 진단서 첫 화면을 차지하지 않게) */}
      {effectiveOutcome === 'granted' && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3.5 py-2 text-[13px] font-semibold text-emerald-200">
          <Check className="h-4 w-4 shrink-0" aria-hidden />
          7일 무료체험이 시작됐어요{d != null ? ` · D-${d}` : ''}
        </div>
      )}

      {/* ── 표지 — 강점절 + 약점절 2행(명도로만 가른다 · 색 = 성적표 금지) + 단계 눈금 ── */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 md:p-6">
        <p className="text-[13px] text-white/50">
          {subjectLine ? `${subjectLine}의 마케팅 진단` : '마케팅 진단'}
        </p>
        <div className="mt-2 text-2xl font-bold leading-snug tracking-tight md:text-3xl">
          {cover?.strength_clause && cover?.gap_clause ? (
            <>
              <span className="block text-white">{cover.strength_clause},</span>
              <span className="block text-white/60">{cover.gap_clause}</span>
            </>
          ) : (
            <span className="block text-white">{cover?.headline ?? result.summary}</span>
          )}
        </div>
        {stage && (
          <div className="mt-5">
            {stage.issued ? (
              <>
                <div className="flex items-center gap-1" aria-hidden>
                  {(stage.scale ?? []).map((label, i) => (
                    <div
                      key={label}
                      className={`h-1.5 flex-1 rounded-full ${
                        i < stage.position ? 'bg-white/30'
                        : i === stage.position ? 'bg-gradient-to-r from-sky-400 to-indigo-400'
                        : i === stage.position + 1 ? 'bg-white/15'
                        : 'bg-white/[0.07]'
                      }`}
                    />
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-bold text-white">지금은 「{stage.label}」 단계</p>
                  {Array.isArray(stage.scale) && stage.scale[stage.position + 1] && (
                    <p className="text-[12px] text-white/40">다음은 {stage.scale[stage.position + 1]}</p>
                  )}
                </div>
                <p className="mt-1 text-[13px] text-white/60">{stage.line}</p>
              </>
            ) : (
              <p className="text-[13px] text-white/60">
                「잘 모르겠어요」 답이 많아 단계는 확정하지 않았어요. 아래 소견은 확인된 답만으로 정리했어요.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── 들은 것 — 판단 없이 되읽기 ── */}
      {obsItems.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 md:p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/40">들은 것</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {obsItems.map((it, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-white/80">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-white/30" aria-hidden />
                <span>
                  {it.text}
                  {it.measured && (
                    <span className="ml-1.5 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white/50">실측</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {result.observation?.source && (
            <p className="mt-3 text-[10px] italic text-white/30">Data source — {result.observation.source}</p>
          )}
        </div>
      )}

      {/* ── 잘하고 있는 것 — 조용한 톤 ── */}
      {praises.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 md:p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300/70">잘하고 있는 것</p>
          <ul className="mt-2 flex flex-col gap-2">
            {praises.map((t, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-white/80">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300/80" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── 짚이는 것 — 모순 조합 관찰문(감점이 아니라 소견) ── */}
      {insights.length > 0 && (
        <div className="rounded-2xl border border-amber-400/20 bg-amber-500/5 p-4 md:p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-300/70">짚이는 것</p>
          <ul className="mt-2 flex flex-col gap-2">
            {insights.map((t, i) => (
              <li key={i} className="text-sm leading-relaxed text-white/80">{t}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ── 축별 판정 — 가로 바 · 강한 축 위 · 숫자 없음 ── */}
      {axes.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 md:p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/40">여섯 가지로 나눠 봤어요</p>
          <div className="mt-3 flex flex-col gap-2.5">
            {axes.map((a) => {
              const lv = Math.min(3, Math.max(0, Number(a.level) || 0));
              const width = Math.max(8, Math.round((lv / 3) * 100));
              const barColor = lv >= 2 ? 'bg-emerald-400/70' : lv === 1 ? 'bg-amber-400/70' : 'bg-rose-400/60';
              return (
                <div key={a.axis} className="flex items-center gap-3">
                  <span className="w-[76px] shrink-0 text-[13px] text-white/70">{a.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${width}%` }} />
                  </div>
                  <span className="w-[86px] shrink-0 text-right text-[12px] text-white/50">{a.level_label}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[10px] italic text-white/30">Data source — 답변 기준 자가 진단</p>
        </div>
      )}

      {/* ── 병목 — 인과 3단(들은 것 → 생기는 일 → 바꾸는 방법) ── */}
      {gaps.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/40">아쉬운 곳부터 셋</p>
          {gaps.map((g, i) => (
            <div
              key={g.axis}
              className={`rounded-2xl border p-4 md:p-5 ${
                i === 0 ? 'border-rose-400/25 bg-rose-500/[0.07]' : 'border-amber-400/20 bg-amber-500/[0.05]'
              }`}
            >
              <p className="text-[12px] font-semibold text-white/50">{g.label}</p>
              {g.heard && <p className="mt-1.5 text-[13px] text-white/50">{g.heard}</p>}
              <p className="mt-2 text-sm font-semibold leading-relaxed text-white/90">{g.cause}</p>
              <p className="mt-1 text-sm leading-relaxed text-white/70">{g.effect}</p>
              {g.direction && (
                <div className="mt-3 border-l-2 border-white/20 pl-3">
                  <p className="text-[12px] font-semibold text-white/50">이렇게 바꿔 보세요</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-white/85">{g.direction}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── 30일 실행 순서(full) / 부재 안내(preview) ── */}
      {!previewMode && plan30.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 md:p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/40">30일 실행 순서</p>
          <div className="mt-3 flex flex-col gap-3">
            {plan30.map((s, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0 rounded-md border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] font-bold text-white/60">
                  {s.week}
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-white/80">{s.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-white/75">{s.action}</p>
                  {s.footnote && (
                    <p className="mt-1 text-[10px] italic text-white/40">{s.footnote}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {previewMode && (
        <div className="border-t border-white/10 pt-4">
          <p className="text-sm text-white/60">
            {result.plan_note || '30일 실행 순서와 분야별 예시는 신청 후 담당자가 함께 정리해 드려요.'}
          </p>
        </div>
      )}

      {/* ── 실적(A) — 서버 계산 스냅샷 ── */}
      {!previewMode && effects.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {effects.map((e, i) => (
            <div key={`${e.kind}-${i}`} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs text-white/50">{e.label}</p>
              <p className="mt-1 text-sm font-semibold leading-relaxed text-white">{e.value}</p>
              <p className="mt-2 text-[10px] italic text-white/30">Data source — {e.source}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── 구분선 + 견적 — 리포트는 위에서 끝났고, 아래는 실행 수단 안내 ── */}
      {!previewMode && (
        <div className="border-t border-white/10 pt-5">
          {result.recommendation ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 md:p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/40">이 처방을 실행하려면</p>
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-3">
                <p className="text-base font-bold text-white">
                  {result.recommendation.plan_name}
                  <span className="ml-2 text-sm font-semibold text-white/60">
                    월 {Number(result.recommendation.monthly_price ?? 0).toLocaleString()}원
                  </span>
                </p>
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
              {Array.isArray(result.recommendation.reasons) && result.recommendation.reasons.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1.5 border-t border-white/10 pt-3">
                  {result.recommendation.reasons.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px] text-white/60">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-white/40" aria-hidden />
                      <span>
                        「{r.question}」에 <span className="font-semibold text-white/80">{r.option}</span>라고 답하셔서예요.
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-[10px] italic text-white/30">Data source — 답변 × 요금제 실데이터(요금제 표가 진실)</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 md:p-5">
              <p className="text-sm font-semibold text-white/85">
                {result.no_match_kind === 'over_range'
                  ? '지금 규모는 표준 요금제 범위를 넘어요. 맞는 구성은 상담으로 함께 잡아 드릴게요.'
                  : '딱 맞는 요금제는 상담으로 함께 확인해 드릴게요.'}
              </p>
            </div>
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
      )}

      {/* ── 업종 예시 목업(full) — 처방의 증거 ── */}
      {!previewMode && industry && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-white/40">이 분야에서 이렇게 씁니다</p>
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

      {!previewMode && onLater && (
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
