import { useCallback, useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ *
 *  OpenPromoPopup — 오픈 기념 구독 할인 팝업
 *  로그인 직후 뜨는 메인 팝업. 기존 AiGuidePopup.tsx 를 대체.
 *
 *  핵심 메시지: "12개월 약정 시 2개월 무료"
 *  = 12개월 약정 중 10개월 요금만 결제(2개월은 무료).
 *
 *  - Modal wrapper + 우상단 close(X) + ESC 닫기
 *  - "오늘 하루 보지 않기" 체크 시 localStorage 24h dismiss
 *  - z-index 9998 / 중앙 정렬 / 세로 스크롤 안전
 *  - 셀프 게이팅: 마운트 시 shouldShowOpenPromo()로 노출 여부 결정(부모는 그냥 렌더).
 * ------------------------------------------------------------------ */

const DISMISS_KEY = "targetup_openpromo_dismiss";
const DISMISS_MS = 24 * 60 * 60 * 1000;
const PRICING_HREF = "/pricing";

/** 24h dismiss 여부를 확인. 마운트 조건으로 사용. */
export function shouldShowOpenPromo(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const until = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return !(until && Date.now() < until);
  } catch {
    return true;
  }
}

type CloseReason = "x" | "esc" | "backdrop" | "later" | "cta";

type Props = {
  /** 닫힐 때 호출 (reason 으로 분기 가능) */
  onClose?: (reason: CloseReason) => void;
  /** CTA 클릭 시 라우팅. 미지정 시 window.location = "/pricing" */
  onNavigate?: () => void;
};

export default function OpenPromoPopup({ onClose, onNavigate }: Props) {
  const [open, setOpen] = useState(() => shouldShowOpenPromo());
  const [dontShow, setDontShow] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const close = useCallback(
    (reason: CloseReason) => {
      if (dontShow) {
        try {
          localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_MS));
        } catch {
          /* noop */
        }
      }
      setOpen(false);
      onClose?.(reason);
    },
    [dontShow, onClose]
  );

  // ESC 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close("esc");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  const handleCta = () => {
    onClose?.("cta");
    if (onNavigate) onNavigate();
    else window.location.assign(PRICING_HREF);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center overflow-y-auto p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="open-promo-title"
    >
      <style>{KEYFRAMES}</style>

      {/* backdrop */}
      <div
        data-anim="backdrop"
        onClick={() => close("backdrop")}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />

      {/* card */}
      <div
        ref={cardRef}
        data-anim="card"
        className="relative w-full max-w-[500px] overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 shadow-2xl"
      >
        {/* glows */}
        <div
          data-anim="glow"
          style={{ animationDelay: ".1s" }}
          className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 blur-3xl"
          aria-hidden
        >
          <div className="h-full w-full" style={{ background: "radial-gradient(circle at 70% 30%, rgba(167,139,250,0.25), transparent 60%)" }} />
        </div>
        <div
          data-anim="glow"
          style={{ animationDelay: ".18s" }}
          className="pointer-events-none absolute -bottom-28 -left-24 h-72 w-72 blur-3xl"
          aria-hidden
        >
          <div className="h-full w-full" style={{ background: "radial-gradient(circle at 30% 75%, rgba(217,70,239,0.20), transparent 60%)" }} />
        </div>
        {/* top sheen */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />

        {/* close */}
        <button
          type="button"
          onClick={() => close("x")}
          aria-label="닫기"
          className="absolute right-3.5 top-3.5 z-10 grid h-9 w-9 place-items-center rounded-full text-white/45 transition hover:bg-white/10 hover:text-white"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        <div className="relative flex flex-col items-center gap-7 px-7 pb-6 pt-9 sm:px-9 sm:pt-10">
          {/* eyebrow */}
          <div data-anim="rise" style={{ animationDelay: ".12s" }}>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/40 bg-violet-500/15 px-3 py-1 text-xs font-semibold text-violet-200">
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 text-violet-300" aria-hidden>
                <path d="M12 2.5l1.7 4.9 4.9 1.7-4.9 1.7L12 15.7l-1.7-4.9L5.4 9.1l4.9-1.7L12 2.5z" fill="currentColor" />
                <path d="M19 13.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" fill="currentColor" opacity=".7" />
              </svg>
              오픈 기념 혜택
            </span>
          </div>

          {/* headline */}
          <div id="open-promo-title" data-anim="rise" style={{ animationDelay: ".22s" }} className="text-center">
            <h2 className="text-[26px] font-semibold leading-[1.25] tracking-[-0.02em] text-white sm:text-3xl">
              12개월 약정 시
            </h2>
            <p className="mt-1 bg-gradient-to-r from-violet-300 to-fuchsia-300 bg-clip-text text-5xl font-extrabold leading-none tracking-[-0.03em] text-transparent sm:text-6xl">
              2개월 무료
            </p>
          </div>

          {/* subline */}
          <p
            data-anim="rise"
            style={{ animationDelay: ".32s" }}
            className="max-w-[380px] text-center text-[15px] leading-relaxed text-white/60"
          >
            <span className="font-medium text-white/80">AI Operator</span>를 포함한 어떤 요금제든 동일하게 적용됩니다.
          </p>

          {/* 직관 요소: 12개월 약정 · 결제 10개월 · 2개월 무료 */}
          <div data-anim="rise" style={{ animationDelay: ".4s" }} className="w-full max-w-[400px]">
            <div className="flex items-end gap-[5px]">
              {Array.from({ length: 12 }).map((_, i) => {
                const free = i >= 10;
                return (
                  <div
                    key={i}
                    data-anim="seg"
                    style={{ animationDelay: `${0.46 + i * 0.035}s` }}
                    className={
                      "h-2.5 flex-1 rounded-[3px] " +
                      (free
                        ? "bg-gradient-to-t from-violet-400 to-fuchsia-400 shadow-[0_0_12px_rgba(217,70,239,.55)]"
                        : "bg-violet-400/30")
                    }
                  />
                );
              })}
            </div>
            <div className="mt-2.5 flex items-center justify-between text-[11px] sm:text-xs">
              <span className="text-white/40">결제 10개월</span>
              <span className="font-semibold text-fuchsia-200">2개월 무료 →</span>
            </div>
          </div>

          {/* CTA */}
          <button
            type="button"
            data-anim="rise"
            style={{ animationDelay: ".5s" }}
            onClick={handleCta}
            className="cta-pulse group mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-6 py-3.5 text-[15px] font-semibold text-white transition hover:from-violet-400 hover:to-fuchsia-400"
          >
            요금제 보고 혜택 받기
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 transition-transform group-hover:translate-x-0.5" aria-hidden>
              <path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* footer */}
        <div
          data-anim="rise"
          style={{ animationDelay: ".6s" }}
          className="flex items-center justify-between gap-3 border-t border-white/10 px-7 py-3.5 sm:px-9"
        >
          <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-white/45 transition hover:text-white/70">
            <span
              className={
                "grid h-4 w-4 place-items-center rounded-[5px] border transition " +
                (dontShow ? "border-violet-400 bg-violet-500 text-white" : "border-white/25 bg-white/5 text-transparent")
              }
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3" aria-hidden>
                <path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <input
              type="checkbox"
              className="sr-only"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
            />
            오늘 하루 보지 않기
          </label>

          <button
            type="button"
            onClick={() => close("later")}
            className="text-[13px] font-medium text-white/45 transition hover:text-white/80"
          >
            나중에 보기
          </button>
        </div>
      </div>
    </div>
  );
}

/* 등장 모션 — 글로우/뱃지 순차. prefers-reduced-motion 시 즉시 표시. */
const KEYFRAMES = `
@keyframes opp-backdrop { from { opacity: 0 } to { opacity: 1 } }
@keyframes opp-card { from { opacity: 0; transform: translateY(10px) scale(.965) } to { opacity: 1; transform: none } }
@keyframes opp-glow { from { opacity: 0; transform: scale(.85) } to { opacity: 1; transform: none } }
@keyframes opp-rise { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: none } }
@keyframes opp-seg { from { opacity: 0; transform: scaleX(.2) } to { opacity: 1; transform: none } }
@keyframes opp-cta { 0%,100% { box-shadow: 0 10px 30px -8px rgba(139,92,246,.5) } 50% { box-shadow: 0 14px 38px -8px rgba(139,92,246,.7), 0 0 36px 2px rgba(217,70,239,.25) } }
[data-anim="backdrop"] { animation: opp-backdrop .28s ease both }
[data-anim="card"] { animation: opp-card .5s cubic-bezier(.16,1,.3,1) both }
[data-anim="glow"] { animation: opp-glow .9s ease both }
[data-anim="rise"] { animation: opp-rise .55s cubic-bezier(.16,1,.3,1) both }
[data-anim="seg"] { animation: opp-seg .5s cubic-bezier(.16,1,.3,1) both; transform-origin: left center }
.cta-pulse { animation: opp-cta 3.4s ease-in-out infinite }
.cta-pulse:hover { animation: none }
@media (prefers-reduced-motion: reduce) {
  [data-anim], .cta-pulse { animation: none !important }
}
`;
