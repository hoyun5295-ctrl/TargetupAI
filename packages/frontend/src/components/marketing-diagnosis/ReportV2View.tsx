/**
 * ReportV2View — v2 스토리형 진단 리포트 (2026-08-16 v3 개편 · v6 채움 킥 · v7 장 넘김)
 *
 * 장(章) 구성 = ①지금 어디에 계신가(표지·단계·들은 것) ②잘하는 것과 걸리는 것(칭찬·짚임·축별 판정)
 * ③아쉬운 곳 셋(병목 인과 4박자) ④다음 30일(실행 순서·실적·견적·예시) — 미리보기는 ④가 「전체 리포트 받기」.
 *
 * 계약 (회의 확정)
 *   - 표지~축별 판정에 자사명 0. 자사 연결은 **병목 카드의 채움 킥(v6)**과 견적 구간뿐 —
 *     v5의 30일 실행 각주는 폐지(같은 말을 두 곳에서 하지 않는다).
 *   - 브랜드 컬러(sky 그라데이션)를 내용 블록에 칠하지 않는다 — "브랜드색 = 판매 신호" 학습 차단.
 *     장 넘김 컨트롤은 내용이 아니라 화면 뼈대라 예외(단계 눈금과 같은 계열).
 *   - 칭찬은 조용하게(화려하면 아부) · 병목 1순위만 rose, 나머지 amber · 숫자 점수 비노출.
 *   - preview(퍼널 B 폼 앞) = plan30·effects·recommendation 부재 — 흐림·자물쇠 없이 부재 안내 평문.
 *     ★장 넘김은 가림 장치가 아니다 — 클릭만으로 전부 열리고, 리드 폼은 마지막 장에 함께 실린다.
 *   - 전 필드 방어적 접근(preview 부분 결과·구 스냅샷 — 백지 크래시 금지).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, MessageSquareText, RotateCcw, X } from 'lucide-react';
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
  /** 퍼널 B 폼 앞 미리보기 — 실행 순서·견적 대신 부재 안내를 그린다. */
  previewMode?: boolean;
  /**
   * 퍼널 B 리드 폼 — 마지막 장 안에 함께 싣는다.
   * 장 밖에 두면 1장을 보는 사람에게도 폼이 붙어 있어 장 넘김의 이점이 사라진다.
   */
  previewFooter?: ReactNode;
  onFirstSend?: () => void;
  onConsult?: () => void;
  onSeePlans?: () => void;
  onLater?: () => void;
}

export default function ReportV2View({
  result, outcome, trialExpiresAt, coverTitle, previewMode = false, previewFooter,
  onFirstSend, onConsult, onSeePlans, onLater,
}: Props) {
  const [zoom, setZoom] = useState<{ src: string; label: string } | null>(null);
  const [chapterIdx, setChapterIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
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

  const chapters: Array<{ key: string; title: string; body: ReactNode }> = [];

  // ── 1장 — 지금 어디에 계신가 ──
  chapters.push({
    key: 'where',
    title: '지금 어디에 계신가',
    body: (
      <>
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
      </>
    ),
  });

  // ── 2장 — 잘하는 것과 걸리는 것 ──
  if (praises.length > 0 || insights.length > 0 || axes.length > 0) {
    chapters.push({
      key: 'read',
      title: '잘하는 것과 걸리는 것',
      body: (
        <>
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
        </>
      ),
    });
  }

  // ── 3장 — 아쉬운 곳 셋(병목 인과 4박자) ──
  if (gaps.length > 0) {
    chapters.push({
      key: 'gaps',
      title: '아쉬운 곳 셋',
      body: (
        <div className="flex flex-col gap-3">
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
              {/* v6 채움 킥 — 라벨만 sky 소형(위치 식별), 본문은 일반 명도. 배너화 금지(그라데이션·버튼·아이콘 0) */}
              {g.fill && (
                <div className="mt-3 border-t border-white/10 pt-2.5">
                  <p className="text-[11px] font-semibold text-sky-300/70">한줄로는 이렇게 채워드립니다</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-white/80">{g.fill}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      ),
    });
  }

  // ── 4장 — 다음 30일(full) / 전체 리포트 받기(preview) ──
  chapters.push({
    key: 'next',
    title: previewMode ? '전체 리포트 받기' : '다음 30일',
    body: (
      <>
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
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {previewMode && (
          <p className="text-sm text-white/60">
            {result.plan_note || '30일 실행 순서는 신청 후 담당자가 함께 정리해 드려요.'}
          </p>
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

        {/* ── 업종 예시 목업 — 처방의 증거. v6부터 미리보기(폼 앞)에도 낸다 ── */}
        {industry && (
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
                {result.pitch_note && (
                  <p className="mt-2.5 text-[12px] text-white/50">{result.pitch_note}</p>
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

        {/* 퍼널 B 리드 폼 — 마지막 장 안(장 넘김의 종착지가 곧 신청 자리) */}
        {previewMode && previewFooter}

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
      </>
    ),
  });

  const total = chapters.length;
  const idx = Math.min(chapterIdx, total - 1);
  const current = chapters[idx];
  const isLast = idx === total - 1;

  /** 장을 옮길 때 스크롤 컨테이너를 맨 위로 — 없으면 새 장이 중간부터 보인다(모달·페이지 양쪽). */
  const goTo = (next: number) => {
    const bounded = Math.max(0, Math.min(total - 1, next));
    if (bounded === idx) return;
    setChapterIdx(bounded);
  };

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let node: HTMLElement | null = el.parentElement;
    while (node) {
      const oy = getComputedStyle(node).overflowY;
      if (oy === 'auto' || oy === 'scroll') { node.scrollTop = 0; return; }
      node = node.parentElement;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [idx]);

  /** ← → 로도 넘긴다. 입력 중이거나 확대 보기가 떠 있으면 개입하지 않는다. */
  useEffect(() => {
    if (total <= 1) return;
    const onKey = (e: KeyboardEvent) => {
      if (zoom) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      if (e.key === 'ArrowRight') goTo(idx + 1);
      else if (e.key === 'ArrowLeft') goTo(idx - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div ref={rootRef} className="flex flex-col gap-5 break-keep">
      {/* 체험 지급 고지 — 첫 장에서만(지급 영수증이 매 장을 차지하지 않게) */}
      {effectiveOutcome === 'granted' && idx === 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3.5 py-2 text-[13px] font-semibold text-emerald-200">
          <Check className="h-4 w-4 shrink-0" aria-hidden />
          7일 무료체험이 시작됐어요{d != null ? ` · D-${d}` : ''}
        </div>
      )}

      {/* ── 장 머리 — 순번·제목 + 목차 눈금(클릭 이동) ── */}
      {total > 1 && (
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.2em] text-white/35">
              {String(idx + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
            </p>
            <h3 className="mt-1 truncate text-[17px] font-bold tracking-tight text-white md:text-xl">{current.title}</h3>
          </div>
          <div className="flex shrink-0 items-center" role="tablist" aria-label="진단서 목차">
            {chapters.map((c, i) => (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={i === idx}
                aria-label={`${i + 1}장 ${c.title}`}
                onClick={() => goTo(i)}
                className="grid h-10 w-6 place-items-center"
              >
                <span
                  className={`block h-1.5 rounded-full transition-all duration-300 ${
                    i === idx
                      ? 'w-6 bg-gradient-to-r from-sky-400 to-indigo-400'
                      : i < idx
                        ? 'w-1.5 bg-white/40 hover:bg-white/70'
                        : 'w-1.5 bg-white/15 hover:bg-white/40'
                  }`}
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── 장 본문 ── */}
      <div
        key={current.key}
        role="tabpanel"
        aria-label={current.title}
        className="flex animate-in flex-col gap-5 fade-in slide-in-from-bottom-2 duration-300"
      >
        {current.body}
      </div>

      {/* ── 장 넘김 바 — 스크롤을 따라오는 하나의 컨트롤(상단 고정 바를 겹치지 않게) ── */}
      {total > 1 && (
        <div className="sticky bottom-0 z-10 pb-1 pt-2">
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/85 p-2 shadow-2xl backdrop-blur-md">
            <button
              type="button"
              onClick={() => goTo(idx - 1)}
              disabled={idx === 0}
              className="inline-flex min-h-[44px] items-center gap-1 rounded-xl px-3 text-sm font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-25"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">이전</span>
            </button>

            {/* 미리보기 — 어느 장에서 멈춰도 신청으로 갈 길을 남긴다(이탈 지점 = 전환 지점) */}
            {previewMode && !isLast && (
              <button
                type="button"
                onClick={() => goTo(total - 1)}
                className="min-h-[44px] rounded-xl px-2 text-[13px] font-semibold text-white/45 transition-colors hover:text-white/80"
              >
                바로 신청하기
              </button>
            )}

            <div className="flex-1" />

            {!isLast ? (
              <button
                type="button"
                onClick={() => goTo(idx + 1)}
                className="inline-flex min-h-[44px] max-w-[62%] items-center gap-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 px-4 text-sm font-bold text-white shadow-lg shadow-sky-500/20 transition-all hover:shadow-xl"
              >
                <span className="truncate">{chapters[idx + 1].title}</span>
                <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => goTo(0)}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3.5 text-sm font-semibold text-white/75 transition-colors hover:bg-white/10 hover:text-white"
              >
                <RotateCcw className="h-4 w-4" aria-hidden />
                처음부터 다시 보기
              </button>
            )}
          </div>
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
