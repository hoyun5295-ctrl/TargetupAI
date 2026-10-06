/**
 * PlanFeatureModal — 요금제가 있어야 쓰는 기능의 공통 안내 창 (★ 2026-09-15 Harold 지시 · 목업 승인)
 *
 * 무엇을 하나
 *   메뉴는 요금제와 상관없이 모두에게 보인다. 요금제가 없는 회사가 기능을 누르면 이 창이 뜬다.
 *   "무슨 기능인지 → 이렇게 쓴다 3단계 → 드는 크레딧 → 스타터 요금제부터" 순서로 한 장에 보여준다.
 *
 * ⛔ 문안·아이콘·크레딧은 `constants/plan-feature-intros.ts` 한 곳이 소유한다. 이 파일에 기능 설명을 쓰지 않는다.
 * ⛔ 판정(열어 줄지)은 호출부가 서버 값으로 한다. 이 창은 보여주기만 한다.
 * 옛 PlanUpgradeModal(기능 7개만 설명 · 목록에 없으면 다른 기능 설명이 나오던 창)을 대체한다.
 *
 * ★ 2026-10-06 원장에 예시 영상(video)이 있는 기능 = 두 단 창(왼쪽 영상 · 오른쪽 이렇게 씁니다 · 직접 정할 수 있는 것 ·
 *   알아서 지켜 주는 것 · 드는 크레딧). 휴대폰 폭은 영상이 위 작은 칸. 영상 없는 기능은 아래 한 단 창 그대로(마크업 무변경).
 *   설계 = docs/2026-10-06-plan-feature-video-modal-design.md
 */
import { useLightSurface } from './zone/surface-tone';
import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Coins, ListChecks, Lock, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import { findPlanFeatureIntro, PLAN_FEATURE_MIN_PLAN } from '../constants/plan-feature-intros';

/**
 * ★ 2026-10-06 기능 관심 업체(슈퍼관리자 ceo 전용 화면)의 원천 — 안내 창 열람 · 「요금제 보기」를 서버에 남긴다.
 *   응답을 기다리지 않고, 실패해도 화면에 영향이 없다. 서버가 고객사 사용자만 기록한다(routes/plans.ts · utils/feature-interest.ts).
 */
function reportPlanFeature(featureId: string, event: 'open' | 'pricing'): void {
  const token = localStorage.getItem('token');
  if (!token) return;
  try {
    void fetch('/api/plans/feature-seen', {
      method: 'POST',
      keepalive: true, // 「요금제 보기」는 곧바로 화면을 옮긴다 — 옮겨도 요청이 끝까지 가게
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ featureId, event }),
    }).catch(() => { /* 기록 실패는 무시 */ });
  } catch { /* 기록 실패는 무시 */ }
}

interface PlanFeatureModalProps {
  /** 안내할 기능 id. null이면 창을 그리지 않는다 */
  featureId: string | null;
  onClose: () => void;
}

export default function PlanFeatureModal({ featureId, onClose }: PlanFeatureModalProps) {
  const light = useLightSurface(); // ★ 2026-09-30 AI 존(밝은 작업대)에서 열리면 밝은 짝 · 그 밖은 원래 짙은 값
  const navigate = useNavigate();
  const intro = featureId ? findPlanFeatureIntro(featureId) : null;
  const primaryRef = useRef<HTMLButtonElement>(null);
  // 호출부가 매 렌더 새 함수를 넘겨도 포커스·키 처리가 다시 걸리지 않게 최신 값만 참조한다
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!intro) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    primaryRef.current?.focus();
    reportPlanFeature(intro.id, 'open'); // ★ 2026-10-06 창이 열릴 때 한 번(같은 기능을 다시 열면 다시 센다)
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [intro]);

  // ★ 2026-10-06 예시 영상 — 무음 자동 반복 · 움직임 줄이기 설정이면 자동재생 대신 재생 버튼
  const videoRef = useRef<HTMLVideoElement>(null);
  const reduceMotion = useMemo(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  useEffect(() => {
    const v = videoRef.current;
    if (!v || reduceMotion) return;
    v.muted = true; // 소리 있는 자동재생은 브라우저가 막는다 — 속성뿐 아니라 요소 값도 무음으로 둔다
    const played = v.play();
    if (played && typeof played.catch === 'function') played.catch(() => { /* 막히면 포스터가 남는다 */ });
  }, [intro?.id, reduceMotion]);

  if (!intro) return null;
  const Icon = intro.icon;
  // ★ 2026-10-06 「요금제 보기」 = 기록 한 건 + 닫고 이동(두 창 모양이 같은 함수를 쓴다 · 영상 창 호출보다 먼저 선언)
  const goPricing = () => { reportPlanFeature(intro.id, 'pricing'); onClose(); navigate('/pricing'); };
  if (intro.video) return renderVideoLayout();

  function renderVideoLayout() {
    const it = intro!;
    const video = it.video!;
    const options = it.options || [];
    const safeguards = it.safeguards || [];
    const C = light
      ? {
        surface: 'bg-white text-slate-900 border border-slate-200',
        media: 'bg-slate-50 border-slate-200',
        caption: 'text-slate-400',
        head: 'border-slate-200',
        x: 'text-slate-500 hover:text-slate-900 hover:bg-slate-100',
        summary: 'text-slate-600',
        h4: 'text-slate-900',
        h4Icon: 'text-violet-600',
        divider: 'border-slate-100',
        stepIcon: 'bg-violet-100 text-violet-700',
        stepText: 'text-slate-500',
        card: 'border-slate-200 bg-white',
        cardText: 'text-slate-500',
        chip: 'bg-slate-100 text-slate-600',
        safeIcon: 'text-emerald-600',
        safeText: 'text-slate-600',
        costRow: 'border-slate-200 text-slate-600',
        costVal: 'text-slate-900',
        note: 'text-slate-400',
        foot: 'border-slate-200',
        plan: 'bg-amber-50 border-amber-300/[0.22] text-amber-900',
        planIcon: 'text-amber-700',
        planStrong: 'text-slate-900',
        ghost: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        src: 'text-slate-400',
      }
      : {
        surface: 'bg-slate-900 text-white border border-white/10',
        media: 'bg-black/30 border-white/[0.07]',
        caption: 'text-white/40',
        head: 'border-white/[0.07]',
        x: 'text-white/50 hover:text-white hover:bg-white/[0.08]',
        summary: 'text-white/70',
        h4: 'text-white',
        h4Icon: 'text-violet-300',
        divider: 'border-white/[0.05]',
        stepIcon: 'bg-violet-500/[0.14] text-violet-300',
        stepText: 'text-white/[0.62]',
        card: 'border-white/[0.08] bg-white/[0.03]',
        cardText: 'text-white/60',
        chip: 'bg-white/[0.06] text-white/70',
        safeIcon: 'text-emerald-300',
        safeText: 'text-white/65',
        costRow: 'border-white/[0.08] text-white/65',
        costVal: 'text-white',
        note: 'text-white/40',
        foot: 'border-white/[0.07]',
        plan: 'bg-amber-300/[0.08] border-amber-300/[0.22] text-amber-50',
        planIcon: 'text-amber-300',
        planStrong: 'text-white',
        ghost: 'border-white/[0.12] bg-white/[0.04] text-white/75 hover:bg-white/[0.09] hover:text-white',
        src: 'text-white/30',
      };
    const VIcon = it.icon;
    return (
      <div
        className={light ? "fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4 bg-slate-100 backdrop-blur-[6px] animate-[fadeIn_0.2s_ease-out]" : "fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4 bg-slate-950/60 backdrop-blur-[6px] animate-[fadeIn_0.2s_ease-out]"}
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="plan-feature-title"
          className={`w-full sm:max-w-[940px] h-[92vh] sm:h-[min(660px,90vh)] flex flex-col sm:grid sm:grid-cols-[340px_minmax(0,1fr)] sm:grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-t-2xl sm:rounded-2xl shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] animate-[zoomIn_0.25s_ease-out] ${C.surface}`}
        >
          {/* ★ Codex 1R — 휴대폰 = 영상 · 머리 · 설명이 한 덩어리로 스크롤되고 아래 버튼만 고정(짧은 화면에서 설명이 사라지지 않게).
               PC = 이 묶음이 사라지고(contents) 영상은 왼쪽 칸 전체 · 머리 · 설명 · 버튼은 오른쪽 칸 세 줄(설명만 스크롤). */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain sm:contents">
          {/* 예시 영상 — PC 왼쪽 칸 · 휴대폰 위 작은 칸 */}
          <div className={`flex sm:flex-col items-center sm:justify-center gap-3 p-3.5 sm:p-5 border-b sm:border-b-0 sm:border-r sm:col-start-1 sm:row-start-1 sm:row-span-3 sm:min-h-0 ${C.media}`}>
            <video
              ref={videoRef}
              key={it.id}
              src={video.src}
              poster={video.poster}
              muted
              loop
              playsInline
              preload="metadata"
              autoPlay={!reduceMotion}
              controls={reduceMotion}
              aria-label={`${it.title} 예시 영상`}
              className="w-[112px] sm:w-auto sm:h-[min(533px,calc(100%-44px))] aspect-[9/16] object-cover rounded-xl sm:rounded-2xl bg-black shadow-[0_16px_40px_-18px_rgba(15,23,42,0.55)]"
            />
            <p className={`flex-1 sm:flex-none text-[11px] leading-relaxed sm:text-center break-keep ${C.caption}`}>
              예시 화면입니다. 실제 화면은 우리 회사 고객 데이터로 채워집니다.
            </p>
          </div>

          {/* 설명 — 머리 */}
            <div className={`relative px-5 sm:px-6 pt-5 pb-4 border-b sm:col-start-2 sm:row-start-1 ${C.head}`}>
              <button
                type="button"
                onClick={onClose}
                aria-label="닫기"
                className={`absolute top-3 right-3 w-9 h-9 rounded-xl flex items-center justify-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300 ${C.x}`}
              >
                <X className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-3.5 pr-9">
                <div className={`hidden sm:flex w-12 h-12 rounded-[14px] bg-gradient-to-br ${it.gradient} items-center justify-center flex-shrink-0 shadow-[0_10px_22px_-10px_rgba(0,0,0,0.6)]`}>
                  <VIcon className={light ? 'w-6 h-6 text-slate-900' : 'w-6 h-6 text-white'} />
                </div>
                <div className="min-w-0">
                  <h3 id="plan-feature-title" className="text-[19px] font-bold tracking-[-0.01em] leading-tight">{it.title}</h3>
                  <p className={`mt-1 text-sm leading-relaxed break-keep ${C.summary}`}>{it.summary}</p>
                </div>
              </div>
            </div>

            <div className="px-5 sm:px-6 pb-3 sm:col-start-2 sm:row-start-2 sm:min-h-0 sm:overflow-y-auto sm:overscroll-contain">
              <section className="pt-4 pb-1">
                <h4 className={`flex items-center gap-1.5 text-[13px] font-bold mb-2.5 ${C.h4}`}><ListChecks className={`w-[15px] h-[15px] ${C.h4Icon}`} />이렇게 씁니다</h4>
                <ol className="grid gap-2.5">
                  {it.steps.map((st, i) => {
                    const StepIcon = st.icon;
                    return (
                      <li key={`${i}-${st.title}`} className="grid grid-cols-[28px_1fr] gap-3">
                        <div className={`w-7 h-7 rounded-[9px] flex items-center justify-center ${C.stepIcon}`}><StepIcon className="w-[15px] h-[15px]" /></div>
                        <div className="min-w-0">
                          <b className="block text-sm font-semibold mb-0.5">{st.title}</b>
                          <span className={`block text-[13px] leading-relaxed break-keep ${C.stepText}`}>{st.text}</span>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>

              {options.length > 0 && (
                <section className={`pt-4 pb-1 mt-3 border-t ${C.divider}`}>
                  <h4 className={`flex items-center gap-1.5 text-[13px] font-bold mb-2.5 ${C.h4}`}><SlidersHorizontal className={`w-[15px] h-[15px] ${C.h4Icon}`} />직접 정할 수 있는 것</h4>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {options.map((o) => (
                      <div key={o.title} className={`rounded-xl border px-3 py-2.5 ${o.wide ? 'sm:col-span-2' : ''} ${C.card}`}>
                        <b className="block text-[13px] font-semibold mb-0.5">{o.title}</b>
                        <span className={`block text-[12.5px] leading-relaxed break-keep ${C.cardText}`}>{o.text}</span>
                        {o.chips && o.chips.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {o.chips.map((c) => <span key={c} className={`text-[11.5px] px-2 py-0.5 rounded-full ${C.chip}`}>{c}</span>)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {safeguards.length > 0 && (
                <section className={`pt-4 pb-1 mt-3 border-t ${C.divider}`}>
                  <h4 className={`flex items-center gap-1.5 text-[13px] font-bold mb-2.5 ${C.h4}`}><ShieldCheck className={`w-[15px] h-[15px] ${C.h4Icon}`} />알아서 지켜 주는 것</h4>
                  <ul className="grid gap-2">
                    {safeguards.map((g) => (
                      <li key={g.title} className={`grid grid-cols-[18px_1fr] gap-2 text-[13px] leading-relaxed break-keep ${C.safeText}`}>
                        <ShieldCheck className={`w-4 h-4 mt-[3px] ${C.safeIcon}`} />
                        <div><b className={`font-semibold ${C.h4}`}>{g.title}</b> · {g.text}</div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section className={`pt-4 pb-1 mt-3 border-t ${C.divider}`}>
                <h4 className={`flex items-center gap-1.5 text-[13px] font-bold mb-1.5 ${C.h4}`}><Coins className={`w-[15px] h-[15px] ${C.h4Icon}`} />드는 크레딧</h4>
                {it.costs.length > 0 && (
                  <table className="w-full text-[13px]">
                    <tbody>
                      {it.costs.map((c) => (
                        <tr key={c.source} className={`border-b border-dashed last:border-b-0 ${C.costRow}`}>
                          <td className="py-1.5 pr-3">{c.label}</td>
                          <td className={`py-1.5 text-right whitespace-nowrap font-bold tabular-nums ${C.costVal}`}>{c.credits.toLocaleString()} 크레딧</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {it.costNote && <p className={`mt-1.5 text-[11.5px] break-keep ${C.note}`}>{it.costNote}</p>}
              </section>
            </div>

          </div>
            <div className={`shrink-0 border-t px-5 sm:px-6 pt-3 pb-4 sm:col-start-2 sm:row-start-3 ${C.foot}`}>
              <div className={`px-3.5 py-2.5 rounded-xl flex items-center gap-2.5 border text-[13px] leading-relaxed ${C.plan}`}>
                <Lock className={`w-[18px] h-[18px] flex-shrink-0 ${C.planIcon}`} />
                <span className="break-keep">
                  <b className={`font-semibold ${C.planStrong}`}>{PLAN_FEATURE_MIN_PLAN} 요금제부터</b> 이용할 수 있어요. 가입하면 매달 크레딧이 들어오고, 크레딧 안에서 바로 쓸 수 있습니다.
                </span>
              </div>
              <div className="flex flex-col-reverse sm:flex-row gap-2 mt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className={`sm:w-auto w-full px-[18px] py-3 rounded-xl border text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300 ${C.ghost}`}
                >
                  닫기
                </button>
                <button
                  ref={primaryRef}
                  type="button"
                  onClick={goPricing}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-sm font-semibold text-white shadow-[0_12px_26px_-12px_rgba(124,58,237,0.8)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"
                >
                  요금제 보기
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
              <p className={`mt-2 text-[10px] italic ${C.src}`}>Data source: AI 크레딧 단가표 · 기능 설정 화면</p>
            </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={light ? "fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4 bg-slate-100 backdrop-blur-[6px] animate-[fadeIn_0.2s_ease-out]" : "fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4 bg-slate-950/60 backdrop-blur-[6px] animate-[fadeIn_0.2s_ease-out]"}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-feature-title"
        className={light ? "w-full sm:max-w-[520px] max-h-[88vh] overflow-y-auto overscroll-contain bg-white text-slate-900 border border-slate-200 rounded-t-2xl sm:rounded-2xl shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] animate-[zoomIn_0.25s_ease-out]" : "w-full sm:max-w-[520px] max-h-[88vh] overflow-y-auto overscroll-contain bg-slate-900 text-white border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] animate-[zoomIn_0.25s_ease-out]"}
      >
        {/* 머리: 기능 아이콘 · 이름 · 한 줄 설명 */}
        <div className={light ? "relative px-6 pt-6 pb-5 border-b border-slate-200" : "relative px-6 pt-6 pb-5 border-b border-white/[0.07]"}>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className={light ? "absolute top-3.5 right-3.5 w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300" : "absolute top-3.5 right-3.5 w-9 h-9 rounded-xl flex items-center justify-center text-white/50 hover:text-white hover:bg-white/[0.08] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300"}
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-3.5 pr-9">
            <div className={`w-12 h-12 rounded-[14px] bg-gradient-to-br ${intro.gradient} flex items-center justify-center flex-shrink-0 shadow-[0_10px_22px_-10px_rgba(0,0,0,0.6)]`}>
              <Icon className={light ? "w-6 h-6 text-slate-900" : "w-6 h-6 text-white"} />
            </div>
            <div className="min-w-0">
              <h3 id="plan-feature-title" className="text-[19px] font-bold tracking-[-0.01em] leading-tight">{intro.title}</h3>
              <p className={light ? "mt-1 text-sm leading-relaxed text-slate-600 break-keep" : "mt-1 text-sm leading-relaxed text-white/70 break-keep"}>{intro.summary}</p>
            </div>
          </div>
        </div>

        {/* 본문: 이렇게 씁니다 3단계 + 크레딧 */}
        <div className="px-6 pt-4 pb-2">
          <ol className={light ? "divide-y divide-slate-100" : "divide-y divide-white/[0.04]"}>
            {intro.steps.map((s) => {
              const StepIcon = s.icon;
              return (
                <li key={s.title} className="grid grid-cols-[28px_1fr] gap-3 py-2.5">
                  <div className={light ? "w-7 h-7 rounded-[9px] bg-violet-100 text-violet-700 flex items-center justify-center" : "w-7 h-7 rounded-[9px] bg-violet-500/[0.14] text-violet-300 flex items-center justify-center"}>
                    <StepIcon className="w-[15px] h-[15px]" />
                  </div>
                  <div className="min-w-0">
                    <b className="block text-sm font-semibold mb-0.5">{s.title}</b>
                    <span className={light ? "block text-[13px] leading-relaxed text-slate-500 break-keep" : "block text-[13px] leading-relaxed text-white/[0.62] break-keep"}>{s.text}</span>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="mt-3 mb-1 flex flex-wrap gap-1.5">
            {intro.costs.length > 0
              ? intro.costs.map((c) => (
                <span key={c.source} className={light ? "inline-flex items-baseline gap-1.5 px-2.5 py-1.5 rounded-[9px] bg-white border border-slate-200 text-xs text-slate-500" : "inline-flex items-baseline gap-1.5 px-2.5 py-1.5 rounded-[9px] bg-white/[0.05] border border-white/[0.08] text-xs text-white/[0.66]"}>
                  {c.label}
                  <em className={light ? "not-italic font-bold text-slate-900 tabular-nums" : "not-italic font-bold text-white tabular-nums"}>{c.credits.toLocaleString()}</em>
                  크레딧
                </span>
              ))
              : (
                <span className={light ? "inline-flex px-2.5 py-1.5 rounded-[9px] bg-white border border-slate-200 text-xs text-slate-500" : "inline-flex px-2.5 py-1.5 rounded-[9px] bg-white/[0.05] border border-white/[0.08] text-xs text-white/[0.66]"}>
                  {intro.costNote}
                </span>
              )}
          </div>
        </div>

        {/* 요금제 안내 */}
        <div className={light ? "mx-6 mt-3 px-3.5 py-3 rounded-xl flex items-center gap-2.5 bg-amber-50 border border-amber-300/[0.22] text-[13px] leading-relaxed text-amber-900" : "mx-6 mt-3 px-3.5 py-3 rounded-xl flex items-center gap-2.5 bg-amber-300/[0.08] border border-amber-300/[0.22] text-[13px] leading-relaxed text-amber-50"}>
          <Lock className={light ? "w-[18px] h-[18px] text-amber-700 flex-shrink-0" : "w-[18px] h-[18px] text-amber-300 flex-shrink-0"} />
          <span className="break-keep">
            <b className={light ? "font-semibold text-slate-900" : "font-semibold text-white"}>{PLAN_FEATURE_MIN_PLAN} 요금제부터</b> 이용할 수 있어요. 가입하면 매달 크레딧이 들어오고, 크레딧 안에서 바로 쓸 수 있습니다.
          </span>
        </div>

        {/* 버튼 */}
        <div className="flex flex-col-reverse sm:flex-row gap-2 px-6 pt-[18px] pb-5">
          <button
            type="button"
            onClick={onClose}
            className={light ? "sm:w-auto w-full px-[18px] py-3 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300" : "sm:w-auto w-full px-[18px] py-3 rounded-xl border border-white/[0.12] bg-white/[0.04] text-sm font-medium text-white/75 hover:bg-white/[0.09] hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300"}
          >
            닫기
          </button>
          <button
            ref={primaryRef}
            type="button"
            onClick={goPricing}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-sm font-semibold text-white shadow-[0_12px_26px_-12px_rgba(124,58,237,0.8)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300"
          >
            요금제 보기
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
        <p className={light ? "px-6 pb-4 -mt-1.5 text-[10px] italic text-slate-400" : "px-6 pb-4 -mt-1.5 text-[10px] italic text-white/30"}>Data source: AI 크레딧 단가표</p>
      </div>
    </div>
  );
}
